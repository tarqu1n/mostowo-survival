import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { TILE_SIZE } from '../../config';
import type { ParsedNodeDef } from '../../systems/nodeDefs';
import type { DecorAnim, DecorRegion } from '../../systems/mapFormat';
import { parseAssetId, tilesetAssetUrl } from '../textureLoading';
import { loadCatalog } from '../catalogSource';
import { loadTerrainCatalog } from '../terrainCatalogSource';
import { loadNodeDefs } from '../nodeDefsSource';
import { colorToHex, resolveSkinPreviewUrl } from '../nodeTypesUi';
import type { TerrainDef } from '../terrainCatalog';
import {
  catalogTileCols,
  type AssetCatalog,
  type CatalogAsset,
  type CatalogRegion,
} from '../catalog';
import {
  useEditorStore,
  DECOR_ANIM_DEFAULT_FPS,
  type ArmedObjectAsset,
} from '../store/editorStore';
import { Button } from '../ui/button';
import { Slider } from '../ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../lib/utils';

/**
 * Library panel (plan 014 steps 6-7b) — loads the generated asset catalog, browses it by pack/category
 * (or text search over id/tags), a "Favourites" pseudo-category for the active zone's (or, with no
 * zone active, the map's) favourited assets, and a "Nodes" pseudo-category listing the editor store's
 * live `nodeDefsParsed` registry (plan 021 step 7 — NOT the boot-time `NODES` import, so a def
 * created/edited in-session appears here without a reload), previewed via their default skin's
 * catalog sprite. Tile-type assets (the 5 grid tilesheets) expand into a clickable
 * frame grid; clicking a frame sets `brushAsset` and switches to the Brush tool. Non-tile assets arm
 * `decor` placement (`armedObjectAsset`/`armedNodeRef` for Nodes, mutually exclusive — see editorStore's
 * module doc) and switch to the Place tool, mirroring how a tile click switches to Brush — kept
 * deliberately separate from `brushAsset` so arming an object/node can never make the brush/rect tools
 * paint it into a tile layer. Three non-tile shapes (step 7b):
 *  - An `object` atlas (`asset.regions` present — multiple sprites detected on one sheet, e.g.
 *    `Furniture.png`/`Rocks.png`): `AtlasSheetPicker` shows the WHOLE sheet with a clickable hotspot
 *    per detected region — click the sprite ON the sheet to arm just that crop (the user's explicit
 *    "show the whole sheet, click the sprite on it" ask), rather than a swatch grid that would
 *    misrepresent irregularly-sized/positioned sprites.
 *  - A `strip` with resolvable `frameWidth`/`frameHeight`/`frames`: `AnimatedStripPicker` shows a
 *    live CSS `steps()` preview of the whole strip playing — click arms the animated decor.
 *  - Everything else (a plain single-sprite `object`, or a `strip` whose frame geometry can't be
 *    resolved) falls back to the original whole-image `AssetCard` — click arms a plain (no
 *    `region`/`anim`) decor, unchanged from step 7.
 *
 * Re-render note: `map`/`zones`/`meta.favourites` are mutated IN PLACE by store commands (stable
 * object references — see editorStore's module doc), so this component subscribes to `docRevision`/
 * `mapEpoch` purely as re-render triggers and reads the current `map` via `getState()` in the render
 * body, rather than selecting `map` itself (which wouldn't detect an in-place mutation).
 *
 * Reclassify affordance (plan 014 step 7c, rewired plan 017 steps 2-3): `AssetReclassify` renders a
 * small ⚙ trigger on every `TileFrameGrid`/`AssetCard`/`AtlasSheetPicker`/`AnimatedStripPicker`.
 * Clicking it opens the asset's full-size object-editor TAB (`openObjectTab`) instead of the old
 * cramped popover — the tab (`tabs/ObjectEditorTab.tsx`) hosts the type/frame-grid controls and does
 * the `putAssetOverride` + catalog refetch. That refetch routes through the shared `loadCatalog`
 * (`catalogSource.ts`) → `setCatalog`; this panel reads the catalog straight from the store, so a
 * reclassify committed in a tab shows up here live without a page reload.
 */

/** On-screen swatch size for tile frames — an integer upscale of TILE_SIZE for legibility (16→32). */
const PREVIEW_PX = TILE_SIZE * 2;
/** Sentinel `selectedCategory` value for the Favourites pseudo-category (never a real category
 *  string, which are always pack-relative path segments like "Environment/Tilesets"). */
const FAVOURITES = '__favourites__';
/** Sentinel `selectedCategory` value for the Nodes pseudo-category (step 7). */
const NODES_CATEGORY = '__nodes__';
/** Sentinel `selectedCategory` value for the Terrains pseudo-category (step 10). */
const TERRAINS_CATEGORY = '__terrains__';
/** On-screen swatch size (px) for a terrain's cropped fill-frame preview — matches `libSwatchClass`'s
 *  fixed `h-10 w-10` (2.5rem = 40px at the default root size) so the crop math lines up with the
 *  rendered box exactly, unlike `PREVIEW_PX`'s bigger frame-grid swatches. */
const TERRAIN_SWATCH_PX = 40;
/** Fallback sheet column count for a terrain preview crop when the asset catalog hasn't resolved a
 *  matching entry yet (a load-order race, not a normal steady state) — Floors/Wall sheets are 25 cols
 *  @ TILE_SIZE (see `src/data/tileset.ts`'s module doc). */
const TERRAIN_SHEET_COLS_FALLBACK = 25;
/** Max on-screen width/height (px) for an atlas sheet preview (step 7b) — caps a dense sheet like
 *  `Furniture.png` (800×864) to something that fits the Library pane; hotspots scale down with it so
 *  they still land on the right sprite. Sheets already smaller than this render at native size. */
const ATLAS_PREVIEW_MAX_PX = 240;

/* Shared utility strings for the repeated Library shapes (plan 020 Step 4). Extracting them keeps the
 * per-item JSX terse and gives every card/label/swatch one definition to change. */
