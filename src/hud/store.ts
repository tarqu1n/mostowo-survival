import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { PLAYER_MAX_HP, HUNGER_MAX } from '@/config';
import { BUILDABLES } from '@/data/buildables';
import type { CombatantStats, InspectableStats } from '@/data/types';
import type { NpcDayRole, NpcNightPosture } from '@/entities/NpcCharacter';
import type { EquipmentState } from '@/systems/Equipment';

/**
 * The DOM/React HUD's single source of truth (plan 046 Step 3). A Zustand store that mirrors the
 * game's live state one-way: the {@link ./bridge event bridge} subscribes to `game.events` + the
 * shared registry and drives these setters; React components read via `useHudStore(selector)`.
 * Neither side imports the other — same seam the editor's `useEditorStore` uses for React↔Phaser.
 *
 * The store lives at the page level and PERSISTS across a GameScene death→restart (the bridge never
 * tears it down — see bridge.ts). On restart it re-syncs from GameScene's re-emitted values + the
 * registry rather than resetting, so a fresh run reads true without a store rebuild.
 */

/** Number of quick-swap hotbar slots (Field Kit loadout). `HUD_HOTBAR_SLOTS` is added to
 *  `src/config.ts` at Step 4; kept local here so Step 3 carries no forward dependency on that step. */
export const HOTBAR_SLOTS = 6;

/** One quick-swap hotbar slot: a pinned inventory item or buildable, or an empty slot. The pin
 *  actions that populate it land at Step 11; Step 3 only defines the shape + empty default. */
export type HotbarSlot = { readonly kind: 'item' | 'buildable'; readonly id: string } | null;

/** Fire-heart readout (plan 038): the primary campfire's fuel/lit, or `null` when no hearth exists
 *  (the HUD hides the bar). Mirrors the `fire:changed` payload. */
export interface FireState {
  readonly fuel: number;
  readonly maxFuel: number;
  readonly lit: boolean;
}

/** Shared base-supply pool readout (plan 042). Mirrors the `supply:changed` payload. */
export interface SupplyState {
  readonly wood: number;
  readonly rock: number;
}

/** Worker order-queue summary (plan 013). Mirrors the `tasks:changed` payload. */
export interface TaskSummary {
  readonly current: string | null;
  readonly pending: number;
}

/** Night-wave readout. There is no dedicated wave event — a wave runs the whole night phase (plan
 *  038), so this is derived from `time:changed` and carries room for a wave number later. */
export interface WaveInfo {
  readonly active: boolean;
}

export type HudMode = 'command' | 'combat' | 'inspect';

/** Blueprint-Mode pending-run tally (plan 050 Step 7) — the live count/cost/ETA of the run a line-tool
 *  drag has painted, mirroring the `build:runChanged` payload (BuildManager's `runSelection()`, minus
 *  the tile array). Drives the commit bar: `tileCount > 0` reveals it; it shows `affordableCount` of
 *  `placeableCount`, the affordable subset's `totalCost`, and its serial build `etaMs`. */
export interface RunTally {
  readonly tileCount: number;
  readonly placeableCount: number;
  readonly affordableCount: number;
  readonly totalCost: Record<string, number>;
  readonly etaMs: number;
}

/** Companion-menu readout (plan 046 Step 12). The DOM `CompanionMenu` is a bottom sheet, not the
 *  legacy anchored popover, so it drops `npc:menuOpen`'s `x`/`y` and keeps only what it renders: the
 *  open flag plus the companion's live `dayRole`/`nightPosture` (to highlight the active rows). Held
 *  in the store — rather than as component props off a raw event — so the bridge (the sole owner of
 *  the bus) opens it and the sheet's own dismiss closes it, matching how inspect mirrors the store. */
export interface CompanionMenuState {
  readonly open: boolean;
  readonly dayRole: NpcDayRole;
  readonly nightPosture: NpcNightPosture;
}

/** Workbench craft-menu state (plan 048 Step 7) — opened by the `craft:menuOpen` game event (fired
 *  when the player taps a workbench), closed by the sheet's own dismiss. Carries the tapped bench's id
 *  (routed back on a recipe/Repair pick) + its live hp/maxHp (the Repair option shows only when
 *  damaged). The recipe list itself is read from `RECIPES` by the component, like BuildCatalog reads
 *  `BUILDABLES` — so only the per-bench context lives here. */
