/**
 * Active environment tileset, as a swappable manifest. Scenes only ever reference the abstract
 * tile/actor roles below (`dirt`, `wall`, ...) — never a pack's folder/file names directly — so
 * trying a different pack (a different AI-gen batch, a different CC0 pack) means adding a new
 * manifest below and pointing `ACTIVE_TILESET` at it, with no changes to PreloadScene/GameScene.
 */

/** Abstract roles the game code asks for. Add a role here + fill it in every manifest. */
export interface TilesetManifest {
  /** Pack id — must match its folder under public/assets/tilesets/<id>/. */
  id: string;
  tiles: {
    /**
     * Ground variants, relative to `sprites/`, each with a relative pick `weight` — GameScene
     * scatters these per-tile so a couple of rarer "debris" variants sprinkle in for texture
     * without dominating the floor (their dark marks read as much busier than a plain tile's
     * faint dots, so they need a much lower weight, not just "less common"). Needs at least one
     * entry; any length/weights work.
     */
    dirt: Array<{ path: string; weight: number }>;
    wall: string;
    tree: string;
  };
  actors: {
    /** Walk-cycle frames, relative to `sprites/`. Frame 0 doubles as the idle pose. */
    player: string[];
    /** Kid zombie walk-cycle frames, relative to `sprites/`. Frame 0 doubles as the idle pose. */
    kidZombie: string[];
    /** Kid zombie "damaged" (hit-reaction) frames, relative to `sprites/`. */
    kidZombieDamaged: string[];
  };
}

export const ZOMBIE_APOCALYPSE_TILESET: TilesetManifest = {
  id: 'zombie-apocalypse',
  tiles: {
    dirt: [
      { path: 'terrain-variations/Zombie-Tileset---_0077_Capa-78.png', weight: 14 }, // plain
      { path: 'terrain-variations/Zombie-Tileset---_0078_Capa-79.png', weight: 14 }, // plain
      { path: 'terrain-variations/Zombie-Tileset---_0079_Capa-80.png', weight: 1 }, // light debris marks
      { path: 'terrain-variations/Zombie-Tileset---_0080_Capa-81.png', weight: 1 }, // heavier rubble
    ],
    wall: 'terrain-wall/Zombie-Tileset---_0064_Capa-65.png',
    tree: 'trees/Zombie-Tileset---_0134_Capa-135.png',
  },
  actors: {
    player: [
      'player-character-walking-animation-frames/Zombie-Tileset---_0476_Capa-477.png',
      'player-character-walking-animation-frames/Zombie-Tileset---_0477_Capa-478.png',
      'player-character-walking-animation-frames/Zombie-Tileset---_0478_Capa-479.png',
      'player-character-walking-animation-frames/Zombie-Tileset---_0479_Capa-480.png',
      'player-character-walking-animation-frames/Zombie-Tileset---_0480_Capa-481.png',
      'player-character-walking-animation-frames/Zombie-Tileset---_0481_Capa-482.png',
      'player-character-walking-animation-frames/Zombie-Tileset---_0482_Capa-483.png',
      'player-character-walking-animation-frames/Zombie-Tileset---_0483_Capa-484.png',
      'player-character-walking-animation-frames/Zombie-Tileset---_0484_Capa-485.png',
    ],
    kidZombie: [
      'kid-zombie-animation-frames/Zombie-Tileset---_0430_Capa-431.png',
      'kid-zombie-animation-frames/Zombie-Tileset---_0431_Capa-432.png',
      'kid-zombie-animation-frames/Zombie-Tileset---_0432_Capa-433.png',
      'kid-zombie-animation-frames/Zombie-Tileset---_0433_Capa-434.png',
      'kid-zombie-animation-frames/Zombie-Tileset---_0434_Capa-435.png',
      'kid-zombie-animation-frames/Zombie-Tileset---_0435_Capa-436.png',
      'kid-zombie-animation-frames/Zombie-Tileset---_0436_Capa-437.png',
      'kid-zombie-animation-frames/Zombie-Tileset---_0437_Capa-438.png',
      'kid-zombie-animation-frames/Zombie-Tileset---_0438_Capa-439.png',
    ],
    kidZombieDamaged: [
      'damaged-kid-zombie-animation-frames/Zombie-Tileset---_0439_Capa-440.png',
      'damaged-kid-zombie-animation-frames/Zombie-Tileset---_0440_Capa-441.png',
      'damaged-kid-zombie-animation-frames/Zombie-Tileset---_0441_Capa-442.png',
      'damaged-kid-zombie-animation-frames/Zombie-Tileset---_0442_Capa-443.png',
      'damaged-kid-zombie-animation-frames/Zombie-Tileset---_0443_Capa-444.png',
      'damaged-kid-zombie-animation-frames/Zombie-Tileset---_0444_Capa-445.png',
      'damaged-kid-zombie-animation-frames/Zombie-Tileset---_0445_Capa-446.png',
      'damaged-kid-zombie-animation-frames/Zombie-Tileset---_0446_Capa-447.png',
      'damaged-kid-zombie-animation-frames/Zombie-Tileset---_0447_Capa-448.png',
    ],
  },
};

/** Swap this to trial a different pack — see the module doc above. */
export const ACTIVE_TILESET: TilesetManifest = ZOMBIE_APOCALYPSE_TILESET;

/** Texture key for the Nth dirt variant (see `tiles.dirt` ordering note above). */
export const dirtKey = (i: number): string => `dirt${i}`;

/** Texture key for the Nth player walk-cycle frame. */
export const playerFrameKey = (i: number): string => `player-walk-${i}`;

/** Texture key for the Nth kid zombie walk-cycle frame. */
export const kidZombieFrameKey = (i: number): string => `kid-zombie-${i}`;

/** Texture key for the Nth kid zombie "damaged" (hit-reaction) frame. */
export const kidZombieDamagedFrameKey = (i: number): string => `kid-zombie-damaged-${i}`;

/** Weighted-random pick over `items` — used for ground variety (see `tiles.dirt` doc above). */
export function pickWeighted<T extends { weight: number }>(items: T[]): T {
  const total = items.reduce((sum, it) => sum + it.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    if (r < item.weight) return item;
    r -= item.weight;
  }
  return items[items.length - 1];
}
