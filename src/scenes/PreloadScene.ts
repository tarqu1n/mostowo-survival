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
  npcAnimKey,
  dirEnemyAnimKey,
  campfireBaseKey,
  campfireFlameLargeKey,
  campfireFlameSmallKey,
  campfireSmokeKey,
  barricadeBuildKey,
  barricadeDestroyKey,
  spikeTrapKey,
  iconKey,
  type TileSource,
  type StripAnim,
  type Facing,
  type Facing4,
  type DirEnemyState,
  type PlayerState,
} from '../data/tileset';
import { ITEMS } from '../data/items';
import { NODES } from '../data/nodes';
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
    // each standalone image tile once. GameScene reads them via resolveTile. Node sprites
    // (tree/rock/bush) are NO LONGER manifest roles (plan 021 step 6) — they load per-skin from the
    // catalog in `queueMapTextures`, alongside decor, only for the defs the loaded map references.
    const tileSources: TileSource[] = [
      ...manifest.tiles.ground.map((g) => g.source),
      manifest.tiles.wall,
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
    const { player, enemy, npc } = manifest.actors;
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
    // NPC companion (the Rogue, plan 042) — three flip3 strips keyed by `npcAnimKey` (== the anim key),
    // loaded in-place from the pixel-crawler pack like the player/skeleton. Loaded unconditionally so a
    // dev spawn / CompanionManager (Step 2) always has a resident texture. The Run sheet backs `walk`.
    loadStrip(npcAnimKey('walk'), npc.walk);
    loadStrip(npcAnimKey('idle'), npc.idle);
    loadStrip(npcAnimKey('death'), npc.death);

    // Directional enemies (dir4, e.g. the boar): each state×facing strip is its own spritesheet, keyed
    // by `dirEnemyAnimKey` (== the anim key). These load from the creature's OWN pack (the boar is in
    // craftpix-creatures, not the manifest's pixel-crawler), so route through `tilesetAssetUrl`, not the
    // manifest-base `url()`. Loaded unconditionally like the skeleton so a dev spawn / scenario boar
    // always has a resident texture.
    const dirStates: DirEnemyState[] = ['idle', 'walk', 'run', 'attack', 'hurt', 'death'];
    for (const [id, dirActor] of Object.entries(manifest.actors.directional)) {
      for (const state of dirStates) {
        for (const facing of ['down', 'up', 'left', 'right'] as Facing4[]) {
          const strip = dirActor[state][facing];
          this.load.spritesheet(
            dirEnemyAnimKey(id, state, facing),
            tilesetAssetUrl(dirActor.pack, strip.path),
            { frameWidth: strip.frameWidth ?? strip.frameSize, frameHeight: strip.frameSize },
          );
        }
      }
    }

    // Stations: the campfire's four layers — stone-ring base + large/small flame sheets + smoke (plan
    // 016 follow-up). Registered as Phaser anims later (registerActorAnims), not here — this just loads
    // the textures.
    loadStrip(campfireBaseKey(), manifest.stations.campfire.base);
    loadStrip(campfireFlameLargeKey(), manifest.stations.campfire.flameLarge);
    loadStrip(campfireFlameSmallKey(), manifest.stations.campfire.flameSmall);
    loadStrip(campfireSmokeKey(), manifest.stations.campfire.smoke);

    // Barricade wall structure (plan 037): 6 sheets (down/side/up × Build/Destroy). These live in the
    // craftpix-dungeon pack (cross-pack, like the boar dir4 strips above), so route through
    // `tilesetAssetUrl`, NOT the manifest-base `url()` (which resolves to the active pixel-crawler pack).
    // Loaded unconditionally like the campfire station so a placed/scenario wall always has a texture.
    const barricade = manifest.structures.barricade;
    for (const orient of ['down', 'side', 'up'] as Facing[]) {
      for (const [key, strip] of [
        [barricadeBuildKey(orient), barricade.build[orient]],
        [barricadeDestroyKey(orient), barricade.destroy[orient]],
      ] as const) {
        this.load.spritesheet(key, tilesetAssetUrl(barricade.pack, strip.path), {
          frameWidth: strip.frameWidth ?? strip.frameSize,
          frameHeight: strip.frameSize,
        });
      }
    }

    // Spike trap structure (plan 040): ONE sheet, cross-pack from craftpix-dungeon (like the barricade,
    // via `tilesetAssetUrl`, NOT the manifest-base `url()`). Loaded unconditionally so a placed/scenario
    // trap always has a resident texture. Registered as the extend anim later (registerActorAnims).
    const spikeTrap = manifest.structures.spikeTrap;
    this.load.spritesheet(spikeTrapKey(), tilesetAssetUrl(spikeTrap.pack, spikeTrap.sheet.path), {
      frameWidth: spikeTrap.sheet.frameWidth ?? spikeTrap.sheet.frameSize,
      frameHeight: spikeTrap.sheet.frameSize,
    });

    // Monster + NPC weapon art and the two hand images (off-hand fist + main-hand open grip): one
    // static image each (no anim), keyed like the derived tiles. GameScene resolves them via
    // resolveTile(source). The NPC (plan 042) reuses the same `_derived` blade/hand paths as the
    // skeleton, so `loadedImages` dedups them to a no-op — listing them keeps the companion's rig
    // self-sufficient (not implicitly reliant on the enemy load) without a double fetch.
    const handSources = [
      enemy.hand.source,
      enemy.hand.mainSource,
      npc.hand.source,
      npc.hand.mainSource,
    ].filter((s): s is TileSource => s !== undefined);
    for (const src of [
      ...Object.values(enemy.weapons).map((w) => w.source),
      ...Object.values(npc.weapons).map((w) => w.source),
      ...handSources,
    ]) {
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
   * (deduped, honouring each entry's own `pack`) + decor sheets/images + node-skin sprites — via the
   * runtime asset-path helpers, never `src/editor` (plan 018 guardrail). Mirrors
   * `EditorScene.queueTextures`. Node objects render per skin from the catalog (plan 021 step 6):
   * union each def's live + depleted skin assets so a placed skin OR its stump swap always has a
   * resident texture. Scope differs by build: PRODUCTION loads only the defs the loaded map
   * references (lean); DEV loads EVERY def, because the __test API + dev-menu randomiser place
   * arbitrary defs at runtime (see the branch comment). Guards already-resident (`textures.exists`)
   * and already-queued (`seen`) keys. Returns whether anything was queued (nothing → proceed at once).
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

    // Node skins: a skin references a catalog asset the same way decor does (whole image or a region
    // crop, never an anim — both share the plain `tileImageKey`). Load every skin (live + depleted)
    // of every def any node references so both the placed skin and its regrow/deplete swap resolve.
    const queueSkinAsset = (asset: string, ctx: string): void => {
      try {
        const { pack, path } = parseAssetId(asset);
        addImage(tileImageKey(path), tilesetAssetUrl(pack, path));
      } catch (e) {
        console.warn(
          `[preload] skipping node skin asset "${asset}" (${ctx}): ${(e as Error).message}`,
        );
      }
    };
    const queueDefSkins = (def: (typeof NODES)[string], ctxId: string): void => {
      for (const skin of def.skins) {
        queueSkinAsset(skin.asset, `${ctxId}/${skin.id}`);
        if (skin.depleted) queueSkinAsset(skin.depleted.asset, `${ctxId}/${skin.id} depleted`);
      }
    };
    if (import.meta.env.DEV) {
      // DEV-only: the __test API (applyScenario) and the dev-menu world randomiser add nodes of ANY
      // def at runtime, not just those the start map references — so preload EVERY def's skins here so
      // a runtime-placed node always has a resident texture. `vite build` dead-code-eliminates this
      // whole branch, so production stays lean: only the defs the loaded map references (below) load.
      for (const def of Object.values(NODES)) queueDefSkins(def, def.id);
    } else {
      const seenNodeRefs = new Set<string>();
      for (const obj of map.objects) {
        if (obj.kind !== 'node' || seenNodeRefs.has(obj.ref)) continue;
        seenNodeRefs.add(obj.ref);
        const def = NODES[obj.ref];
        if (!def) continue; // unknown ref — ResourceNodeManager warns + skips it at load
        queueDefSkins(def, obj.ref);
      }
    }

    return seen.size > 0;
  }
}