export interface CraftMenuState {
  readonly open: boolean;
  readonly benchId: string | null;
  readonly hp: number;
  readonly maxHp: number;
}

/** Live HUD state, one-way mirror of the game. */
export interface HudState {
  hp: number;
  maxHp: number;
  hunger: number;
  maxHunger: number;
  fire: FireState | null;
  supply: SupplyState;
  dayPhase: 'day' | 'night';
  dayCount: number;
  /** Normalised position through the current day/night cycle, 0..1 (from `time:changed` `tNorm`). */
  time: number;
  waveInfo: WaveInfo;
  tasks: TaskSummary;
  mode: HudMode;
  buildMode: boolean;
  /** Whether the Blueprint-Mode line tool is armed (plan 050 Step 6). While true, a build-mode drag
   *  paints an axis-locked run of blueprints; the build-thumb-zone FAB reflects this. Mirrors the
   *  game's `build:lineToolChanged` (the game owns the flag; the FAB is a pure mirror). */
  lineTool: boolean;
  /** Live tally of the Blueprint-Mode pending run (plan 050 Step 7) — mirrors `build:runChanged`. The
   *  commit bar renders it and shows only while `tileCount > 0`. Reset to an empty run each (re)start. */
  runTally: RunTally;
  /** Currently selected buildable id, or `null` when nothing is selected. */
  selection: string | null;
  /** Whether {@link selection} can be rotated at placement (derived from `BUILDABLES`). */
  orientable: boolean;
  demolishMode: boolean;
  combatActive: boolean;
  inspectTarget: InspectableStats | null;
  /** Companion assignment menu state (plan 046 Step 12) — opened by the `npc:menuOpen` game event
   *  (fired when the player taps the ally), closed by the sheet's own dismiss. */
  companionMenu: CompanionMenuState;
  /** Workbench craft menu state (plan 048 Step 7) — opened by the `craft:menuOpen` game event (fired
   *  when the player taps a workbench), closed by the sheet's own dismiss. */
  craftMenu: CraftMenuState;
  /** The player's combat stat bag (armour/speed/strength/…), surfaced by GameScene on the registry
   *  (`playerStats`). Static per run; `null` until the bridge reads it. Feeds the Status drawer's stat
   *  rows (plan 046 Step 11 — the DOM replacement for the legacy WellbeingPanel stats). */
  playerStats: CombatantStats | null;
  /** Aggregate item counts by id (the `Inventory.snapshot()` shape). */
  inventory: Record<string, number>;
  /** The player's three equip slots (plan 049) — the `Equipment.snapshot()` shape, each slot an
   *  `{ id, durability }` or `null`. Drives the toolbar/pack equip outline + durability bar. */
  equipment: EquipmentState;
  hotbar: HotbarSlot[];
  following: boolean;
  zoom: number;
  /** Monotonic counter bumped on every `player:hit`. `player:hit` is a transient event with no
   *  payload; a counter lets the damage-vignette layer (Step 9) react to each hit via a store read. */
  hitNonce: number;
  /** Whether the Game scene is live. The page-level HUD outlives every scene, so without this it would
   *  also paint over Boot/Preload/MainMenu (the loading + title screens). GameScene sets the registry
   *  `sceneActive` flag true in create()/false on SHUTDOWN; the bridge mirrors it here and `GameHud`
   *  renders nothing while it's false. */
  sceneActive: boolean;
  /** Monotonic counter bumped each time the player eats (`needs:fed`), with {@link fedAmount} the
   *  hunger gained. Like {@link hitNonce}, a transient event surfaced as a store read so the hunger
   *  meter can replay its "+N" feed-pulse indicator on each eat. */
  fedNonce: number;
  /** Hunger points gained on the most recent eat (paired with {@link fedNonce}). */
  fedAmount: number;
  /** Whether an eat cooldown is currently running (from `needs:fed`'s `cooldownMs`). While true the
   *  hotbar greys food slots with a shrinking sweep and ignores taps on them (the game enforces it too). */
  eatCooldownActive: boolean;
  /** The active cooldown's total length (ms) — the sweep animation's duration. */
  eatCooldownMs: number;
  /** Monotonic counter bumped when a cooldown STARTS — keys the sweep overlay so each eat replays it. */
  eatCooldownNonce: number;
}

