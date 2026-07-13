import { useEffect, useMemo, useState } from 'react';
import { TILE_SIZE } from '../../config';
import { NODES } from '../../data/nodes';
import { ACTIVE_TILESET } from '../../data/tileset';
import type { ResourceNodeDef } from '../../data/types';
import { parseAssetId, tilesetAssetUrl } from '../textureLoading';
import { parseCatalog, catalogTileCols, type AssetCatalog, type CatalogAsset } from '../catalog';
import { useEditorStore } from '../store/editorStore';

/**
 * Library panel (plan 014 steps 6-7) — loads the generated asset catalog, browses it by pack/category
 * (or text search over id/tags), a "Favourites" pseudo-category for the active zone's (or, with no
 * zone active, the map's) favourited assets, and a "Nodes" pseudo-category listing `NODES` entries
 * (previewed via their tileset role). Tile-type assets (the 5 grid tilesheets) expand into a clickable
 * frame grid; clicking a frame sets `brushAsset` and switches to the Brush tool. Strip/object assets
 * and Nodes instead "arm" placement (`armedObjectAsset`/`armedNodeRef`, mutually exclusive — see
 * editorStore's module doc) and switch to the Place tool, mirroring how a tile click switches to
 * Brush — kept deliberately separate from `brushAsset` so arming an object/node can never make the
 * brush/rect tools paint it into a tile layer.
 *
 * Re-render note: `map`/`zones`/`meta.favourites` are mutated IN PLACE by store commands (stable
 * object references — see editorStore's module doc), so this component subscribes to `docRevision`/
 * `mapEpoch` purely as re-render triggers and reads the current `map` via `getState()` in the render
 * body, rather than selecting `map` itself (which wouldn't detect an in-place mutation).
 */

/** On-screen swatch size for tile frames — an integer upscale of TILE_SIZE for legibility (16→32). */
const PREVIEW_PX = TILE_SIZE * 2;
/** Sentinel `selectedCategory` value for the Favourites pseudo-category (never a real category
 *  string, which are always pack-relative path segments like "Environment/Tilesets"). */
const FAVOURITES = '__favourites__';
/** Sentinel `selectedCategory` value for the Nodes pseudo-category (step 7). */
const NODES_CATEGORY = '__nodes__';

