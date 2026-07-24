/**
 * Pure math for a Blueprint-Mode **pending run** (plan 050 Step 5) — the ordered set of tiles a
 * drag-to-place gesture would blueprint, with placeability + cumulative affordability + a serial ETA.
 * Phaser-free (no scene deps) so it unit-tests as plain Node, mirroring `tasks`/`orders`: `BuildManager`
 * owns the run STATE (anchor, the live tile list, the ghost pool) and delegates every calculation here.
 *
 * Straight runs only: a drag from the anchor snaps to its dominant axis (row vs column), so the run is
 * always one axis-locked line — inherently deduped (a straight line repeats no tile). A run that hasn't
 * left the anchor is a length-1 run, so the single-tap placement path is just the degenerate case.
 */

import type { Cell } from './pathfind';
import type { FacingSpec } from '../entities/types';

/** One tile in a pending run: its grid cell plus the placement facing stamped on it (the run's facing;
 *  `undefined` for a non-orientable buildable). Shape mirrors the eventual {@link BuildSite}. */
export interface RunTile {
  col: number;
  row: number;
  facing?: FacingSpec;
}

/** Which axis a straight run extends ALONG, relative to its anchor. `'horizontal'` = every tile shares
 *  the anchor's row and the column varies; `'vertical'` = shares the column, the row varies. */
export type RunAxis = 'horizontal' | 'vertical';

/**
 * Dominant drag axis from `anchor` to `tile`: horizontal when the column delta is at least the row delta
 * (a tie — incl. the zero-length anchor-only drag — favours horizontal), else vertical. The lock is
 * measured against the anchor, so mid-drag jitter on the minor axis never flips a settled run.
 */
export function runAxis(anchor: Cell, tile: Cell): RunAxis {
  return Math.abs(tile.col - anchor.col) >= Math.abs(tile.row - anchor.row)
    ? 'horizontal'
    : 'vertical';
}

/**
 * The ordered, axis-locked straight line of tiles from `anchor` out to the drag `tile`. The drag is
 * projected onto its dominant axis vs the anchor (see {@link runAxis}), so a diagonal drag snaps to one
 * line — no L-shapes, no gaps. `anchor` is always `tiles[0]`; an anchor-only (or exact-repeat) drag
 * yields a length-1 run. Inherently deduped. `facing` is stamped on every tile.
 */
export function runTiles(anchor: Cell, tile: Cell, facing?: FacingSpec): RunTile[] {
  const tiles: RunTile[] = [];
  if (runAxis(anchor, tile) === 'horizontal') {
    const step = Math.sign(tile.col - anchor.col) || 1;
    for (let col = anchor.col; ; col += step) {
      tiles.push({ col, row: anchor.row, facing });
      if (col === tile.col) break;
    }
  } else {
    const step = Math.sign(tile.row - anchor.row) || 1;
    for (let row = anchor.row; ; row += step) {
      tiles.push({ col: anchor.col, row, facing });
      if (row === tile.row) break;
    }
  }
  return tiles;
}

/** Inputs to {@link selectRun}: the run's tiles, a parallel placeability flag array, the per-tile cost
 *  (one buildable for the whole run), the held-item snapshot, and the serial per-tile build time. */
export interface RunSelectionInput {
  tiles: readonly RunTile[];
  /** Parallel to `tiles`: whether each tile can host the buildable (BuildManager's `tilePlaceable`). */
  placeable: readonly boolean[];
  /** Per-tile cost — item id → quantity consumed to build ONE tile (same across the run). */
  cost: Readonly<Record<string, number>>;
  /** Held item counts (an `Inventory` snapshot). */
  inventory: Readonly<Record<string, number>>;
  /** On-site worker build time (ms) per tile — summed serially over the affordable subset for the ETA. */
  buildTimeMs: number;
}

/** The Step-5 pending-run selector shape: the tiles, how many are placeable / affordable, the total
 *  cost of the affordable subset, and the serial build ETA over that subset. */
export interface RunSelection {
  tiles: readonly RunTile[];
  /** How many tiles in the run can be placed (in-bounds, empty, reachable …) — a diagnostic count,
   *  independent of budget; a placeable tile can still fall beyond {@link affordableCount}. */
  placeableCount: number;
  /** Length of the affordable PREFIX: the largest N such that tiles 1..N cost cumulatively fit
   *  `inventory` (each tile charges its cost; costs are positive, so affordability is a prefix).
   *  Orthogonal to placeability — the render layer combines the two (valid = affordable prefix AND
   *  placeable). */
  affordableCount: number;
  /** Cumulative cost of the affordable subset (item id → qty) — what a commit would spend at most. */
  totalCost: Record<string, number>;
  /** Serial build time (ms) over the affordable subset = `affordableCount * buildTimeMs`. */
  etaMs: number;
}

/**
 * Compute the {@link RunSelection} for a pending run. `placeableCount` counts the placeable tiles.
 * `affordableCount` walks the run in order accumulating cost — tile N is affordable only if tiles 1..N
 * together still fit `inventory` (every tile charges, placeability aside; the render layer ANDs the two).
 * `totalCost` is the affordable subset's cumulative cost and `etaMs` its serial build time. Pure —
 * mutates nothing (no spend), so building a run costs no resources here.
 */
export function selectRun({
  tiles,
  placeable,
  cost,
  inventory,
  buildTimeMs,
}: RunSelectionInput): RunSelection {
  const placeableCount = placeable.reduce((n, ok) => n + (ok ? 1 : 0), 0);

  const costEntries = Object.entries(cost);
  const running: Record<string, number> = {};
  let affordableCount = 0;
  for (let i = 0; i < tiles.length; i++) {
    const fits = costEntries.every(([id, qty]) => (running[id] ?? 0) + qty <= (inventory[id] ?? 0));
    if (!fits) break; // positive costs ⇒ once a tile can't be afforded, neither can the rest
    for (const [id, qty] of costEntries) running[id] = (running[id] ?? 0) + qty;
    affordableCount++;
  }

  const totalCost: Record<string, number> = {};
  for (const [id, qty] of costEntries) totalCost[id] = qty * affordableCount;

  return {
    tiles,
    placeableCount,
    affordableCount,
    totalCost,
    etaMs: affordableCount * buildTimeMs,
  };
}