/** Imperative setters the bridge calls; grouped so components never mutate state directly. */
export interface HudActions {
  setHp(hp: number, maxHp: number): void;
  pulseHit(): void;
  setHunger(hunger: number, maxHunger: number): void;
  setFire(fire: FireState | null): void;
  setSupply(supply: SupplyState): void;
  setTime(phase: 'day' | 'night', dayCount: number, time: number): void;
  /** Update only the cycle position (`time`, 0..1) from the throttled `time:progress` tick — the
   *  day/night dial's continuous sweep between the sparse `setTime` transition updates. */
  setTimeProgress(time: number): void;
  setTasks(tasks: TaskSummary): void;
  setMode(mode: HudMode): void;
  setBuildMode(on: boolean): void;
  /** Mirror the build line-tool armed/off flag (from `build:lineToolChanged`). */
  setLineTool(on: boolean): void;
  /** Mirror the Blueprint-Mode pending-run tally (from `build:runChanged`). */
  setRunTally(tally: RunTally): void;
  /** Select a buildable (or `null` to clear). Recomputes {@link HudState.orientable} from data. */
  setSelection(id: string | null): void;
  setDemolishMode(on: boolean): void;
  setCombatActive(on: boolean): void;
  setInspect(target: InspectableStats | null): void;
  /** Open the companion menu with the ally's live role/posture (from `npc:menuOpen`). */
  openCompanionMenu(dayRole: NpcDayRole, nightPosture: NpcNightPosture): void;
  /** Close the companion menu (the sheet's dismiss); leaves the last role/posture in place. */
  closeCompanionMenu(): void;
  /** Open the craft menu for a tapped workbench (from `craft:menuOpen`), carrying its id + live hp. */
  openCraftMenu(benchId: string, hp: number, maxHp: number): void;
  /** Close the craft menu (the sheet's dismiss). */
  closeCraftMenu(): void;
  setPlayerStats(stats: CombatantStats | null): void;
  setInventory(inventory: Record<string, number>): void;
  /** Mirror the player's equip loadout (from `equipment:changed`). */
  setEquipment(equipment: EquipmentState): void;
  setHotbar(hotbar: HotbarSlot[]): void;
  /** Pin an item/buildable into the loadout — used by the long-press "pin" affordance on catalog/pack
   *  entries (plan 046). Fills the first empty slot, no-op if already pinned or the bar is full. The
   *  store holds the loadout in memory; `localStorage` persistence (keyed per save) is a side-effect
   *  subscription wired in `useBridge` (Step 11), so any `setHotbar`/`pinToHotbar` change is saved. */
  pinToHotbar(entry: NonNullable<HotbarSlot>): void;
  setFollowing(on: boolean): void;
  setZoom(zoom: number): void;
  /** Mirror the Game scene's live/gone state (from the registry `sceneActive` flag) — gates the whole
   *  overlay so it never paints over the loading/title screens. */
  setSceneActive(active: boolean): void;
  /** Bump the feed pulse (from `needs:fed`) with the hunger gained — replays the hunger meter's "+N"
   *  eat indicator. */
  pulseFed(amount: number): void;
  /** Start the eat cooldown (sets active + duration, bumps the nonce). The bridge schedules the paired
   *  {@link endEatCooldown} after `ms`. */
  beginEatCooldown(ms: number): void;
  /** End the eat cooldown IF `nonce` is still the current one (a stale timer from a superseded cooldown
   *  is ignored). */
  endEatCooldown(nonce: number): void;
}

/** Initial state — sane defaults so the HUD renders before the first event lands. HP seeds to the
 *  player's full bar and hunger to full, matching a fresh run; live values overwrite on first tick. */