export function LibraryPanel() {
  const [catalog, setCatalogLocal] = useState<AssetCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const brushAsset = useEditorStore((s) => s.brushAsset);
  const armedObjectAsset = useEditorStore((s) => s.armedObjectAsset);
  const armedNodeRef = useEditorStore((s) => s.armedNodeRef);
  const activeZoneId = useEditorStore((s) => s.activeZoneId);
  // Re-render triggers only — see module doc. The actual map/favourites are read fresh below.
  useEditorStore((s) => s.docRevision);
  useEditorStore((s) => s.mapEpoch);

  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}assets/asset-catalog.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<unknown>;
      })
      .then((json) => {
        if (cancelled) return;
        const parsed = parseCatalog(json);
        setCatalogLocal(parsed);
        useEditorStore.getState().setCatalog(parsed);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error).message);
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
  const showingCategory =
    searchLower.length === 0 &&
    selectedCategory !== null &&
    selectedCategory !== FAVOURITES &&
    selectedCategory !== NODES_CATEGORY;

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
    s.setArmedObjectAsset(assetId);
    s.setActiveTool('place'); // mirrors pickTile switching to Brush — arming always arms a TOOL too
  }
  function armNode(ref: string): void {
    const s = useEditorStore.getState();
    s.setArmedNodeRef(ref);
    s.setActiveTool('place');
  }
  function toggleFavourite(assetId: string): void {
    useEditorStore.getState().toggleFavourite(assetId);
  }

  return (
    <>
      <h2>Library</h2>
      <input
        className="lib-search"
        type="search"
        placeholder="Search id or tag…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {error && <p className="editor-error-text">Catalog failed to load: {error}</p>}
      {!catalog && !error && <p className="editor-placeholder">Loading catalog…</p>}
      {catalog && (
        <>
          {searchLower.length === 0 && (
            <nav className="lib-tree">
              <button
                className={`lib-tree-item ${selectedCategory === FAVOURITES ? 'is-active' : ''}`}
                onClick={() => {
                  setSelectedPack(null);
                  setSelectedCategory(FAVOURITES);
                }}
              >
                ♥ Favourites ({favourites.length})
              </button>
              <button
                className={`lib-tree-item ${selectedCategory === NODES_CATEGORY ? 'is-active' : ''}`}
                onClick={() => {
                  setSelectedPack(null);
                  setSelectedCategory(NODES_CATEGORY);
                }}
              >
                🌲 Nodes
              </button>
              {catalog.packs.map((pack) => (
                <div key={pack.id} className="lib-tree-pack">
                  <div className="lib-tree-pack-name">{pack.name}</div>
                  {(categoriesByPack.get(pack.id) ?? []).map((category) => (
                    <button
                      key={category}
                      className={`lib-tree-item ${
                        selectedPack === pack.id && selectedCategory === category ? 'is-active' : ''
                      }`}
                      onClick={() => {
                        setSelectedPack(pack.id);
                        setSelectedCategory(category);
                      }}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              ))}
            </nav>
          )}

          <div className="lib-results">
            {searchLower.length === 0 && selectedCategory === null && (
              <p className="editor-placeholder">Pick a category, or search above.</p>
            )}

            {showingFavourites &&
              (favourites.length === 0 ? (
                <p className="editor-placeholder">No favourites yet — click a ♡ to add one.</p>
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
              Object.values(NODES).map((def) => (
                <NodeCard
                  key={def.id}
                  def={def}
                  isArmed={armedNodeRef === def.id}
                  onArm={() => armNode(def.id)}
                />
              ))}

            {(showingCategory || searchLower.length > 0) &&
              visibleAssets.map((asset) =>
                asset.type === 'tile' ? (
                  <TileFrameGrid
                    key={asset.id}
                    asset={asset}
                    brushAsset={brushAsset}
                    favourites={favouriteSet}
                    onPick={pickTile}
                    onToggleFavourite={toggleFavourite}
                  />
                ) : (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    isFavourite={favouriteSet.has(asset.id)}
                    isArmed={armedObjectAsset === asset.id}
                    onArm={() => armObject(asset.id)}
                    onToggleFavourite={() => toggleFavourite(asset.id)}
                  />
                ),
              )}

            {searchLower.length > 0 && visibleAssets.length === 0 && (
              <p className="editor-placeholder">No matches.</p>
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
    <div className="lib-tile-sheet">
      <div className="lib-tile-sheet-name" title={asset.id}>
        {asset.id.split('/').pop()}
      </div>
      <div
        className="lib-frame-grid"
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
              className={`lib-frame ${brushAsset === frameId ? 'is-active' : ''}`}
              title={`frame ${frame}`}
              onClick={() => onPick(frameId)}
            >
              <span
                className="lib-frame-swatch pixelated"
                style={{
                  width: PREVIEW_PX,
                  height: PREVIEW_PX,
                  backgroundImage: `url(${url})`,
                  backgroundPosition: `-${col * PREVIEW_PX}px -${row * PREVIEW_PX}px`,
                  backgroundSize: bgSize,
                }}
              />
              <span
                className={`lib-heart ${isFav ? 'is-fav' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavourite(frameId);
                }}
              >
                {isFav ? '♥' : '♡'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A node's preview image URL, resolved via its tileset role (`ACTIVE_TILESET.tiles[def.tile]`) —
 *  matches how it actually renders in-game/in-editor. Today every node's role is a standalone `image`
 *  source (see `data/tileset.ts`'s `PIXEL_CRAWLER_TILESET.tiles`), so this always shows the exact
 *  sprite; a `sheetFrame` role (none currently) would show its whole sheet rather than one cropped
 *  frame — an acceptable simplification since the step only requires *a* tile-role preview. */
function nodePreviewUrl(def: ResourceNodeDef): string {
  const source = ACTIVE_TILESET.tiles[def.tile];
  const path = source.kind === 'image' ? source.path : source.sheet;
  return tilesetAssetUrl(ACTIVE_TILESET.id, path);
}

/** One "Nodes" pseudo-category entry (step 7) — click arms `armedNodeRef` for the Place tool. Nodes
 *  aren't favouritable (favourites are catalog asset ids; `NODES` refs are a different id space). */
function NodeCard({
  def,
  isArmed,
  onArm,
}: {
  def: ResourceNodeDef;
  isArmed: boolean;
  onArm: () => void;
}) {
  const url = nodePreviewUrl(def);
  return (
    <button className={`lib-card ${isArmed ? 'is-active' : ''}`} title={def.id} onClick={onArm}>
      <span className="lib-card-swatch pixelated" style={{ backgroundImage: `url(${url})` }} />
      <span className="lib-card-label">{def.name}</span>
    </button>
  );
}

/** A single strip/object asset preview (whole image, letterboxed) — click arms decor placement.
 *  Objects aren't split into frames in the Library; a strip shows its full sheet. */
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
    <button className={`lib-card ${isArmed ? 'is-active' : ''}`} title={asset.id} onClick={onArm}>
      <span className="lib-card-swatch pixelated" style={{ backgroundImage: `url(${url})` }} />
      <span className="lib-card-label">{label}</span>
      <span
        className={`lib-heart ${isFavourite ? 'is-fav' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavourite();
        }}
      >
        {isFavourite ? '♥' : '♡'}
      </span>
    </button>
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
  armedObjectAsset: string | null;
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
      <div className="lib-card lib-card--missing" title={favId}>
        <span className="lib-card-label">missing: {favId}</span>
        <span className="lib-heart is-fav" onClick={() => onToggleFavourite(favId)}>
          ♥
        </span>
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
        className={`lib-frame ${brushAsset === favId ? 'is-active' : ''}`}
        title={favId}
        onClick={() => onPickTile(favId)}
      >
        <span
          className="lib-frame-swatch pixelated"
          style={{
            width: PREVIEW_PX,
            height: PREVIEW_PX,
            backgroundImage: `url(${url})`,
            backgroundPosition: `-${col * PREVIEW_PX}px -${row * PREVIEW_PX}px`,
            backgroundSize: `${cols * PREVIEW_PX}px ${nativeRows * PREVIEW_PX}px`,
          }}
        />
        <span
          className="lib-heart is-fav"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavourite(favId);
          }}
        >
          ♥
        </span>
      </button>
    );
  }

  return (
    <AssetCard
      asset={asset}
      isFavourite
      isArmed={armedObjectAsset === favId || brushAsset === favId}
      onArm={() => onArmObject(favId)}
      onToggleFavourite={() => onToggleFavourite(favId)}
    />
  );
}
