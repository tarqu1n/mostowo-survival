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
}

/** Stats every world thing (mover or object) shares. */
export interface BaseStats {
  maxHp: number;
  armour: number; // flat reduction to incoming damage
  speed: number; // px/s; 0 for anything that doesn't move
  vision?: number; // world-px sight/detection radius; omit if not applicable
}

/** Stats for things that fight (player, enemies). */
export interface CombatantStats extends BaseStats {
  strength: number; // flat bonus to melee damage dealt
  dex: number; // flat bonus to ranged damage dealt (unused this slice, no ranged weapon)
  dodge: number; // % subtracted from attacker's hit chance
}

/** Stats for inspectable-but-inert world objects (trees, walls). */
export interface ObjectStats extends BaseStats {
  activationRange?: number; // proximity trigger (traps etc.), unused this slice
}

/**
 * A harvestable world node (e.g. a tree, a rock). Yields an item per hit until depleted, then
 * regrows. The yield/render fields are generic over species so a rock is just another node def, not
 * a parallel system: `tile` selects the sprite role, and `tilesTall`/`originX`/`originY` size and
 * anchor it (a pine overhangs upward at ~2.6 tiles; a rock is ~1 tile, base-anchored) so no species
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
  /** Tileset sprite role this node renders as (`ACTIVE_TILESET.tiles[tile]`). */
  tile: 'tree' | 'rock';
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
}

/** The shape the Inspect-mode stats panel renders, regardless of what it's inspecting. */
export interface InspectableStats {
  name: string;
  maxHp: number;
  currentHp?: number;
  extra?: { label: string; value: string }[];
}
