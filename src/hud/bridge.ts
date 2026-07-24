import { useHudStore } from './store';
import type { HudMode } from './store';
import type { CombatantStats, InspectableStats } from '@/data/types';
import type { NpcDayRole, NpcNightPosture } from '@/entities/NpcCharacter';
import type { EquipmentState } from '@/systems/Equipment';

/**
 * Event bridge (plan 046 Step 3): the one-way pipe from the game into the HUD store, plus a typed
 * outbound `emit`. It is the HUD's peer on `game.events` (the sanctioned scene↔UI seam — see
 * docs/CONVENTIONS.md), dropped in beside the old `UIScene`. Neither the store nor any component
 * imports Phaser; the bridge is the only file that touches the bus + registry.
 *
 * Lifecycle (see plan 046 "Lifecycle"): both `game.events` and the registry OUTLIVE any scene, so
 * the bridge subscribes ONCE and never tears down on a scene SHUTDOWN. It only fully unsubscribes on
 * React unmount / `game.destroy` (via {@link disposeBridge}). On a GameScene death→restart the store
 * self-re-syncs: GameScene re-emits mode/combat/demolish/supply (GameScene.ts ~783-793) and sets a
 * fresh `inventory` on the registry — the bridge rebinds its `Inventory` `'change'` listener to the
 * new instance (detaching the dead one first, so no leak) and re-snapshots. The store is never reset.
 */

/** The slice of an eventemitter3 / Phaser `EventEmitter` the bridge needs. Modelled as an interface
 *  (not the Phaser type) so the unit test can pass a plain mock. `never[]` handler args let any
 *  concrete handler signature register without `any` (a fn is always assignable to `(...args:
 *  never[]) => void`) — the same trick GameScene.wireBus uses. */
export interface EventBus {
  on(event: string, fn: (...args: never[]) => void, context?: unknown): unknown;
  off(event: string, fn: (...args: never[]) => void, context?: unknown): unknown;
  emit(event: string, ...args: unknown[]): unknown;
}

/** The registry slice the bridge reads. Phaser's `game.registry` is a `DataManager`: `.get(key)`
 *  reads a value and `.events` fires `setdata` (first set of a key) / `changedata-<key>` (later
 *  sets) — both of which the bridge listens to so a restart's fresh `inventory` is caught. */
export interface Registry {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
  events: EventBus;
}

/** The `Inventory` surface the bridge touches: an eventemitter3 emitting `'change'` with a snapshot,
 *  plus `snapshot()`. Kept structural so the test can supply a mock without the real class. */
interface InventoryLike {
  on(event: 'change', fn: (snapshot: Record<string, number>) => void, context?: unknown): unknown;
  off(event: 'change', fn: (snapshot: Record<string, number>) => void, context?: unknown): unknown;
  snapshot(): Record<string, number>;
}

/** Payload shapes of the outbound (world→HUD) events, as emitted by the game (verified at the emit
 *  sites). Only the fields the store consumes are typed. */
interface HpPayload {
  hp: number;
  maxHp: number;
}
interface HungerPayload {
  hunger: number;
  max: number;
}
type FirePayload = { fuel: number; maxFuel: number; lit: boolean } | null;
interface SupplyPayload {
  wood: number;
  rock: number;
}
interface TimePayload {
  phase: 'day' | 'night';
  dayCount: number;
  tNorm: number;
}
interface TasksPayload {
  current: string | null;
  pending: number;
}
interface BuildSelectPayload {
  id: string;
}

/**
 * The inbound (HUD→world) event union: every event a HUD control emits back onto the bus for the
 * game to act on. Payloads match the handlers wired in `GameScene.wireBus()`. The controls that fire
 * these land in later steps (6/10/11/12); Step 3 only provides the typed channel + passthrough.
 */
export type InboundEvent =
  | { type: 'build:toggle' }
  | { type: 'build:select'; payload: BuildSelectPayload }
  | { type: 'build:rotate' }
  | { type: 'demolish:toggle' }
  | { type: 'tasks:cancel' }
  | { type: 'zoom:delta'; payload: number }
  | { type: 'camera:center' }
  | { type: 'combat:attack' }
  | { type: 'combat:bow' }
  | { type: 'combat:move'; payload: { dx: number; dy: number } }
  | { type: 'combat:moveEnd' }
  | { type: 'mode:combatToggle' }
  | { type: 'mode:inspectToggle' }
  // `inspect:hide` is dual-direction: the world emits it (outbound, cleared into the store above), and
  // the DOM inspect card also emits it to dismiss itself — the bridge's own outbound listener then
  // zeroes `inspectTarget`, so the card's open state stays a pure mirror of the store (plan 046 Step 8).
  | { type: 'inspect:hide' }
  | { type: 'needs:eat'; payload: { itemId: string } }
  | { type: 'npc:assignDayRole'; payload: NpcDayRole }
  | { type: 'npc:assignNightPosture'; payload: NpcNightPosture }
  | { type: 'npc:beginPlaceGuard' }
  | { type: 'npc:cancelPlaceGuard' }
  | { type: 'craft:queue'; payload: { benchId: string; recipeId: string } }
  | { type: 'craft:repair'; payload: { benchId: string } }
  | { type: 'equip:toggle'; payload: { itemId: string } }
  | { type: 'debug:spawnEnemy' }
  | { type: 'debug:spawnNpc' }
  | { type: 'debug:toggleTime' }
  | { type: 'debug:forceWave' };

