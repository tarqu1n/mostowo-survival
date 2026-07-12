import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT, COLORS, TILE_SIZE } from '../config';
import {
  ACTIVE_TILESET,
  sheetKey,
  tileImageKey,
  playerAnimKey,
  enemyWalkKey,
  enemyIdleKey,
  enemyDeathKey,
  iconKey,
  type TileSource,
  type StripAnim,
  type Facing,
  type PlayerState,
} from '../data/tileset';
import { ITEMS } from '../data/items';

/**
 * Loads the active tileset (see `src/data/tileset.ts`) and shows a simple loading bar. All keys are
 * pack-agnostic roles derived by the shared helpers (`sheetKey`/`tileImageKey` for terrain,
 * `playerAnimKey`/`enemyWalkKey` for actors), never pack-specific names — swapping `ACTIVE_TILESET`
 * is the only change needed to trial a different pack. Files load in-place from the pack root (no
 * `sprites/` subdir); every URL is `encodeURI`'d because some pack paths contain spaces.
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  preload(): void {
    const barWidth = BASE_WIDTH * 0.6;
    const barX = (BASE_WIDTH - barWidth) / 2;
    const barY = BASE_HEIGHT / 2;

    const border = this.add.rectangle(BASE_WIDTH / 2, barY, barWidth + 4, 16, COLORS.ui, 0.25);
    const bar = this.add.rectangle(barX, barY, 1, 12, COLORS.ui).setOrigin(0, 0.5);

    this.add
      .text(BASE_WIDTH / 2, barY - 24, 'Loading…', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#e8dcc0',
      })
      .setOrigin(0.5);

    this.load.on('progress', (p: number) => {
      bar.width = Math.max(1, barWidth * p);
    });
    this.load.once('complete', () => {
      border.destroy();
      bar.destroy();
    });

    const manifest = ACTIVE_TILESET;
    const base = `${import.meta.env.BASE_URL}assets/tilesets/${manifest.id}${
      manifest.spriteRoot ? `/${manifest.spriteRoot}` : ''
    }`;
    // Every pack path goes through here: spaces/other chars in mob paths would 404 unescaped.
    const url = (relPath: string): string => encodeURI(`${base}/${relPath}`);

    // Terrain: load each distinct sheet once (deduped by path) as a TILE_SIZE spritesheet; load
    // each standalone image tile (e.g. the extracted tree) once. GameScene reads them via resolveTile.
    const tileSources: TileSource[] = [
      ...manifest.tiles.ground.map((g) => g.source),
      manifest.tiles.wall,
      manifest.tiles.tree,
      manifest.tiles.rock,
      manifest.tiles.bush,
    ];
    const loadedSheets = new Set<string>();
    const loadedImages = new Set<string>();
    for (const source of tileSources) {
      if (source.kind === 'sheetFrame') {
        if (loadedSheets.has(source.sheet)) continue;
        loadedSheets.add(source.sheet);
        this.load.spritesheet(sheetKey(source.sheet), url(source.sheet), {
          frameWidth: TILE_SIZE,
          frameHeight: TILE_SIZE,
        });
      } else {
        if (loadedImages.has(source.path)) continue;
        loadedImages.add(source.path);
        this.load.image(tileImageKey(source.path), url(source.path));
      }
    }

    // Actors: each strip is its own spritesheet, keyed by role (texture key == anim key). Frames are
    // `frameSize` tall and square by default; a non-square sheet (e.g. the 96×64 skeleton Death) sets
    // `frameWidth`, so slice by that when present or the cells land between real frames.
    const loadStrip = (key: string, strip: StripAnim): void => {
      this.load.spritesheet(key, url(strip.path), {
        frameWidth: strip.frameWidth ?? strip.frameSize,
        frameHeight: strip.frameSize,
      });
    };
    const { player, enemy } = manifest.actors;
    const playerStates: PlayerState[] = [
      'idle',
      'walk',
      'chop',
      'mine',
      'gather',
      'attack',
      'death',
    ];
    (['down', 'side', 'up'] as Facing[]).forEach((facing) => {
      for (const state of playerStates)
        loadStrip(playerAnimKey(state, facing), player[state][facing]);
    });
    loadStrip(enemyWalkKey, enemy.walk);
    loadStrip(enemyIdleKey, enemy.idle); // 32px Idle bob — its own footprint (Phase B)
    loadStrip(enemyDeathKey, enemy.death);

    // Monster weapon art + the shared hand mitt: one static image each (no anim), keyed like the
    // derived tiles. GameScene resolves them via resolveTile(source).
    for (const src of [...Object.values(enemy.weapons).map((w) => w.source), enemy.hand.source]) {
      if (src.kind === 'image' && !loadedImages.has(src.path)) {
        loadedImages.add(src.path);
        this.load.image(tileImageKey(src.path), url(src.path));
      }
    }

    // Item icons: one standalone 32×32 image per ITEMS entry, keyed `icon:<id>`. Placeholder art this
    // slice (plan 008) — the repeatable generated set lands in plan 009. The UI falls back to the
    // item's `color` rect if a key is ever missing, so an icon-less item never hard-crashes.
    for (const item of Object.values(ITEMS)) {
      this.load.image(
        iconKey(item.id),
        encodeURI(`${import.meta.env.BASE_URL}assets/icons/${item.icon}`),
      );
    }
  }

  create(): void {
    this.scene.start('MainMenu');
  }
}
