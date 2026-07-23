/**
 * Data-driven content types. Items, resource nodes, and buildables are plain data
 * (see src/data/*.ts); adding content means editing those records, not the systems.
 */

import type { LootTable } from '../systems/loot';

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
 * A combatant's body extent **in tiles**, for combat targeting (Attack/Inspect hit-tests, contact
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

/**
 * A weapon's melee attack footprint **in tiles**, oriented to a cardinal-snapped facing (diagonal
 * facings snap to their dominant axis inside the generator). Independent of the target's `Hurtbox`:
 * this is the set of tiles the swing *covers*, resolved by `attackTiles` in `src/systems/hurtbox.ts`.
 * - `reach` — forward depth in tiles from the attacker's feet (clamped to `≥1`; the feet tile itself
 *   is never covered). `reach:1` reaches the one tile directly in front.
 * - `arc` — lateral profile of the swing:
 *   - `'single'` — just the tip tile at `reach` (a thrust). `{reach:1, arc:'single'}` = today's one
 *     front tile.
 *   - `'line'` — the full straight column from the feet out to `reach` (a spear that hits everything
 *     in its path).
 *   - `'wide'` — a 3-wide swath (front tile plus its two perpendicular neighbours) to depth `reach`.
 */
export interface AttackShape {
  reach: number; // forward depth in tiles (≥1)
  arc: 'single' | 'wide' | 'line'; // lateral profile of the swing
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
 * a parallel system: each def carries interchangeable `skins` (art — see `ParsedNodeDef` in
 * `src/systems/nodeDefs.ts`) naming their own catalog sprite, and `scale`/`originX`/`originY`
 * size and anchor it (a pine renders at its native size, a rock base-anchored) so no species
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
  /** In-place harvest animation the player plays (default `'chop'`, axe); a rock uses `'mine'`
   *  (pickaxe) and a bush `'gather'` (forage). Was previously inferred from the retired `tile` role;
   *  now authored explicitly (plan 021 step 6). `'savage'` (scavenging a tent wreck) reuses the
   *  `gather` player/fx motion as a stand-in until a bespoke savage strip lands — see
   *  `harvestAnimToSwing` (GameScene) and the fx-kind mapping (NodeFxManager). */
  harvestAnim?: 'chop' | 'gather' | 'mine' | 'savage';
  /**
   * When present, each harvest hit rolls THIS loot table (a predefined item set) instead of
   * yielding the fixed `yieldItemId`/`yieldPerHit` — the "savage" action (scavenge a wrecked tent).
   * `yieldItemId`/`yieldPerHit` stay required by the schema (and remain the fallback for any hit if
   * a future def sets both) but are ignored while `loot` is set. See `src/systems/loot.ts`.
   */
  loot?: LootTable;
  /** Display scale — a multiplier on the source sprite's native pixels (`1.0` = native size). The
   *  art pack is authored at the game's `TILE_SIZE`, so native scale keeps pixels crisp and
   *  preserves each skin's relative size. Resolved (defaulted to 1.0) by `parseNodeDefs`. */
  scale: number;
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
  /** Light/vision radius in **tiles** this structure casts once built; omit for non-light-sources. */
  light?: number;
  /** Restricts placement to the base zone (see config.BASE_ZONE_SIZE); omit to allow placement anywhere. */
  baseOnly?: boolean;
  /** Whether this structure occupies its tile and blocks movement/pathing; omit ⇒ not yet decided (a later step defaults it). */
  blocksPath?: boolean;
  /** Runtime-behavior key: a buildable with a `behavior` is *live/simulated* (per-frame tick, tap,
   *  light, …) and is handed to a runtime manager on completion; omit ⇒ an inert static-tile buildable
   *  (e.g. the wall). This is the live-vs-static discriminant (distinct from `animKey`, which is purely
   *  visual). Today the only value is `'campfire'`; a future StructureManager registry keys off it —
   *  see docs/DECISIONS.md "generalise buildable runtime on buildable #2". */
  behavior?: string;
  /** Purely visual: if present, the buildable's sprite is this animated manifest key (not a static
   *  tile). Independent of `behavior` (a buildable can be simulated without being animated, or vice
   *  versa) — though today the campfire is the only one and is both. */
  animKey?: string;
  /** Retaliation damage a mob takes when it *attacks* this structure (only spiky walls set it, so a
   *  plain wall never retaliates) — consumed by the enemy-attack chunk (plan 037 2c); omit ⇒ no thorns. */
  thorns?: number;
  /** Marks a buildable whose placement facing can be rotated by the player before placing (plan 037):
   *  each placed instance stores its own `facing`. The wall sets it; omit ⇒ a fixed-orientation buildable. */
  orientable?: boolean;
  /** Which HUD build-catalog tab this buildable lives under (plan 046). `craft` is reserved for future
   *  content — no `craft` buildable exists yet, so the catalog renders a tab only per category with ≥1
   *  entry. Omit ⇒ untabbed (defaults handled by the catalog). */
  readonly category?: 'defense' | 'survival' | 'craft';
  /** Height (in tiles) the sprite is scaled to stand — for multi-tile animated buildables. */
  tilesTall?: number;
  /** Sprite anchor Y (mirrors ResourceNodeDef.originY) — bottom-anchored so a tall structure overhangs upward. */
  originY?: number;
}

/** An enemy catalogue entry — a combatant with a name/id/placeholder tint. */
export interface EnemyDef extends CombatantStats {
  id: string;
  name: string;
  color: number; // placeholder tint until the real sprite is wired (Step 2)
  /**
   * Rendering path this enemy uses. `'flip3'` (the default when omitted) = the skeleton's
   * single-orientation Run strip with facing faked by `setFlipX` (art in `ACTIVE_TILESET.actors.enemy`);
   * `'dir4'` = a 4-way directional creature with a distinct strip per facing, keyed by `id` under
   * `ACTIVE_TILESET.actors.directional` (see {@link DirectionalEnemyActor}). Omitted on `kidZombie` so
   * the skeleton is unaffected.
   */
  actorKind?: 'flip3' | 'dir4';
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