const libLabelClass = 'flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[0.75rem]';
const libSwatchClass =
  'pixelated h-10 w-10 flex-none rounded-[2px] bg-inset bg-contain bg-center bg-no-repeat';
/** `.lib-card`: a full-width row (swatch · label · heart); `is-active` gets the gold ring + surface bg. */
const libCardClass = (active: boolean): string =>
  cn(
    'flex w-full items-center gap-2 rounded-md border border-transparent p-1 text-left',
    active && 'border-gold-light bg-surface',
  );

/** A left-aligned tree/nav row (`.lib-tree-item`) as a ghost Button; active rows get the brown fill. */
function TreeItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      className={cn(
        'h-auto w-full justify-start whitespace-normal rounded-[3px] px-1.5 py-[3px] text-left text-[0.8rem] font-normal',
        active ? 'bg-active text-fg-bright hover:bg-active' : 'text-fg-muted hover:bg-surface',
      )}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** The favourite heart (`.lib-heart`): pink when favourited, else muted. `className` sets placement —
 *  absolute in a frame swatch, static in a card row. Click is stopped so it never arms/paints the card. */
function FavHeart({
  fav,
  onToggle,
  className,
}: {
  fav: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'flex-none cursor-pointer text-[0.7rem]',
        fav ? 'text-pink' : 'text-border-muted',
        className,
      )}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {fav ? '♥' : '♡'}
    </span>
  );
}

