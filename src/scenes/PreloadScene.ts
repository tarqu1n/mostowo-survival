import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT, COLORS, TILE_SIZE, START_MAP_ID } from '../config';
import {
  ACTIVE_TILESET,
  sheetKey,
  tileImageKey,
  playerAnimKey,
  enemyWalkKey,
  enemyIdleKey,
  enemyDeathKey,
  campfireBaseKey,
  campfireFlameLargeKey,
  campfireFlameSmallKey,
  campfireSmokeKey,
  iconKey,
  type TileSource,
  type StripAnim,
  type Facing,
  type PlayerState,
} from '../data/tileset';
import { ITEMS } from '../data/items';
import { loadMapFile } from '../systems/mapRuntime';
import type { MapFile } from '../systems/mapFormat';
import { parseAssetId, tilesetAssetUrl } from '../render/assetPaths';
import { queueDecorTexture } from '../render/decorSprites';
import { breadcrumb } from '../debug/crashReporter';

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

    // Stations: the campfire's four layers — stone-ring base + large/small flame sheets + smoke (plan
    // 016 follow-up). Registered as Phaser anims later (registerActorAnims), not here — this just loads
    // the textures.
    loadStrip(campfireBaseKey(), manifest.stations.campfire.base);
    loadStrip(campfireFlameLargeKey(), manifest.stations.campfire.flameLarge);
    loadStrip(campfireFlameSmallKey(), manifest.stations.campfire.flameSmall);
    loadStrip(campfireSmokeKey(), manifest.stations.campfire.smoke);

    // Monster weapon art + the two hand images (off-hand fist + main-hand open grip): one static image
    // each (no anim), keyed like the derived tiles. GameScene resolves them via resolveTile(source).
    const handSources = [enemy.hand.source, enemy.hand.mainSource].filter(
      (s): s is TileSource => s !== undefined,
    );
    for (const src of [...Object.values(enemy.weapons).map((w) => w.source), ...handSources]) {
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
    // The base tileset (above) is loaded synchronously by Phaser's own preload lifecycle. The
    // authored start map is loaded HERE instead: `loadMapFile` is async (dynamic import + parse) and
    // Phaser's preload() is synchronous, so its extra (decor) textures ride a second load batch that
    // we drive by hand — mirroring the editor's queue → load.start() → COMPLETE → proceed shape. This
    // keeps GameScene.buildWorld (plan 018 A11) fully synchronous: the map + every texture it needs
    // are resident before GameScene.create runs.
    void this.loadStartMapThenContinue();
  }

  /**
   * Load the authored start map, stash it in the registry for GameScene, queue its extra textures,
   * then start MainMenu once they're resident. Any failure to load/parse the map is re-thrown so the
   * always-on crash reporter's global handler surfaces a copyable on-device overlay (critique #2) —
   * a broken start map must be diagnosable, never a silent black loading screen that hangs.
   */
  private async loadStartMapThenContinue(): Promise<void> {
    let map: MapFile;
    try {
      map = await loadMapFile(START_MAP_ID);
    } catch (err) {
      breadcrumb('boot', `start-map "${START_MAP_ID}" failed to load`);
      throw err instanceof Error
        ? err
        : new Error(`start-map "${START_MAP_ID}" failed to load: ${String(err)}`);
    }
    // GameScene.buildWorld (A11) reads this instead of generating a world procedurally.
    this.registry.set('startMap', map);

    if (this.queueMapTextures(map)) {
      this.load.once(Phaser.Loader.Events.COMPLETE, () => this.scene.start('MainMenu'));
      this.load.start();
    } else {
      this.scene.start('MainMenu');
    }
  }

  /**
   * Queue every texture the start map needs beyond the base ACTIVE_TILESET load — palette sources
   * (deduped, honouring each entry's own `pack`) + decor sheets/images — via the runtime asset-path
   * helpers, never `src/editor` (plan 018 guardrail). Mirrors `EditorScene.queueTextures`. Node
   * objects render as their tile-role sprite (tree/rock/bush), all of which the base preload already
   * loaded, so they need nothing here. Guards already-resident (`textures.exists`) and already-queued
   * (`seen`) keys — for `test.map.json` the palette is `Floors_Tiles.png` (already resident), so in
   * practice only decor is queued. Returns whether anything was queued (nothing → proceed at once).
   */
  private queueMapTextures(map: MapFile): boolean {
    const seen = new Set<string>();
    const addImage = (key: string, srcUrl: string): void => {
      if (this.textures.exists(key) || seen.has(key)) return;
      seen.add(key);
      this.load.image(key, srcUrl);
    };
    const addSheet = (key: string, srcUrl: string): void => {
      if (this.textures.exists(key) || seen.has(key)) return;
      seen.add(key);
      this.load.spritesheet(key, srcUrl, { frameWidth: TILE_SIZE, frameHeight: TILE_SIZE });
    };

    for (const entry of map.palette) {
      if (!entry) continue; // reserved empty slot (palette[0])
      if (entry.source.kind === 'image') {
        addImage(tileImageKey(entry.source.path), tilesetAssetUrl(entry.pack, entry.source.path));
      } else {
        addSheet(sheetKey(entry.source.sheet), tilesetAssetUrl(entry.pack, entry.source.sheet));
      }
    }

    for (const obj of map.objects) {
      if (obj.kind !== 'decor') continue;
      try {
        const { pack, path } = parseAssetId(obj.asset);
        queueDecorTexture(this, obj, path, tilesetAssetUrl(pack, path), seen);
      } catch (e) {
        // A single malformed decor ref shouldn't abort the whole boot — warn and skip (matches the
        // editor). Its sprite simply won't render; DecorManager (A7) skips a missing texture too.
        console.warn(`[preload] skipping decor "${obj.id}": ${(e as Error).message}`);
      }
    }

    return seen.size > 0;
  }
}
