import Phaser from 'phaser';
import {
  NIGHT_MS,
  NIGHT_WAVE_BEATS,
  WAVE_SPAWN_DIR,
  WAVE_SPAWN_RADIUS,
  WAVE_SPAWN_SPREAD,
} from '../../config';
import type { Cell, Dims } from '../../systems/pathfind';
import type { DayPhase } from '../../systems/daynight';
import {
  escalationForNight,
  intervalForNightProgress,
  spawnKindForIndex,
  type NightEscalation,
} from '../../systems/wave';
import type { MonsterSpawnOpts } from '../../entities/MonsterCharacter';
import type { GameScene } from '../GameScene';

/**
 * Narrow scene state {@link WaveDirector} needs but doesn't own — GameScene supplies these as closures
 * over its own fields/managers at construction (plan 013/015 coupling rules: managers get narrow
 * interfaces, never a direct manager↔manager edge — the scene mediates). `spawnEnemy` forwards to
 * `EnemyManager.addEnemy`; `defendCentre` is the tile the wave converges on + spawns *away from* (the
 * nearest lit hearth, else the player); `rng` is the scene's injectable rng so the DEV test API's
 * pinned rng makes spawn placement deterministic.
 */
export interface WaveDirectorDeps {
  /** Spawn one enemy of `id` at a tile (→ `EnemyManager.addEnemy`), with spawn opts (the wave passes
   *  the fire objective, plan 038 Step 4). */
  spawnEnemy(id: string, col: number, row: number, opts?: MonsterSpawnOpts): void;
  /** Grid bounds — spawn tiles are clamped into these. */
  dims(): Dims;
  /** Pathfinding walkability predicate (the scene's `isBlocked`) — spawn only on walkable tiles. */
  isBlocked(col: number, row: number): boolean;
  /** The tile the wave defends against / emerges around: nearest lit hearth, else the player tile. */
  defendCentre(): Cell;
  /** Injectable rng (the scene's `this.rng`) — threaded so a pinned test rng makes spawns deterministic. */
  rng(): number;
  /** Current phase + in-game day number. `phase` is read on the first tick to reconcile a scenario
   *  seeded straight into night (which emits no `time:changed`; see {@link tick}); `dayCount` keys the
   *  per-night escalation captured at {@link beginWave} (loop-close: each survived night is harder). */
  dayContext(): { phase: DayPhase; dayCount: number };
}

/**
 * The night wave (plan 038 Step 3) — a paced spawn scheduler layered over the existing day/night clock
 * + `EnemyManager`, per GAME-DESIGN's "the wave is a paced scheduler over existing spawn/AI, not new
 * combat." A wave runs for the duration of the **night** phase: skeletons trickle → push → lull out of
 * the "treeline" (a fixed direction off the defended centre — see config `WAVE_SPAWN_*`), path in, and
 * (once Step 4's objective AI lands) attack the fire / player. At dawn the director stops spawning but
 * **leftover mobs remain** ("the lull is a trap"). The fire is not a loss condition (plan 038
 * decisions #1/#2) — the wave's job is pressure + the dark, not a fire-kill fail state.
 *
 * **Phase edges vs seeds (critique #1).** `SurvivalClock` emits `time:changed` only on a phase/day
 * *transition*, so `GameScene.wireBus` routes that event here ({@link onTimeChanged}) to start/stop
 * waves as the clock crosses dusk/dawn. But `applyScenario` can seed the clock *straight into night*
 * without any transition event — so {@link tick} also **reconciles the current phase on its first
 * run**, starting a wave if it's already night. {@link beginWave} is idempotent so the two paths never
 * double-start.
 *
 * **World-manager convention.** Constructed fresh in `buildWorld()` each (re)start (after
 * `SurvivalClock`), side-effect-free — its `time:changed` subscription is wired by `GameScene.wireBus`
 * (with the matching SHUTDOWN `off`), not here. `tick(delta)` runs from `GameScene.update` **above** the
 * no-action early-return (but below the `playerChar.dying` freeze, so no spawns land during the death
 * beat). {@link reset} clears wave state for the DEV scenario reset; {@link destroy} (SHUTDOWN) only
 * drops references — it never pokes a sprite (see `EnemyManager`'s SHUTDOWN note).
 */
