import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { PLAYER_MAX_HP, HUNGER_MAX } from '@/config';
import { BUILDABLES } from '@/data/buildables';
import type { InspectableStats } from '@/data/types';

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
  /** Currently selected buildable id, or `null` when nothing is selected. */
  selection: string | null;
  /** Whether {@link selection} can be rotated at placement (derived from `BUILDABLES`). */
  orientable: boolean;
  demolishMode: boolean;
  combatActive: boolean;
  inspectTarget: InspectableStats | null;
  /** Aggregate item counts by id (the `Inventory.snapshot()` shape). */
  inventory: Record<string, number>;
  hotbar: HotbarSlot[];
  following: boolean;
  zoom: number;
  /** Monotonic counter bumped on every `player:hit`. `player:hit` is a transient event with no
   *  payload; a counter lets the damage-vignette layer (Step 9) react to each hit via a store read. */
  hitNonce: number;
}

/** Imperative setters the bridge calls; grouped so components never mutate state directly. */
export interface HudActions {
  setHp(hp: number, maxHp: number): void;
  pulseHit(): void;
  setHunger(hunger: number, maxHunger: number): void;
  setFire(fire: FireState | null): void;
  setSupply(supply: SupplyState): void;
  setTime(phase: 'day' | 'night', dayCount: number, time: number): void;
  setTasks(tasks: TaskSummary): void;
  setMode(mode: HudMode): void;
  setBuildMode(on: boolean): void;
  /** Select a buildable (or `null` to clear). Recomputes {@link HudState.orientable} from data. */
  setSelection(id: string | null): void;
  setDemolishMode(on: boolean): void;
  setCombatActive(on: boolean): void;
  setInspect(target: InspectableStats | null): void;
  setInventory(inventory: Record<string, number>): void;
  setHotbar(hotbar: HotbarSlot[]): void;
  setFollowing(on: boolean): void;
  setZoom(zoom: number): void;
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
  selection: null,
  orientable: false,
  demolishMode: false,
  combatActive: false,
  inspectTarget: null,
  inventory: {},
  hotbar: new Array<HotbarSlot>(HOTBAR_SLOTS).fill(null),
  following: true,
  zoom: 1,
  hitNonce: 0,
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
    setTasks: (tasks) => set({ tasks }),
    setMode: (mode) => set({ mode }),
    setBuildMode: (buildMode) => set({ buildMode }),
    setSelection: (selection) =>
      set({
        selection,
        orientable: selection ? (BUILDABLES[selection]?.orientable ?? false) : false,
      }),
    setDemolishMode: (demolishMode) => set({ demolishMode }),
    setCombatActive: (combatActive) => set({ combatActive }),
    setInspect: (inspectTarget) => set({ inspectTarget }),
    setInventory: (inventory) => set({ inventory }),
    setHotbar: (hotbar) => set({ hotbar }),
    setFollowing: (following) => set({ following }),
    setZoom: (zoom) => set({ zoom }),
  })),
);