const initialState: HudState = {
  hp: PLAYER_MAX_HP,
  maxHp: PLAYER_MAX_HP,
  hunger: HUNGER_MAX,
  maxHunger: HUNGER_MAX,
  fire: null,
  supply: { wood: 0, rock: 0 },
  dayPhase: 'day',
  dayCount: 1,
  time: 0,
  waveInfo: { active: false },
  tasks: { current: null, pending: 0 },
  mode: 'command',
  buildMode: false,
  lineTool: false,
  runTally: { tileCount: 0, placeableCount: 0, affordableCount: 0, totalCost: {}, etaMs: 0 },
  selection: null,
  orientable: false,
  demolishMode: false,
  combatActive: false,
  inspectTarget: null,
  // Defaults mirror NpcCharacter's initial dayRole/nightPosture; overwritten each time the menu opens.
  companionMenu: { open: false, dayRole: 'gather', nightPosture: 'follow' },
  craftMenu: { open: false, benchId: null, hp: 0, maxHp: 0 },
  playerStats: null,
  inventory: {},
  equipment: { mainHand: null, ranged: null, offHand: null },
  hotbar: new Array<HotbarSlot>(HOTBAR_SLOTS).fill(null),
  following: true,
  zoom: 1,
  hitNonce: 0,
  sceneActive: false, // hidden until GameScene.create() flips the registry flag (see bridge)
  fedNonce: 0,
  fedAmount: 0,
  eatCooldownActive: false,
  eatCooldownMs: 0,
  eatCooldownNonce: 0,
};

export const useHudStore = create<HudState & HudActions>()(
  subscribeWithSelector((set) => ({
    ...initialState,
    setHp: (hp, maxHp) => set({ hp, maxHp }),
    pulseHit: () => set((s) => ({ hitNonce: s.hitNonce + 1 })),
    setHunger: (hunger, maxHunger) => set({ hunger, maxHunger }),
    setFire: (fire) => set({ fire }),
    setSupply: (supply) => set({ supply }),
    // A wave runs the whole night, so the banner keys off phase (no dedicated wave event exists).
    setTime: (dayPhase, dayCount, time) =>
      set({ dayPhase, dayCount, time, waveInfo: { active: dayPhase === 'night' } }),
    setTimeProgress: (time) => set({ time }),
    setTasks: (tasks) => set({ tasks }),
    setMode: (mode) => set({ mode }),
    setBuildMode: (buildMode) => set({ buildMode }),
    setLineTool: (lineTool) => set({ lineTool }),
    setRunTally: (runTally) => set({ runTally }),
    setSelection: (selection) =>
      set({
        selection,
        orientable: selection ? (BUILDABLES[selection]?.orientable ?? false) : false,
      }),
    setDemolishMode: (demolishMode) => set({ demolishMode }),
    setCombatActive: (combatActive) => set({ combatActive }),
    setInspect: (inspectTarget) => set({ inspectTarget }),
    openCompanionMenu: (dayRole, nightPosture) =>
      set({ companionMenu: { open: true, dayRole, nightPosture } }),
    closeCompanionMenu: () => set((s) => ({ companionMenu: { ...s.companionMenu, open: false } })),
    openCraftMenu: (benchId, hp, maxHp) => set({ craftMenu: { open: true, benchId, hp, maxHp } }),
    closeCraftMenu: () => set((s) => ({ craftMenu: { ...s.craftMenu, open: false } })),
    setPlayerStats: (playerStats) => set({ playerStats }),
    setInventory: (inventory) => set({ inventory }),
    setEquipment: (equipment) => set({ equipment }),
    setHotbar: (hotbar) => set({ hotbar }),
    pinToHotbar: (entry) =>
      set((s) => {
        if (s.hotbar.some((slot) => slot?.kind === entry.kind && slot.id === entry.id)) return s;
        const at = s.hotbar.indexOf(null);
        if (at === -1) return s; // bar full — no-op for now (Step 11 may add eviction)
        const hotbar = s.hotbar.slice();
        hotbar[at] = entry;
        return { hotbar };
      }),
    setFollowing: (following) => set({ following }),
    setZoom: (zoom) => set({ zoom }),
    setSceneActive: (sceneActive) => set({ sceneActive }),
    pulseFed: (amount) => set((s) => ({ fedNonce: s.fedNonce + 1, fedAmount: amount })),
    beginEatCooldown: (ms) =>
      set((s) => ({
        eatCooldownActive: true,
        eatCooldownMs: ms,
        eatCooldownNonce: s.eatCooldownNonce + 1,
      })),
    endEatCooldown: (nonce) =>
      set((s) => (s.eatCooldownNonce === nonce ? { eatCooldownActive: false } : s)),
  })),
);
