import type Phaser from 'phaser';
import { TILE_SIZE } from '../../config';
import type { CollisionFootprint, DecorObject } from '../../systems/mapFormat';
import { parseAssetId } from '../../render/assetPaths';
import { resolveDecorDraw } from '../../render/decorSprites';

/**
 * The editor's own `DEPTH_OBJECTS = 1000` (`EditorScene.ts`) sizes against an object-only depth
 * space with no actor layer to interleave with, so it can't be reused verbatim here. The live game
 * already has a small-integer depth convention instead — ground/tile layers `0..layers.length-1`
 * (`groundRenderer.drawMapLayers`), resource nodes + the campfire base at `~1`
 * (`ResourceNodeManager.addNode`, `CampfireManager`), actors `9..11` (`MonsterCharacter`/
 * `PlayerCharacter`), and an above-actor `OVERHEAD_LAYER_DEPTH = 20` (`groundRenderer.ts`). Decor
 * (static rocks, a bonfire prop) belongs in the same ground-clutter band as resource nodes, so
 * `DEPTH_OBJECTS` is `1` here, not `1000` — a decor's own small `obj.depth` (e.g. `-1`/`0` in
 * `test.map.json`) then lands right alongside nodes, below actors. Mirrors `groundRenderer.ts`'s
 * `OVERHEAD_LAYER_DEPTH` precedent for "no live runtime number exists yet, choose one with a
 * documented rationale"; revisit at plan 018 step A11's live wiring if it reads wrong.
 */
const DEPTH_OBJECTS = 1;

/**
 * Runtime decor renderer (plan 018 step A7) — the runtime-consumption counterpart to
 * `EditorScene.placeDecor` (read-only reference, never imported: the plan's editor guardrail keeps
 * this file importing only `src/render/decorSprites.ts` + `src/render/assetPaths.ts`, both already
 * editor-free — see their own module docs). Draws each authored `DecorObject` at its GLOBAL pixel
 * position (`originPx` + the object's map-local `x`/`y` — plan 018's global-tile-coords decision, so
 * plan 019's map streaming can place a second map's decor at a non-zero origin unchanged) and, for
 * any object carrying a `collision` footprint, folds that footprint into a `blocksAt(col,row)`
 * lookup — a blocked-cell SOURCE, analogous to `ResourceNodeManager.hasBlockingNode`, that A11
 * composites into the scene's `isBlocked` closure alongside build occupancy and map walkability.
 *
 * Assumes every decor texture this map references is already resident (`PreloadScene`, step A10) —
 * this class only ever DRAWS, it never queues a `load.image`/`load.spritesheet` itself.
 * `resolveDecorDraw` already no-ops (returns `undefined`) for a texture that somehow isn't resident,
 * so a missing asset is skipped cleanly rather than crashing the render pass.
 *
 * Construction is side-effect-free (no scene mutation, no listener registration) — call `render()`
 * explicitly once textures are confirmed loaded, mirroring `ResourceNodeManager`'s
 * constructor-vs-`loadNodes()` split.
 */
export class DecorManager {
  private readonly blocked = new Set<string>();

  constructor(private readonly scene: Phaser.Scene) {}

  /** Draw every decor object in `objects` (already filtered to `kind === 'decor'` by the caller, like
   *  `ResourceNodeManager.loadNodes`) at `originPx` + its own map-local pixel offset, and register any
   *  `collision` footprint into the blocked-cell set. Safe to call once per map load. */
  render(objects: DecorObject[], originPx: { x: number; y: number }): void {
    const originCol = originPx.x / TILE_SIZE;
    const originRow = originPx.y / TILE_SIZE;

    for (const obj of objects) {
      this.placeDecor(obj, originPx);
      if (obj.collision) {
        for (const cell of footprintCells(obj.collision, originCol, originRow)) {
          this.blocked.add(cellKey(cell.col, cell.row));
        }
      }
    }
  }

  /** True if a decor's authored `collision` footprint occupies this GLOBAL tile — composited into
   *  the scene's `isBlocked` closure (pathfinding + build placement) by A11, the same role
   *  `ResourceNodeManager.hasBlockingNode` already plays for resource nodes. */
  blocksAt(col: number, row: number): boolean {
    return this.blocked.has(cellKey(col, row));
  }

  /** Mirrors `EditorScene.placeDecor`'s draw logic exactly (asset resolve → per-`draw.kind` GameObject
   *  → transform → depth), less its `objectSprites`/`objectDisplayById` editor bookkeeping (this class
   *  owns no such index — nothing here needs to hit-test or re-select a placed decor at runtime). */
  private placeDecor(obj: DecorObject, originPx: { x: number; y: number }): void {
    let path: string;
    try {
      ({ path } = parseAssetId(obj.asset));
    } catch {
      return; // malformed asset id — maps are validated at authoring time; skip defensively, don't crash
    }

    const draw = resolveDecorDraw(this.scene, obj, path);
    if (!draw) return; // texture not resident (should be preloaded by A10) — skip cleanly

    const x = originPx.x + obj.x;
    const y = originPx.y + obj.y;

    let display: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
    if (draw.kind === 'anim') {
      const sprite = this.scene.add.sprite(x, y, draw.key);
      sprite.play(draw.animKey);
      display = sprite;
    } else if (draw.kind === 'region') {
      display = this.scene.add.image(x, y, draw.key, draw.frame);
    } else {
      display = this.scene.add.image(x, y, draw.key);
    }
    display.setScale(obj.scaleX, obj.scaleY);
    display.setAngle(obj.rotation); // degrees — see mapFormat's DecorObject doc
    display.setFlip(obj.flipX, obj.flipY);
    display.setDepth(DEPTH_OBJECTS + obj.depth);
  }
}

/** Deterministic `blocked` set key for a GLOBAL `(col,row)` tile. */
function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

/** Pure translation of a `CollisionFootprint` (map-LOCAL tile coords, top-left `col`/`row` + `w`×`h`
 *  extent — see `mapFormat.ts`'s `CollisionFootprint`) into the GLOBAL tile cells it occupies, given
 *  the map's tile-space origin (`originPx` converted to tile units by the caller). Factored out of
 *  `DecorManager` (which needs a live `Phaser.Scene` for everything else) so this one piece of real
 *  logic is unit-testable without a Phaser/DOM harness. */
export function footprintCells(
  footprint: CollisionFootprint,
  originCol: number,
  originRow: number,
): Array<{ col: number; row: number }> {
  const cells: Array<{ col: number; row: number }> = [];
  for (let dr = 0; dr < footprint.h; dr++) {
    for (let dc = 0; dc < footprint.w; dc++) {
      cells.push({ col: originCol + footprint.col + dc, row: originRow + footprint.row + dr });
    }
  }
  return cells;
}