/** A live bridge handle: `emit` to send inbound events, `dispose` to unsubscribe everything. */
export interface Bridge {
  /** Send an inbound (HUD→world) event onto the bus for the game to handle. */
  emit(event: InboundEvent): void;
  /** Set the registry `movepadHeld` flag (plan 046 Step 10). `PointerInputController` reads it to
   *  suppress world pan/tap while the DOM movepad is being dragged — the DOM peer of the old
   *  `UIScene.isMovepadHeld()`. Not a bus event: it's polled per-pointer, so a registry flag (not an
   *  event) is the right shape. */
  setMovepadHeld(held: boolean): void;
  /** Unsubscribe every listener (call on React unmount / `game.destroy`). Idempotent. */
  dispose(): void;
}

/**
 * Wire the bridge: subscribe all outbound events + the registry `inventory` to the store's setters,
 * and return a handle exposing the typed `emit` + `dispose`. Safe to call once at HUD mount.
 */
export function initBridge(bus: EventBus, registry: Registry): Bridge {
  const store = useHudStore.getState();
  const unsubs: Array<() => void> = [];
  // Pending eat-cooldown clear timer (see the `needs:fed` handler); cleared on dispose.
  let eatCooldownTimer: ReturnType<typeof setTimeout> | null = null;

  /** Register a typed handler on the bus and record its matching teardown. */
  const on = <T>(event: string, fn: (payload: T) => void): void => {
    const handler = fn as (...args: never[]) => void;
    bus.on(event, handler);
    unsubs.push(() => void bus.off(event, handler));
  };

  // --- Outbound (world→HUD) → store ------------------------------------------
  on<HpPayload>('player:hpChanged', (p) => store.setHp(p.hp, p.maxHp));
  on('player:hit', () => store.pulseHit());
  on<HungerPayload>('hunger:changed', (p) => store.setHunger(p.hunger, p.max));
  // Eat feedback: the hunger meter replays a "+N" pulse, and (if the eat started a cooldown) the hotbar
  // runs a shrinking sweep over food slots for `cooldownMs`. A `setTimeout` clears the flag when it
  // elapses; the endEatCooldown nonce guard ignores a stale timer from a superseded cooldown.
  on<{ amount: number; cooldownMs?: number }>('needs:fed', (p) => {
    store.pulseFed(p.amount);
    const ms = p.cooldownMs ?? 0;
    if (ms <= 0) return;
    store.beginEatCooldown(ms);
    const nonce = useHudStore.getState().eatCooldownNonce;
    if (eatCooldownTimer !== null) clearTimeout(eatCooldownTimer);
    eatCooldownTimer = setTimeout(() => {
      eatCooldownTimer = null;
      useHudStore.getState().endEatCooldown(nonce);
    }, ms);
  });
  on<FirePayload>('fire:changed', (p) =>
    store.setFire(p ? { fuel: p.fuel, maxFuel: p.maxFuel, lit: p.lit } : null),
  );
  on<SupplyPayload>('supply:changed', (p) => store.setSupply({ wood: p.wood, rock: p.rock }));
  // The player's equip loadout (plan 049). The game emits the full `Equipment.snapshot()` on every
  // toggle (and, throttled, as the brand drains — Step 6); mirror it straight into the store.
  on<EquipmentState>('equipment:changed', (snap) => store.setEquipment(snap));
  on<TimePayload>('time:changed', (p) => store.setTime(p.phase, p.dayCount, p.tNorm));
  // Continuous dial sweep between the sparse transition-only `time:changed` updates (see SurvivalClock).
  on<{ tNorm: number }>('time:progress', (p) => store.setTimeProgress(p.tNorm));
  on<TasksPayload>('tasks:changed', (p) =>
    store.setTasks({ current: p.current, pending: p.pending }),
  );
  on<HudMode>('mode:changed', (m) => {
    store.setMode(m);
    // Leaving inspect mode clears any shown card — the DOM port of the retired UIScene.onModeChanged
    // (GameScene's setMode emits only `mode:changed`, never `inspect:hide`, so the HUD owns this).
    if (m !== 'inspect') store.setInspect(null);
  });
  on<boolean>('build:modeChanged', (on) => store.setBuildMode(on));
  on<BuildSelectPayload>('build:select', (p) => store.setSelection(p.id));
  on<boolean>('demolish:modeChanged', (on) => store.setDemolishMode(on));
  on<boolean>('combat:activeChanged', (on) => store.setCombatActive(on));
  on<InspectableStats>('inspect:show', (stats) => store.setInspect(stats));
  on('inspect:hide', () => store.setInspect(null));
  // A tap on the companion opens its assignment menu (plan 042 → 046 Step 12). The payload carries the
  // sprite's on-screen `x`/`y` for the legacy anchored popover; the DOM menu is a bottom sheet, so it
  // uses only the live `dayRole`/`nightPosture` to highlight the active rows.
  on<{ dayRole: NpcDayRole; nightPosture: NpcNightPosture }>('npc:menuOpen', (p) =>
    store.openCompanionMenu(p.dayRole, p.nightPosture),
  );
  // A tap on a workbench opens its craft menu (plan 048 Step 7) — carries the bench id (routed back on
  // a recipe/Repair pick) + its live hp (Repair shows only when damaged).
  on<{ benchId: string; hp: number; maxHp: number }>('craft:menuOpen', (p) =>
    store.openCraftMenu(p.benchId, p.hp, p.maxHp),
  );
  on<number>('zoom:changed', (z) => store.setZoom(z));
  on<boolean>('camera:followChanged', (on) => store.setFollowing(on));

  // --- Registry `inventory`: rebind + snapshot -------------------------------
  // GameScene builds a fresh `Inventory` on every (re)start (GameScene.ts ~368) and sets it on the
  // registry, so the bridge tracks the live instance: snapshot it and follow its `'change'`. On a
  // restart the registry hands us the NEW instance — detach the dead one first so nothing leaks.
  let boundInv: InventoryLike | null = null;
  const onInvChange = (snapshot: Record<string, number>): void => store.setInventory(snapshot);
  const bindInventory = (inv: InventoryLike | null): void => {
    if (inv === boundInv) return;
    if (boundInv) boundInv.off('change', onInvChange);
    boundInv = inv;
    if (inv) {
      inv.on('change', onInvChange);
      store.setInventory(inv.snapshot());
    }
  };
  bindInventory((registry.get('inventory') as InventoryLike | undefined) ?? null);

  // --- Registry `playerStats`: static per run, re-set on restart --------------
  // GameScene sets the player's combat stat bag on the registry (GameScene.ts ~473); the Status drawer
  // renders it. It's plain data (not an emitter) that changes only across a restart, so we read it once
  // at init and follow the same setdata/changedata-<key> registry signals as the inventory.
  const syncPlayerStats = (value: unknown): void =>
    store.setPlayerStats((value as CombatantStats | undefined) ?? null);
  syncPlayerStats(registry.get('playerStats'));

  // --- Registry `sceneActive`: gate the overlay to the Game scene ---------------
  // The HUD is page-level and outlives every scene, so without a gate it paints over Boot/Preload/
  // MainMenu too. GameScene sets `sceneActive` true in create() / false on SHUTDOWN; mirror it here (and
  // read it once at init so a HUD (re)mount after the scene is already live still resolves correct —
  // same self-re-sync as inventory/playerStats above).
  const syncSceneActive = (value: unknown): void => store.setSceneActive(value === true);
  syncSceneActive(registry.get('sceneActive'));

  // `setdata` fires on the first-ever set of a key; `changedata-<key>` on every later set (restart).
  const onSetData = (_parent: unknown, key: string, value: unknown): void => {
    if (key === 'inventory') bindInventory((value as InventoryLike | null) ?? null);
    else if (key === 'playerStats') syncPlayerStats(value);
    else if (key === 'sceneActive') syncSceneActive(value);
  };
  const onInventoryData = (_parent: unknown, value: unknown): void =>
    bindInventory((value as InventoryLike | null) ?? null);
  const onPlayerStatsData = (_parent: unknown, value: unknown): void => syncPlayerStats(value);
  const onSceneActiveData = (_parent: unknown, value: unknown): void => syncSceneActive(value);
  registry.events.on('setdata', onSetData);
  registry.events.on('changedata-inventory', onInventoryData);
  registry.events.on('changedata-playerStats', onPlayerStatsData);
  registry.events.on('changedata-sceneActive', onSceneActiveData);
  unsubs.push(() => {
    if (boundInv) boundInv.off('change', onInvChange);
    boundInv = null;
    registry.events.off('setdata', onSetData);
    registry.events.off('changedata-inventory', onInventoryData);
    registry.events.off('changedata-playerStats', onPlayerStatsData);
    registry.events.off('changedata-sceneActive', onSceneActiveData);
  });

  let disposed = false;
  return {
    emit(event: InboundEvent): void {
      if ('payload' in event) bus.emit(event.type, event.payload);
      else bus.emit(event.type);
    },
    setMovepadHeld(held: boolean): void {
      registry.set('movepadHeld', held);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (eatCooldownTimer !== null) clearTimeout(eatCooldownTimer);
      eatCooldownTimer = null;
      for (const off of unsubs) off();
      unsubs.length = 0;
    },
  };
}