export function LibraryPanel() {
  // The catalog lives in the store (plan 017 step 3): the object-editor tab's Apply refetches it via
  // the shared `loadCatalog` → `setCatalog`, so reading it here (rather than a local copy) is what
  // makes a reclassify show up in the Library live. `null` until the mount fetch below lands.
  const catalog = useEditorStore((s) => s.catalog);
  const [error, setError] = useState<string | null>(null);
  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // Which packs are expanded in the nav. Packs start collapsed (empty set) so the tree stays compact —
  // the catalog has many packs, each with several categories, and rendering them all open overran the
  // pane. A pack is toggled open/shut by clicking its header.
  const [expandedPacks, setExpandedPacks] = useState<ReadonlySet<string>>(new Set());

  const brushAsset = useEditorStore((s) => s.brushAsset);
  const armedObjectAsset = useEditorStore((s) => s.armedObjectAsset);
  const armedNodeRef = useEditorStore((s) => s.armedNodeRef);
  const nodeDefsParsed = useEditorStore((s) => s.nodeDefsParsed);
  const activeZoneId = useEditorStore((s) => s.activeZoneId);
  const terrainCatalog = useEditorStore((s) => s.terrainCatalog);
  const activeTerrainId = useEditorStore((s) => s.activeTerrainId);
  // Re-render triggers only — see module doc. The actual map/favourites are read fresh below.
  useEditorStore((s) => s.docRevision);
  useEditorStore((s) => s.mapEpoch);

  // Load the catalog into the store on mount (shared `loadCatalog`, cache-busted). The object-editor
  // tab reuses the same loader after an Apply, so a reclassify refreshes both surfaces off one fetch.
  useEffect(() => {
    let cancelled = false;
    loadCatalog().catch((e: unknown) => {
      if (!cancelled) setError((e as Error).message);
    });
    // Terrain defs (plan 014 step 10) load independently — a failure here surfaces as an empty
    // Terrains category (logged), not a Library-wide error, since it's a much smaller/newer surface.
    loadTerrainCatalog().catch((e: unknown) => {
      console.warn('[editor] terrain catalog failed to load:', (e as Error).message);
    });
    // Node defs (plan 021 step 7) load independently too — the store is already seeded from the
    // bundled `nodes.json` (see editorStore's `nodeDefs` doc), so a failure here just means the
    // palette keeps showing that build-time seed rather than whatever's newer on disk.
    loadNodeDefs().catch((e: unknown) => {
      console.warn('[editor] node defs failed to load:', (e as Error).message);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const map = useEditorStore.getState().map;
  const favourites: string[] = map
    ? activeZoneId !== null
      ? (map.zones.defs.find((z) => z.id === activeZoneId)?.favourites ?? [])
      : (map.meta.favourites ?? [])
    : [];
  const favouriteSet = useMemo(() => new Set(favourites), [favourites]);

  const categoriesByPack = useMemo(() => {
    const out = new Map<string, string[]>();
    if (!catalog) return out;
    const seen = new Map<string, Set<string>>();
    for (const asset of catalog.assets) {
      if (!seen.has(asset.pack)) seen.set(asset.pack, new Set());
      seen.get(asset.pack)?.add(asset.category);
    }
    for (const [pack, cats] of seen) out.set(pack, [...cats].sort());
    return out;
  }, [catalog]);

  const searchLower = search.trim().toLowerCase();
  const showingFavourites = searchLower.length === 0 && selectedCategory === FAVOURITES;
  const showingNodes = searchLower.length === 0 && selectedCategory === NODES_CATEGORY;
  const showingTerrains = searchLower.length === 0 && selectedCategory === TERRAINS_CATEGORY;
  const showingCategory =
    searchLower.length === 0 &&
    selectedCategory !== null &&
    selectedCategory !== FAVOURITES &&
    selectedCategory !== NODES_CATEGORY &&
    selectedCategory !== TERRAINS_CATEGORY;

  const visibleAssets: CatalogAsset[] = useMemo(() => {
    if (!catalog) return [];
    if (searchLower.length > 0) {
      return catalog.assets.filter(
        (a) =>
          a.id.toLowerCase().includes(searchLower) || a.tags.some((t) => t.includes(searchLower)),
      );
    }
    if (showingCategory && selectedPack) {
      return catalog.assets.filter(
        (a) => a.pack === selectedPack && a.category === selectedCategory,
      );
    }
    return [];
  }, [catalog, searchLower, showingCategory, selectedPack, selectedCategory]);

  function pickTile(assetId: string): void {
    const s = useEditorStore.getState();
    s.setBrushAsset(assetId);
    // Picking a tile means "I want to paint this" — switch to the Brush tool unless the user is
    // already on a brush-consuming tool (brush/rect), so a tile click never silently leaves Pan
    // active (which just drags the map).
    if (s.activeTool !== 'brush' && s.activeTool !== 'rect') s.setActiveTool('brush');
  }
  function armObject(assetId: string): void {
    const s = useEditorStore.getState();
    s.setArmedObjectAsset({ assetId });
    s.setActiveTool('place'); // mirrors pickTile switching to Brush — arming always arms a TOOL too
  }
  /** Arms a specific atlas-sheet crop (`AtlasSheetPicker`'s hotspot click). */
  function armRegion(assetId: string, region: DecorRegion): void {
    const s = useEditorStore.getState();
    s.setArmedObjectAsset({ assetId, region });
    s.setActiveTool('place');
  }
  /** Arms an animated strip (`AnimatedStripPicker`'s click) — `fps` is stamped at placement time
   *  (`DECOR_ANIM_DEFAULT_FPS`), never carried here (critique #6: no per-instance editable fps). */
  function armAnim(assetId: string, anim: Omit<DecorAnim, 'fps'>): void {
    const s = useEditorStore.getState();
    s.setArmedObjectAsset({ assetId, anim });
    s.setActiveTool('place');
  }
  function armNode(ref: string): void {
    const s = useEditorStore.getState();
    s.setArmedNodeRef(ref);
    s.setActiveTool('place');
  }
  /** Arms a terrain for the terrain brush (step 10) — mirrors `pickTile`/`armObject`/`armNode` each
   *  switching to the tool their asset paints with. */
  function armTerrain(id: string): void {
    const s = useEditorStore.getState();
    s.setActiveTerrainId(id);
    s.setActiveTool('terrain');
  }
  function toggleFavourite(assetId: string): void {
    useEditorStore.getState().toggleFavourite(assetId);
  }
  function togglePack(packId: string): void {
    setExpandedPacks((prev) => {
      const next = new Set(prev);
      if (next.has(packId)) next.delete(packId);
      else next.add(packId);
      return next;
    });
  }

  return (
    // The shadcn Tooltips on the sparse chrome controls (zoom +/−, reclassify cog) are powered by the
    // single TooltipProvider mounted at the EditorApp root (plan 020 Step 5).
    <>
      <h2 className="mb-2 text-[0.85rem] uppercase tracking-[0.04em] text-fg-dim">Library</h2>
      <input
        className="mb-2.5 w-full rounded-md border border-border bg-inset px-2 py-[5px] text-fg"
        type="search"
        placeholder="Search id or tag…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {error && (
        <p className="mb-2 -mt-1 text-[0.8rem] text-danger">Catalog failed to load: {error}</p>
      )}
      {!catalog && !error && <p className="text-[0.9rem] text-muted-2">Loading catalog…</p>}
      {catalog && (
        <>
          {searchLower.length === 0 && (
            // Plain overflow div, NOT shadcn ScrollArea: this list is bounded by `max-height` inside
            // an auto-height flow, and Radix ScrollArea's viewport only bounds against a DEFINITE-height
            // ancestor — with just a max-height it doesn't cap, so the list overran the pane. (Convention:
            // ScrollArea suits a fixed/flex-bounded container; a max-height region in normal flow stays a
            // plain `overflow-auto` div.)
            <nav className="mb-2.5 flex max-h-[40vh] flex-col gap-0.5 overflow-auto border-b border-surface pb-2">
              <TreeItem
                active={selectedCategory === FAVOURITES}
                onClick={() => {
                  setSelectedPack(null);
                  setSelectedCategory(FAVOURITES);
                }}
              >
                ♥ Favourites ({favourites.length})
              </TreeItem>
              <TreeItem
                active={selectedCategory === NODES_CATEGORY}
                onClick={() => {
                  setSelectedPack(null);
                  setSelectedCategory(NODES_CATEGORY);
                }}
              >
                🌲 Nodes
              </TreeItem>
              <TreeItem
                active={selectedCategory === TERRAINS_CATEGORY}
                onClick={() => {
                  setSelectedPack(null);
                  setSelectedCategory(TERRAINS_CATEGORY);
                }}
              >
                🟩 Terrains
              </TreeItem>
              {catalog.packs.map((pack) => {
                const expanded = expandedPacks.has(pack.id);
                const categories = categoriesByPack.get(pack.id) ?? [];
                return (
                  <div key={pack.id} className="mb-1">
                    <button
                      type="button"
                      className="mt-1.5 mb-0.5 flex w-full items-center gap-1 text-[0.7rem] uppercase tracking-[0.03em] text-border-muted hover:text-fg-dim"
                      aria-expanded={expanded}
                      onClick={() => togglePack(pack.id)}
                    >
                      <span className="flex-none text-[0.65rem]">{expanded ? '▾' : '▸'}</span>
                      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">
                        {pack.name}
                      </span>
                      <span className="flex-none tabular-nums">{categories.length}</span>
                    </button>
                    {expanded &&
                      categories.map((category) => (
                        <TreeItem
                          key={category}
                          active={selectedPack === pack.id && selectedCategory === category}
                          onClick={() => {
                            setSelectedPack(pack.id);
                            setSelectedCategory(category);
                          }}
                        >
                          {category}
                        </TreeItem>
                      ))}
                  </div>
                );
              })}
            </nav>
          )}

          <div className="flex flex-col gap-2.5">
            {searchLower.length === 0 && selectedCategory === null && (
              <p className="text-[0.9rem] text-muted-2">Pick a category, or search above.</p>
            )}

            {showingFavourites &&
              (favourites.length === 0 ? (
                <p className="text-[0.9rem] text-muted-2">
                  No favourites yet — click a ♡ to add one.
                </p>
              ) : (
                favourites.map((favId) => (
                  <FavouriteItem
                    key={favId}
                    catalog={catalog}
                    favId={favId}
                    brushAsset={brushAsset}
                    armedObjectAsset={armedObjectAsset}
                    onPickTile={pickTile}
                    onArmObject={armObject}
                    onToggleFavourite={toggleFavourite}
                  />
                ))
              ))}

            {showingNodes &&
              Object.values(nodeDefsParsed).map((def) => (
                <NodeCard
                  key={def.id}
                  def={def}
                  isArmed={armedNodeRef === def.id}
                  onArm={() => armNode(def.id)}
                />
              ))}

            {showingTerrains &&
              (!terrainCatalog ? (
                <p className="text-[0.9rem] text-muted-2">Loading terrains…</p>
              ) : terrainCatalog.terrains.length === 0 ? (
                <p className="text-[0.9rem] text-muted-2">No terrains defined.</p>
              ) : (
                terrainCatalog.terrains.map((def) => (
                  <TerrainCard
                    key={def.id}
                    def={def}
                    catalog={catalog}
                    isArmed={activeTerrainId === def.id}
                    onArm={() => armTerrain(def.id)}
                  />
                ))
              ))}

            {(showingCategory || searchLower.length > 0) &&
              visibleAssets.map((asset) => {
                if (asset.type === 'tile') {
                  return (
                    <TileFrameGrid
                      key={asset.id}
                      asset={asset}
                      brushAsset={brushAsset}
                      favourites={favouriteSet}
                      onPick={pickTile}
                      onToggleFavourite={toggleFavourite}
                    />
                  );
                }
                if (asset.type === 'object' && (asset.regions?.length ?? 0) > 0) {
                  return (
                    <AtlasSheetPicker
                      key={asset.id}
                      asset={asset}
                      armedObjectAsset={armedObjectAsset}
                      onArmRegion={armRegion}
                    />
                  );
                }
                if (isAnimatableStrip(asset)) {
                  return (
                    <AnimatedStripPicker
                      key={asset.id}
                      asset={asset}
                      isArmed={armedObjectAsset?.assetId === asset.id}
                      onArm={armAnim}
                    />
                  );
                }
                return (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    isFavourite={favouriteSet.has(asset.id)}
                    isArmed={armedObjectAsset?.assetId === asset.id}
                    onArm={() => armObject(asset.id)}
                    onToggleFavourite={() => toggleFavourite(asset.id)}
                  />
                );
              })}

            {searchLower.length > 0 && visibleAssets.length === 0 && (
              <p className="text-[0.9rem] text-muted-2">No matches.</p>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** A tile asset's expanded frame grid — one clickable swatch per frame, each with its own favourite
 *  heart (tile favourites are frame-specific, e.g. "these 3 grass variants"). `cols` is derived from
 *  the catalog's own `w`/`tileSize`, never hardcoded. */
function TileFrameGrid({
  asset,
  brushAsset,
  favourites,
  onPick,
  onToggleFavourite,
}: {
  asset: CatalogAsset;
  brushAsset: string | null;
  favourites: ReadonlySet<string>;
  onPick: (assetId: string) => void;
  onToggleFavourite: (assetId: string) => void;
}) {
  const cols = catalogTileCols(asset, TILE_SIZE);
  const nativeRows = Math.max(1, Math.round(asset.h / TILE_SIZE));
  const frames = asset.frames ?? cols * nativeRows;
  const path = asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path;
  const url = tilesetAssetUrl(asset.pack, path);
  const bgSize = `${cols * PREVIEW_PX}px ${nativeRows * PREVIEW_PX}px`;

  return (
    <div className="relative">
      <AssetReclassify asset={asset} />
      <div
        className="mb-1 overflow-hidden text-ellipsis whitespace-nowrap text-[0.75rem] text-fg-dim"
        title={asset.id}
      >
        {asset.id.split('/').pop()}
      </div>
      <div
        className="grid max-h-[260px] gap-px overflow-auto rounded-[3px] bg-inset p-0.5"
        // gridTemplateColumns is computed from the catalog's own tile geometry — stays inline.
        style={{ gridTemplateColumns: `repeat(${cols}, ${PREVIEW_PX}px)` }}
      >
        {Array.from({ length: frames }, (_, frame) => {
          const col = frame % cols;
          const row = Math.floor(frame / cols);
          const frameId = `${asset.id}#${frame}`;
          const isFav = favourites.has(frameId);
          return (
            <button
              key={frame}
              className={cn(
                'relative rounded-[2px] border border-transparent bg-transparent p-0 leading-[0]',
                brushAsset === frameId && 'border-gold-light',
              )}
              title={`frame ${frame}`}
              onClick={() => onPick(frameId)}
            >
              <span
                className="pixelated block"
                // Per-frame sprite crop — backgroundImage/Position/Size are computed, so inline.
                style={{
                  width: PREVIEW_PX,
                  height: PREVIEW_PX,
                  backgroundImage: `url(${url})`,
                  backgroundPosition: `-${col * PREVIEW_PX}px -${row * PREVIEW_PX}px`,
                  backgroundSize: bgSize,
                }}
              />
              <FavHeart
                fav={isFav}
                onToggle={() => onToggleFavourite(frameId)}
                className="absolute top-0 right-px"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A node's preview image URL — its default (first) skin's catalog sprite (plan 021 step 6), which
 *  matches how it renders in-game/in-editor. A skin with a `region` crop would show its whole source
 *  sheet here rather than the single cropped frame — an acceptable simplification since the palette
 *  only needs *a* preview (the `_derived` node sprites are single-sprite images with no region).
 *  Delegates the actual (never-throwing) resolve to `resolveSkinPreviewUrl` (`nodeTypesUi.ts`) rather
 *  than inlining `parseAssetId` here — see that function's doc for why: it returns `null` for a skin
 *  whose `asset` isn't resolvable (most notably the Node Types panel's `PLACEHOLDER_SKIN_ASSET`, which
 *  every freshly-created def starts with), and keeping the resolver in a non-component module lets it
 *  be unit-tested without giving this component file a stray non-component export (which would break
 *  Vite Fast Refresh for it — discovered driving the Node Types panel end-to-end: the unguarded throw
 *  this replaced took down the WHOLE Library panel, and a first fix that exported this function
 *  directly from here broke Fast Refresh on every edit instead). */
function nodePreviewUrl(def: ParsedNodeDef): string | null {
  return resolveSkinPreviewUrl(def.skins[0].asset);
}

/** One "Nodes" pseudo-category entry (step 7) — click arms `armedNodeRef` for the Place tool. Nodes
 *  aren't favouritable (favourites are catalog asset ids; `NODES` refs are a different id space). A
 *  def whose default skin has no resolvable sprite yet (see `nodePreviewUrl`'s doc) falls back to a
 *  flat swatch tinted with the def's own `color` instead of crashing. */
function NodeCard({
  def,
  isArmed,
  onArm,
}: {
  def: ParsedNodeDef;
  isArmed: boolean;
  onArm: () => void;
}) {
  const url = nodePreviewUrl(def);
  return (
    <button className={libCardClass(isArmed)} title={def.id} onClick={onArm}>
      {url ? (
        <span className={libSwatchClass} style={{ backgroundImage: `url(${url})` }} />
      ) : (
        <span
          className={cn(
            libSwatchClass,
            'flex items-center justify-center bg-none text-[0.6rem] font-semibold text-fg-dim',
          )}
          style={{ backgroundColor: colorToHex(def.color) }}
          title="No sprite assigned yet — set one in the Node Types panel"
        >
          ?
        </span>
      )}
      <span className={libLabelClass}>{def.name}</span>
    </button>
  );
}

/** One "Terrains" pseudo-category entry (step 10) — click arms the terrain brush. The preview crops
 *  the terrain's `fillFrame` (the FULL_KEY / fully-surrounded interior tile — also what a big filled
 *  area mostly reads as) out of its sheet, scaled to the swatch box; when the asset catalog hasn't
 *  resolved a matching sheet entry yet (a load-order race — the two catalogs fetch independently, see
 *  the mount effect) it falls back to a hardcoded column count rather than blocking the swatch. */
function TerrainCard({
  def,
  catalog,
  isArmed,
  onArm,
}: {
  def: TerrainDef;
  catalog: AssetCatalog;
  isArmed: boolean;
  onArm: () => void;
}) {
  const sheetAsset = catalog.assets.find(
    (a) => a.pack === def.pack && a.source.kind === 'sheetFrame' && a.source.sheet === def.sheet,
  );
  const cols = sheetAsset ? catalogTileCols(sheetAsset, TILE_SIZE) : TERRAIN_SHEET_COLS_FALLBACK;
  const rows = sheetAsset ? Math.max(1, Math.round(sheetAsset.h / TILE_SIZE)) : cols;
  const url = tilesetAssetUrl(def.pack, def.sheet);
  const col = def.fillFrame % cols;
  const row = Math.floor(def.fillFrame / cols);
  return (
    <button className={libCardClass(isArmed)} title={def.id} onClick={onArm}>
      <span
        className={cn(libSwatchClass, 'pixelated')}
        // Per-frame sprite crop — overrides libSwatchClass's whole-image bg-contain/bg-center via
        // inline style's higher CSS precedence (mirrors TileFrameGrid's swatch math, at the fixed
        // card-swatch size).
        style={{
          backgroundImage: `url(${url})`,
          backgroundPosition: `-${col * TERRAIN_SWATCH_PX}px -${row * TERRAIN_SWATCH_PX}px`,
          backgroundSize: `${cols * TERRAIN_SWATCH_PX}px ${rows * TERRAIN_SWATCH_PX}px`,
        }}
      />
      <span className={libLabelClass}>{def.name}</span>
    </button>
  );
}

/** A single strip/object asset preview (whole image, letterboxed) — click arms decor placement.
 *  Objects aren't split into frames in the Library; a strip shows its full sheet. Wrapped in a
 *  `position:relative` `<div>` (rather than the card itself being one) so `AssetReclassify`'s ⚙
 *  trigger + popover can render as a SIBLING of the arm `<button>`, not nested inside it — the
 *  popover holds real `<select>`/`<input>`/`<button>` elements, which can't legally nest inside
 *  another `<button>`. */
function AssetCard({
  asset,
  isFavourite,
  isArmed,
  onArm,
  onToggleFavourite,
}: {
  asset: CatalogAsset;
  isFavourite: boolean;
  isArmed: boolean;
  onArm: () => void;
  onToggleFavourite: () => void;
}) {
  const path = asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path;
  const url = tilesetAssetUrl(asset.pack, path);
  const label = asset.id.split('/').pop() ?? asset.id;
  return (
    <div className="relative">
      <button className={libCardClass(isArmed)} title={asset.id} onClick={onArm}>
        <span className={libSwatchClass} style={{ backgroundImage: `url(${url})` }} />
        <span className={libLabelClass}>{label}</span>
        <FavHeart fav={isFavourite} onToggle={onToggleFavourite} className="static px-0.5" />
      </button>
      <AssetReclassify asset={asset} />
    </div>
  );
}

/** One Favourites-pseudo-category entry — resolves a favourited catalog id (which may carry
 *  `#frame`, e.g. a favourited tile frame) back to its `CatalogAsset` and renders the appropriate
 *  single-swatch view. A favourite whose asset no longer exists in the catalog (pack removed/
 *  regenerated) shows a small "missing" placeholder rather than crashing. */
function FavouriteItem({
  catalog,
  favId,
  brushAsset,
  armedObjectAsset,
  onPickTile,
  onArmObject,
  onToggleFavourite,
}: {
  catalog: AssetCatalog;
  favId: string;
  brushAsset: string | null;
  armedObjectAsset: ArmedObjectAsset | null;
  onPickTile: (assetId: string) => void;
  onArmObject: (assetId: string) => void;
  onToggleFavourite: (assetId: string) => void;
}) {
  let resolved: { asset: CatalogAsset; frame?: number } | null = null;
  try {
    const { pack, path, frame } = parseAssetId(favId);
    const baseId = `${pack}/${path}`;
    const asset = catalog.assets.find((a) => a.id === baseId);
    if (asset) resolved = { asset, frame };
  } catch {
    resolved = null;
  }

  if (!resolved) {
    return (
      <div className={cn(libCardClass(false), 'text-danger')} title={favId}>
        <span className={libLabelClass}>missing: {favId}</span>
        <FavHeart fav onToggle={() => onToggleFavourite(favId)} className="static px-0.5" />
      </div>
    );
  }

  const { asset, frame } = resolved;
  if (asset.type === 'tile' && frame !== undefined) {
    const cols = catalogTileCols(asset, TILE_SIZE);
    const nativeRows = Math.max(1, Math.round(asset.h / TILE_SIZE));
    const col = frame % cols;
    const row = Math.floor(frame / cols);
    const path = asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path;
    const url = tilesetAssetUrl(asset.pack, path);
    return (
      <button
        className={cn(
          'relative rounded-[2px] border border-transparent bg-transparent p-0 leading-[0]',
          brushAsset === favId && 'border-gold-light',
        )}
        title={favId}
        onClick={() => onPickTile(favId)}
      >
        <span
          className="pixelated block"
          // Per-frame sprite crop — computed background props stay inline.
          style={{
            width: PREVIEW_PX,
            height: PREVIEW_PX,
            backgroundImage: `url(${url})`,
            backgroundPosition: `-${col * PREVIEW_PX}px -${row * PREVIEW_PX}px`,
            backgroundSize: `${cols * PREVIEW_PX}px ${nativeRows * PREVIEW_PX}px`,
          }}
        />
        <FavHeart
          fav
          onToggle={() => onToggleFavourite(favId)}
          className="absolute top-0 right-px"
        />
      </button>
    );
  }

  return (
    <AssetCard
      asset={asset}
      isFavourite
      isArmed={armedObjectAsset?.assetId === favId || brushAsset === favId}
      onArm={() => onArmObject(favId)}
      onToggleFavourite={() => onToggleFavourite(favId)}
    />
  );
}

/** True if `asset` is a `strip` with fully resolvable, actually-multi-frame geometry — the only
 *  shape `AnimatedStripPicker` can safely animate (per plan guidance: don't guess frame math for a
 *  strip that lacks clean `frameWidth`/`frameHeight`/`frames`; fall back to the plain `AssetCard`
 *  instead). `frames >= 2`, not `> 0` (plan 014 step 7c bugfix): `stripFrameDims`'s "unresolved"
 *  fallback stamps `frames: 1` (the whole sheet as one unsliced frame) — `frames > 0` let THAT
 *  wrongly render via `AnimatedStripPicker` and stamp a useless `anim {…, frames: 1}` onto placed
 *  decor; a genuinely single-frame strip isn't an animation. */
function isAnimatableStrip(
  asset: CatalogAsset,
): asset is CatalogAsset & { frameWidth: number; frameHeight: number; frames: number } {
  return (
    asset.type === 'strip' &&
    typeof asset.frameWidth === 'number' &&
    typeof asset.frameHeight === 'number' &&
    typeof asset.frames === 'number' &&
    asset.frames >= 2
  );
}

/**
 * Atlas sheet picker (step 7b) — an `object` asset with detected `regions` (e.g. `Furniture.png`,
 * `Rocks.png`). Renders the WHOLE sheet with each region as an absolutely-positioned transparent
 * hotspot button — "show the whole sheet, click the sprite on it" per the user's explicit ask. A
 * swatch-per-region grid would misrepresent these sheets: regions are irregular sizes at irregular
 * positions (not a uniform tile grid), so cropping each into a same-size cell would lose the sheet's
 * actual layout/relationships. A base "fit" scale caps a big sheet down to `ATLAS_PREVIEW_MAX_PX`; a
 * `zoom` control (1–8×, via the +/− buttons, the slider, or the mouse wheel over the sheet)
 * multiplies it so the author can enlarge dense sheets enough to see/click small sprites — the canvas
 * overflows into a scrollable viewport and hotspots scale with the effective scale so they stay on
 * their sprite. Wheel-zoom is cursor-anchored (the content point under the pointer stays put) and uses
 * a native non-passive listener because React's synthetic `onWheel` is passive and can't
 * `preventDefault` the viewport's own scroll.
 */
const ATLAS_ZOOM_MIN = 1;
const ATLAS_ZOOM_MAX = 8;
const ATLAS_ZOOM_STEP = 0.5;
const clampZoom = (z: number): number =>
  Math.min(
    ATLAS_ZOOM_MAX,
    Math.max(ATLAS_ZOOM_MIN, Math.round(z / ATLAS_ZOOM_STEP) * ATLAS_ZOOM_STEP),
  );

function AtlasSheetPicker({
  asset,
  armedObjectAsset,
  onArmRegion,
}: {
  asset: CatalogAsset;
  armedObjectAsset: ArmedObjectAsset | null;
  onArmRegion: (assetId: string, region: DecorRegion) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const hoveringRef = useRef(false);
  const panRef = useRef<{
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
  } | null>(null);
  // Set by a wheel event, consumed by the layout effect below to keep the pointed-at content point
  // stationary across the zoom: `cx/cy` = content-space point under the cursor, `ox/oy` = its pixel
  // offset within the viewport.
  const pendingAnchor = useRef<{ cx: number; cy: number; ox: number; oy: number } | null>(null);

  const path = asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path;
  const url = tilesetAssetUrl(asset.pack, path);
  const fitScale = Math.min(1, ATLAS_PREVIEW_MAX_PX / Math.max(asset.w, asset.h));
  const scale = fitScale * zoom;
  const dispW = Math.round(asset.w * scale);
  const dispH = Math.round(asset.h * scale);
  const armedRegion = armedObjectAsset?.assetId === asset.id ? armedObjectAsset.region : undefined;

  // Re-anchor scroll after a wheel-zoom changes the canvas size (runs before paint, so no flicker).
  useLayoutEffect(() => {
    const el = viewportRef.current;
    const a = pendingAnchor.current;
    if (!el || !a) return;
    el.scrollLeft = a.cx * scale - a.ox;
    el.scrollTop = a.cy * scale - a.oy;
    pendingAnchor.current = null;
  }, [scale]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      pendingAnchor.current = {
        cx: (el.scrollLeft + ox) / scale,
        cy: (el.scrollTop + oy) / scale,
        ox,
        oy,
      };
      setZoom((z) => clampZoom(z + (e.deltaY < 0 ? ATLAS_ZOOM_STEP : -ATLAS_ZOOM_STEP)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scale]);

  // Hold Space to pan (middle-mouse-drag works too, unconditionally — see onCanvasPointerDown), mirrors
  // the object-editor tab's regions editor. Gated on `hoveringRef` rather than global focus so it never
  // steals the spacebar from another Library card while the pointer's elsewhere on the page.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.code !== 'Space' || e.repeat || !hoveringRef.current) return;
      e.preventDefault();
      setSpaceHeld(true);
    }
    function onKeyUp(e: KeyboardEvent): void {
      if (e.code === 'Space') setSpaceHeld(false);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  function onCanvasPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 1 && !(e.button === 0 && spaceHeld)) return;
    e.preventDefault();
    const el = viewportRef.current;
    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: el?.scrollLeft ?? 0,
      startTop: el?.scrollTop ?? 0,
    };
    setIsPanning(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onCanvasPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    const p = panRef.current;
    if (!p) return;
    const el = viewportRef.current;
    if (el) {
      el.scrollLeft = p.startLeft - (e.clientX - p.startX);
      el.scrollTop = p.startTop - (e.clientY - p.startY);
    }
  }

  function onCanvasPointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    if (!panRef.current) return;
    panRef.current = null;
    setIsPanning(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  return (
    <div className="relative">
      <div
        className="mb-1 overflow-hidden text-ellipsis whitespace-nowrap text-[0.75rem] text-fg-dim"
        title={asset.id}
      >
        {asset.id.split('/').pop()}
      </div>
      {/* Zoom-row controls all share a 22px height so the row keeps ONE baseline, and the whole row is
          budgeted to ~200px because the Library column is a fixed 240px — every control size below is
          picked to fit that budget with the cog on the end. */}
      <div className="mb-1.5 flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              className="size-[22px] shrink-0"
              disabled={zoom <= ATLAS_ZOOM_MIN}
              onClick={() => setZoom((z) => clampZoom(z - ATLAS_ZOOM_STEP))}
            >
              −
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom out</TooltipContent>
        </Tooltip>
        <Slider
          className="w-[78px] shrink-0"
          min={ATLAS_ZOOM_MIN}
          max={ATLAS_ZOOM_MAX}
          step={ATLAS_ZOOM_STEP}
          value={[zoom]}
          aria-label="Atlas zoom"
          onValueChange={([v]) => setZoom(clampZoom(v))}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              className="size-[22px] shrink-0"
              disabled={zoom >= ATLAS_ZOOM_MAX}
              onClick={() => setZoom((z) => clampZoom(z + ATLAS_ZOOM_STEP))}
            >
              +
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom in</TooltipContent>
        </Tooltip>
        <span className="min-w-6 flex-none text-right text-[0.7rem] text-fg-dim">{zoom}×</span>
        <AssetReclassify asset={asset} inline />
      </div>
      {/* Plain overflow div, NOT shadcn ScrollArea: this viewport's scroll offset is driven imperatively
          through `viewportRef` — cursor-anchored wheel-zoom re-anchoring (layout effect), space/middle-
          drag panning that reads & writes scrollLeft/scrollTop, and a non-passive native wheel listener.
          Radix ScrollArea owns its internal viewport node and doesn't expose that ref, so it can't host
          this logic. (Convention: ScrollArea is for simple overflow; keep a plain div for ref-driven
          imperative scroll/pan/zoom.) */}
      <div
        className="max-h-[320px] overflow-auto rounded-[3px] bg-inset"
        ref={viewportRef}
        onPointerEnter={() => {
          hoveringRef.current = true;
        }}
        onPointerLeave={() => {
          hoveringRef.current = false;
        }}
      >
        <div
          className={cn(
            'pixelated relative overflow-hidden rounded-[3px] bg-inset bg-no-repeat',
            spaceHeld && 'cursor-grab',
            isPanning && 'cursor-grabbing',
          )}
          // Sheet image + its scaled render size are computed — stay inline.
          style={{
            width: dispW,
            height: dispH,
            backgroundImage: `url(${url})`,
            backgroundSize: `${dispW}px ${dispH}px`,
          }}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
        >
          {(asset.regions ?? []).map((region: CatalogRegion) => {
            const isArmed =
              armedRegion !== undefined &&
              armedRegion.x === region.x &&
              armedRegion.y === region.y &&
              armedRegion.w === region.w &&
              armedRegion.h === region.h;
            return (
              <button
                key={region.key}
                className={cn(
                  'absolute m-0 rounded-[2px] border p-0',
                  isArmed
                    ? 'border-selection bg-[rgba(95,208,255,0.28)]'
                    : 'border-[rgba(240,216,144,0.35)] bg-[rgba(240,216,144,0.08)] hover:border-[rgba(240,216,144,0.85)] hover:bg-[rgba(240,216,144,0.22)]',
                )}
                title={`${region.w}×${region.h} @ (${region.x},${region.y})`}
                // Hotspot rect is computed from region geometry × scale — stays inline.
                style={{
                  left: region.x * scale,
                  top: region.y * scale,
                  width: Math.max(4, region.w * scale),
                  height: Math.max(4, region.h * scale),
                }}
                onClick={() =>
                  onArmRegion(asset.id, { x: region.x, y: region.y, w: region.w, h: region.h })
                }
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Animated strip picker (step 7b) — a `strip` asset with resolvable per-frame geometry
 * (`isAnimatableStrip`). Shows a live preview of the strip playing in a ONE-FRAME window via a CSS
 * `steps()` animation. The swatch is exactly one scaled frame (`dispW`×`dispH`); the sheet is drawn
 * behind it at its true scaled width (`frames * dispW`) and `background-position-x` travels the whole
 * `-frames * dispW` over `steps(frames)`, so every step lands exactly on a frame boundary. (A
 * percentage `0% → 100%` travel — the earlier approach — under-shifts by `(frames-1)/frames` of a
 * frame each step because of CSS's percentage-position formula, which showed two half-frames sliding
 * sideways instead of a clean flip.) The travel distance is handed to the shared keyframe via the
 * `--strip-travel` custom property, since @keyframes can't read component values.
 *
 * This single-horizontal-row `steps()` math is only correct for a classic one-row, every-cell-played
 * strip (plan 017 step 6 decouples grid geometry from the played set via `omit`): a multi-row grid or
 * a strip with omitted cells falls back to a static first-frame swatch (`canAnimateInline` below)
 * instead of animating something visually wrong — the true animated preview for those lives in the
 * object-editor tab (step 6.5). Clicking arms the animated decor, carrying `omit` through when present;
 * placement stamps a fixed default `fps` (`DECOR_ANIM_DEFAULT_FPS`), never edited here (critique #6).
 */
function AnimatedStripPicker({
  asset,
  isArmed,
  onArm,
}: {
  asset: CatalogAsset & { frameWidth: number; frameHeight: number; frames: number };
  isArmed: boolean;
  onArm: (assetId: string, anim: Omit<DecorAnim, 'fps'>) => void;
}) {
  const path = asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path;
  const url = tilesetAssetUrl(asset.pack, path);
  const scale = PREVIEW_PX / asset.frameHeight;
  const dispW = Math.round(asset.frameWidth * scale);
  const dispH = Math.round(asset.frameHeight * scale);
  const label = asset.id.split('/').pop() ?? asset.id;

  const cols = Math.max(1, Math.round(asset.w / asset.frameWidth));
  const rows = Math.max(1, Math.round(asset.h / asset.frameHeight));
  const omit = asset.omit ?? [];
  // The only geometry this swatch's single-row steps() math can honestly animate: one row, no
  // skipped cells. Anything else (a >1-row grid, or a row with an omitted cell) gets a static
  // first-frame swatch instead — see doc comment above.
  const canAnimateInline = rows === 1 && omit.length === 0;

  // The full animation is set inline (not via a CSS class): the keyframe `lib-strip-play` lives in
  // editor.css, but its duration/timing/travel all depend on the strip's frame count, so name +
  // iteration go here alongside them rather than in a utility. `--strip-travel` feeds the keyframe.
  const swatchStyle: CSSProperties & Partial<Record<'--strip-travel', string>> = canAnimateInline
    ? {
        width: dispW,
        height: dispH,
        backgroundImage: `url(${url})`,
        backgroundSize: `${asset.frames * dispW}px ${dispH}px`,
        animationName: 'lib-strip-play',
        animationIterationCount: 'infinite',
        animationDuration: `${asset.frames / DECOR_ANIM_DEFAULT_FPS}s`,
        animationTimingFunction: `steps(${asset.frames})`,
        '--strip-travel': `${-asset.frames * dispW}px`,
      }
    : {
        // Static first-frame swatch: crop cell 0 (top-left) out of the full grid, no animation.
        width: dispW,
        height: dispH,
        backgroundImage: `url(${url})`,
        backgroundSize: `${cols * dispW}px ${rows * dispH}px`,
        backgroundPosition: '0px 0px',
      };

  return (
    <div className="relative">
      <button
        // `.lib-strip-anim` was column layout on the card — flex-col/items-start override libCardClass.
        className={cn(libCardClass(isArmed), 'flex-col items-start')}
        title={asset.id}
        onClick={() =>
          onArm(asset.id, {
            frameWidth: asset.frameWidth,
            frameHeight: asset.frameHeight,
            frames: asset.frames,
            ...(omit.length ? { omit } : {}),
          })
        }
      >
        <span className="pixelated mb-1 block bg-no-repeat" style={swatchStyle} />
        <span className={libLabelClass}>{label}</span>
      </button>
      <AssetReclassify asset={asset} />
    </div>
  );
}

/**
 * Per-asset reclassify affordance (plan 014 step 7c, rewired plan 017 step 2) — a small ⚙ trigger on
 * every `TileFrameGrid`/`AssetCard`/`AtlasSheetPicker`/`AnimatedStripPicker`. Clicking it opens the
 * asset's full-size object-editor TAB (`openObjectTab`) instead of the old cramped popover, so the
 * type/frame-grid reclassify controls (a placeholder in step 2, fleshed out in step 3) get the room
 * to render a correct preview. Two placements: the default self-anchors to the top-right corner of any
 * `position:relative` card wrapper (see `AssetCard`'s doc); `inline` (used by `AtlasSheetPicker`, which
 * already has a zoom toolbar row to sit in) drops the absolute positioning and renders as a normal flex
 * item at the end of that row instead. Clicks are `stopPropagation`'d so opening the tab never also
 * arms/paints the underlying card.
 */
function AssetReclassify({ asset, inline = false }: { asset: CatalogAsset; inline?: boolean }) {
  function open(): void {
    useEditorStore.getState().openObjectTab(asset.id);
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          // Flex-centered square (not a bare font-size bump) so the ⚙ — which sits off-centre in its
          // own em-box — lands dead-centre. `inline` (atlas zoom row) drops the corner anchoring and
          // matches the row's 22px baseline; default self-anchors to the card's top-right corner.
          className={cn(
            'z-[5] flex cursor-pointer items-center justify-center rounded-md border border-border bg-inset leading-none text-muted-2 hover:border-active hover:text-gold',
            inline ? 'size-[22px] text-[14px]' : 'absolute top-0.5 right-0.5 size-5 text-[12px]',
          )}
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              open();
            }
          }}
        >
          ⚙
        </span>
      </TooltipTrigger>
      <TooltipContent>Reclassify: force type / frame grid</TooltipContent>
    </Tooltip>
  );
}
