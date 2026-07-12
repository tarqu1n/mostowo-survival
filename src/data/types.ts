/**
 * Data-driven content types. Items, resource nodes, and buildables are plain data
 * (see src/data/*.ts); adding content means editing those records, not the systems.
 */

/** An inventory item. `color` is the placeholder icon/rect colour (hex number). */
export interface ItemDef {
  id: string;
  name: string;
  color: number;
  /** Max units that fit in one inventory slot; overflow spills into the next free slot. */
  maxStack: number;
  /** Icon filename relative to `public/assets/icons/` (e.g. `wood.png`); loaded as `icon:<id>`. */
  icon: string;
  /** Hunger restored per unit when eaten. Present ⇒ the item is edible; omit for inedible items. */
  nutrition?: number;
}

/** Stats every world thing (mover or object) shares. */
export interface BaseStats {
  maxHp: number;
  armour: number; // flat reduction to incoming damage
  speed: number; // px/s; 0 for anything that doesn't move
  vision?: number; // world-px sight/detection radius; omit if not applicable
}

/**
 * A combatant's body extent **in tiles**, for combat targeting (Punch/Inspect hit-tests, contact
 * reach) — NOT collision/occupancy, which stays a single tile (the feet). Anchored at the feet tile,
 * centred horizontally on the feet column and rising **upward** (lower rows), matching how actors are
 * drawn: feet at the bottom, body/head above. So a ~2-tile-tall sprite uses `{ width: 1, height: 2 }`
 * — its torso tile is hittable even though it logically stands on one tile. Sizes are data so a small
 * critter (`{1,1}`) or a large ogre (`{2,3}`) each declare their own. Even widths extend one to the
 * right of centre. See `src/systems/hurtbox.ts` (`DEFAULT_HURTBOX` = `{1,1}`).
 */
export interface Hurtbox {
  width: number; // tiles wide, centred on the feet column
  height: number; // tiles tall, counted up from the feet row (1 = feet tile only)
}

/** Stats for things that fight (player, enemies). */
export interface CombatantStats extends BaseStats {
  strength: number; // flat bonus to melee damage dealt
  dex: number; // flat bonus to ranged damage dealt (unused this slice, no ranged weapon)
  dodge: number; // % subtracted from attacker's hit chance
  hurtbox?: Hurtbox; // body extent for targeting; omit → DEFAULT_HURTBOX (single feet tile)
}

/** Stats for inspectable-but-inert world objects (trees, walls). */
export interface ObjectStats extends BaseStats {
  activationRange?: number; // proximity trigger (traps etc.), unused this slice
}

/**
 * A harvestable world node (e.g. a tree, a rock). Yields an item per hit until depleted, then
 * regrows. The yield/render fields are generic over species so a rock is just another node def, not
 * a parallel system: `tile` selects the sprite role, and `tilesTall`/`originX`/`originY` size and
 * anchor it (a pine towers upward at ~5 tiles; a rock is ~1 tile, base-anchored) so no species
 * inherits another's footprint. See docs/CONVENTIONS.md (data-driven content).
 */
export interface ResourceNodeDef extends ObjectStats {
  id: string;
  name: string;
  /** Item id produced per hit. */
  yieldItemId: string;
  /** Units of `yieldItemId` produced per hit. */
  yieldPerHit: number;
  regrowMs: number;
  color: number;
  stumpColor: number;
  /**
   * Whether this node blocks its tile for routing and build-placement. Trees/rocks are `true`
   * (obstacles the worker paths around and can't build over); a low bush is `false` — the worker
   * walks *through* it and may build over it, yet still harvests from an adjacent tile.
   */
  blocksPath: boolean;
  /** In-place harvest animation the player plays (default `'chop'`); a bush uses `'gather'` (forage). */
  harvestAnim?: 'chop' | 'gather';
  /** Tileset sprite role this node renders as (`ACTIVE_TILESET.tiles[tile]`). */
  tile: 'tree' | 'rock' | 'bush';
  /** Height (in tiles) the sprite is scaled to stand. */
  tilesTall: number;
  /** Sprite anchor — trees anchor near their base so the canopy overhangs up; a rock sits centred. */
  originX: number;
  originY: number;
  /**
   * Neighbour offsets the worker may stand on to harvest this node. Omit for all-adjacent (a ~1-tile
   * rock); a tall tree restricts to its base so the worker never stands inside the overhanging canopy.
   */
  standOffsets?: ReadonlyArray<readonly [number, number]>;
}

/** A placeable structure. `cost` maps item id → quantity consumed on build. */
export interface BuildableDef extends ObjectStats {
  id: string;
  name: string;
  cost: Record<string, number>;
  color: number;
}

/** An enemy catalogue entry — a combatant with a name/id/placeholder tint. */
export interface EnemyDef extends CombatantStats {
  id: string;
  name: string;
  color: number; // placeholder tint until the real sprite is wired (Step 2)
  /**
   * Weapon ids this enemy may spawn holding — keys shared by data/weapons.ts (MONSTER_WEAPONS stats)
   * and the manifest weapons catalogue (art). One is rolled per spawn (Phase B); empty/undefined =
   * unarmed (contact bite only, UNARMED_BASE_DAMAGE).
   */
  weaponPool?: string[];
}

/** The shape the Inspect-mode stats panel renders, regardless of what it's inspecting. */
export interface InspectableStats {
  name: string;
  maxHp: number;
  currentHp?: number;
  extra?: { label: string; value: string }[];
}