export class WaveDirector {
  /** A wave is currently running (night). Spawns only happen while true. */
  private active = false;
  /** Has the first-tick phase reconcile run this (re)start / scenario? */
  private reconciled = false;
  /** ms since the current wave began — drives the pacing curve's night progress. */
  private elapsedMs = 0;
  /** ms accumulated toward the next spawn (the chop-interval accumulator idiom). */
  private sinceSpawnMs = 0;
  /** How many enemies this wave has spawned (drives boar composition + surfaced for tests/HUD later). */
  private spawnedThisWave = 0;
  /** This wave's escalation shape, captured at {@link beginWave} from the in-game day (loop-close). */
  private escalation: NightEscalation = escalationForNight(1);

  constructor(
    scene: GameScene,
    private readonly deps: WaveDirectorDeps,
  ) {
    // No sprites/timers of our own to tear down (spawned enemies belong to EnemyManager) — just drop
    // references on SHUTDOWN. The time:changed listener is off'ed by GameScene.wireBus.
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  // --- Phase wiring (subscribed by GameScene.wireBus) ------------------------------

  /** `time:changed` handler: night → start a wave, day → end it. Idempotent via {@link beginWave}. */
  onTimeChanged({ phase }: { phase: DayPhase }): void {
    if (phase === 'night') this.beginWave();
    else this.endWave();
  }

  /** Start a wave now — night's edge, OR the dev/test force-wave seam (plan 038 Step 6). Idempotent:
   *  a no-op if one's already running, so the phase event + the first-tick reconcile can't double-start.
   *  Spawns one enemy immediately so the wave visibly *begins* rather than waiting out the first beat. */
  beginWave(): void {
    if (this.active) return;
    this.active = true;
    this.elapsedMs = 0;
    this.sinceSpawnMs = 0;
    this.spawnedThisWave = 0;
    // Loop-close/escalation (plan 038 Step 5): key this wave's shape off the in-game day — later nights
    // open with a bigger rush, pace denser, and mix in boars. Captured once so the wave is stable even
    // if the clock rolls over mid-wave.
    this.escalation = escalationForNight(this.deps.dayContext().dayCount);
    for (let i = 0; i < this.escalation.openingBurst; i++) this.spawnOne();
  }

  /** End the wave — stop spawning. Leftover mobs are deliberately NOT despawned ("the lull is a trap"). */
  private endWave(): void {
    this.active = false;
  }

  // --- Per-frame tick --------------------------------------------------------------

  /** Advance the wave: reconcile a night-seeded scenario on the first tick, then (while active) meter
   *  out spawns on the pacing curve. Called every frame above GameScene's no-action early-return. */
  tick(delta: number): void {
    if (!this.reconciled) {
      this.reconciled = true;
      if (this.deps.dayContext().phase === 'night') this.beginWave();
    }
    if (!this.active) return;
    this.elapsedMs += delta;
    this.sinceSpawnMs += delta;
    const interval = this.currentIntervalMs();
    // `while` (not `if`) so a large refocus/step delta that skips several intervals still spawns each;
    // bounded since it decrements by `interval > 0` each pass.
    while (this.sinceSpawnMs >= interval) {
      this.sinceSpawnMs -= interval;
      this.spawnOne();
    }
  }

  /** The spawn interval for the current point in the night, from the `NIGHT_WAVE_BEATS` pacing curve
   *  (trickle → push → lull) scaled by this night's escalation (denser later). Night progress is
   *  `elapsedMs / NIGHT_MS`, clamped to [0,1]. */
  private currentIntervalMs(): number {
    return intervalForNightProgress(
      this.elapsedMs / NIGHT_MS,
      NIGHT_WAVE_BEATS,
      this.escalation.intervalScale,
    );
  }

  private spawnOne(): void {
    const tile = this.pickSpawnTile();
    // Composition escalates (plan 038 Step 5): later nights mix boars into the skeleton stream. Wave
    // mobs seek + attack the fire-heart (plan 038 Step 4); player-acquire still preempts.
    const id = spawnKindForIndex(this.spawnedThisWave, this.escalation.boarEvery);
    this.deps.spawnEnemy(id, tile.col, tile.row, { objective: 'fire' });
    this.spawnedThisWave++;
  }

  /**
   * Pick a walkable spawn tile out of the "treeline": from the defended centre, step `WAVE_SPAWN_RADIUS`
   * tiles in `WAVE_SPAWN_DIR` and jitter laterally (perpendicular to DIR) up to `WAVE_SPAWN_SPREAD`.
   * Samples several jittered candidates and takes the first walkable, in-bounds one; if the biased side
   * is walled off (e.g. water north of camp), it spirals outward for ANY walkable ring tile so a wave
   * never silently fails to spawn. Deterministic under a pinned rng.
   */
  private pickSpawnTile(): Cell {
    const c = this.deps.defendCentre();
    const dims = this.deps.dims();
    const { dCol, dRow } = WAVE_SPAWN_DIR;
    // Unit vector perpendicular to DIR, for the lateral spread along the edge.
    const perp = { dCol: -dRow, dRow: dCol };
    const clampCell = (col: number, row: number): Cell => ({
      col: Phaser.Math.Clamp(col, 0, dims.cols - 1),
      row: Phaser.Math.Clamp(row, 0, dims.rows - 1),
    });

    // First choice: the biased treeline direction with lateral jitter.
    for (let i = 0; i < 12; i++) {
      const lateral = Math.round((this.deps.rng() * 2 - 1) * WAVE_SPAWN_SPREAD);
      const along = WAVE_SPAWN_RADIUS + Math.round((this.deps.rng() - 0.5) * 4); // ±2 depth wobble
      const t = clampCell(
        c.col + dCol * along + perp.dCol * lateral,
        c.row + dRow * along + perp.dRow * lateral,
      );
      if (!this.deps.isBlocked(t.col, t.row)) return t;
    }

    // Fallback: the biased side is blocked off — spiral out on an expanding box ring for any walkable
    // tile (keeps a wave alive on maps where the treeline direction is water/void).
    for (let r = 1; r <= Math.max(dims.cols, dims.rows); r++) {
      for (let a = -r; a <= r; a++) {
        for (const t of [
          clampCell(c.col + a, c.row - r),
          clampCell(c.col + a, c.row + r),
          clampCell(c.col - r, c.row + a),
          clampCell(c.col + r, c.row + a),
        ]) {
          if (!this.deps.isBlocked(t.col, t.row)) return t;
        }
      }
    }
    return c; // degenerate: nothing walkable anywhere — spawn on the centre (should never happen)
  }

  // --- Reset / teardown ------------------------------------------------------------

  /** DEV scenario reset (runtime): clear all wave state so a fresh scenario never inherits a running
   *  wave. The next tick re-reconciles against the scenario's seeded phase. */
  reset(): void {
    this.active = false;
    this.reconciled = false;
    this.elapsedMs = 0;
    this.sinceSpawnMs = 0;
    this.spawnedThisWave = 0;
    this.escalation = escalationForNight(1); // day-1 baseline for a fresh scenario
  }

  /** SHUTDOWN: only drops references (the `time:changed` listener is `off`ed by GameScene.wireBus). No
   *  sprites are owned here — the spawned enemies belong to EnemyManager — so there's nothing to destroy. */
  private destroy(): void {
    this.active = false;
  }
}
