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
import { colorToHex } from '../nodeTypesUi';
import type { TerrainCatalog, TerrainDef } from '../terrainCatalog';
import {
  catalogTileCols,
  regionKey,
  type AssetCatalog,
  type CatalogAsset,
  type CatalogRegion,
} from '../catalog';
import {
  useEditorStore,
  DECOR_ANIM_DEFAULT_FPS,
  type ArmedObjectAsset,
  type LibraryRoleFilter,
} from '../store/editorStore';
import { recentIdentity, type LibraryBrowseState, type RecentEntry } from '../libraryViewStore';
import {
  AssetSwatch,
  EMPTY_NODE_DEFS,
  nodePreviewUrl,
  resolveRecentSwatch,
  TERRAIN_SHEET_COLS_FALLBACK,
  type RecentSwatch,
} from './assetSwatch';
import { Button } from '../ui/button';
import { Slider } from '../ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../lib/utils';
import { Palette, Plus } from 'lucide-react';
import { useIsCompact } from '../hooks/useIsCompact';
import { useLongPress } from '../hooks/useLongPress';
import { toast } from 'sonner';

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
/** Compact-viewport swatch size for the same frame grid (plan 027 step 10) — a real tileset sheet can
 *  be many columns wide (e.g. a 25-col Floors sheet), and at `PREVIEW_PX` that's 800px of horizontal
 *  scroll in a ~320px drawer. Shrinking the swatch (rather than reflowing the column count, which
 *  would break the frame grid's 1:1 visual match to the source sheet's own row/col layout) is the
 *  additive lever here — it's a deliberate trade against the ~44px touch-target guideline: a dense
 *  tile-variant picker needs to show many swatches at once to be usable at all, so these stay smaller
 *  and tap-precise rather than touch-ideal (see plan's "note it, don't grind" guidance).  */
const COMPACT_PREVIEW_PX = 22;
/** Recent-strip swatch size (plan 030 step 4). Compact is deliberately BIGGER than desktop: the strip
 *  is a one-tap re-pick affordance, so on touch the swatch doubles as the tap target and wants to clear
 *  the ~44px guideline (swatch + button padding ≈ 48px), whereas desktop can pack more into the row. */
const RECENT_SWATCH_PX = 34;
const RECENT_SWATCH_PX_COMPACT = 40;
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
/** Max on-screen width/height (px) for an atlas sheet preview (step 7b) — caps a dense sheet like
 *  `Furniture.png` (800×864) to something that fits the Library pane; hotspots scale down with it so
 *  they still land on the right sprite. Sheets already smaller than this render at native size. */
const ATLAS_PREVIEW_MAX_PX = 240;

/** A region is object-role — a placeable prop — when it declares `role:'object'` or predates the
 *  `role` field (absent ⇒ object, the plan-028 invariant). Only these arm as decor and occlude the
 *  tile cells they cover; a future `tile`-role region would do neither. On a `tile`-classed mixed
 *  sheet the authored prop regions carry `role:'object'` explicitly; on a plain `object` atlas the
 *  older regions have no `role` and still qualify here. */
const isObjectRegion = (r: CatalogRegion): boolean => r.role === undefined || r.role === 'object';

/** True when `assetId` names a catalog asset with `role:'actor'` (plan 032 step 3, critique #5) — used
 *  to guard the decor-arm paths below (`armObject`/`armRegion`/`armAnim`) so clicking an actor asset
 *  can never stage it for `place`: there's no actor editor yet, and actors must not become
 *  placeable-as-decor via the ordinary Library pick flow. The card may still render/select normally;
 *  only the arm call itself is suppressed. `catalog` is `null` before the mount fetch lands, in which
 *  case nothing can be armed from the Library yet anyway, so this conservatively reads as "not actor"
 *  rather than blocking every click. */
function isActorAsset(catalog: AssetCatalog | null, assetId: string): boolean {
  return catalog?.assets.find((a) => a.id === assetId)?.role === 'actor';
}

/* Shared utility strings for the repeated Library shapes (plan 020 Step 4). Extracting them keeps the
 * per-item JSX terse and gives every card/label/swatch one definition to change. */
const libLabelClass = 'flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[0.75rem]';
const libSwatchClass =
  'pixelated h-10 w-10 flex-none rounded-[2px] bg-inset bg-contain bg-center bg-no-repeat';
/** `.lib-card`: a full-width row (swatch · label · heart); `is-active` gets the gold ring + surface bg.
 *  `compact` (plan 027 step 10) adds a touch of extra padding/gap so the whole row — already close to
 *  44px tall via `libSwatchClass`'s 40px swatch — comfortably clears the touch-target guideline. */
const libCardClass = (active: boolean, compact = false): string =>
  cn(
    'flex w-full items-center gap-2 rounded-md border border-transparent p-1 text-left',
    active && 'border-gold-light bg-surface',
    compact && 'gap-3 p-1.5',
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
  const isCompact = useIsCompact();
  return (
    <Button
      variant="ghost"
      className={cn(
        'h-auto w-full justify-start whitespace-normal rounded-[3px] px-1.5 py-[3px] text-left text-[0.8rem] font-normal',
        active ? 'bg-active text-fg-bright hover:bg-active' : 'text-fg-muted hover:bg-surface',
        isCompact && 'min-h-11 px-2 py-2 text-[0.88rem]',
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

/** Effective `LibraryRoleFilter` a Recent entry counts as, for filtering the strip by the SAME role
 *  filter as the rest of the browse surface (plan 032 step 3, critique #2 — Recent must not bypass the
 *  filter). `tile`/`decor` entries resolve their real catalog asset's `role`; `node`/`terrain` entries
 *  aren't raw catalog assets, so they're pinned to the role their pseudo-category is gated under
 *  (mirrors `showingNodes`/`showingTerrains` below: nodes ⇒ `'object'`, terrains ⇒ `'tile'`). `null`
 *  when a `tile`/`decor` entry's asset can't be resolved (stale id after a pack regen) — filtered out
 *  either way, matching `resolveRecentSwatch`'s own can't-resolve handling. */
function recentEntryRole(entry: RecentEntry, catalog: AssetCatalog): LibraryRoleFilter | null {
  switch (entry.kind) {
    case 'tile': {
      try {
        const { pack, path } = parseAssetId(entry.assetId);
        return catalog.assets.find((a) => a.id === `${pack}/${path}`)?.role ?? null;
      } catch {
        return null;
      }
    }
    case 'decor':
      return catalog.assets.find((a) => a.id === entry.assetId)?.role ?? null;
    case 'node':
      return 'object';
    case 'terrain':
      return 'tile';
  }
}

/** Human-readable tooltip for a recent (its catalog id/ref, plus a hint for region/anim variants). */
function recentTitle(entry: RecentEntry): string {
  switch (entry.kind) {
    case 'tile':
      return entry.assetId;
    case 'decor':
      return entry.region
        ? `${entry.assetId} (region)`
        : entry.anim
          ? `${entry.assetId} (anim)`
          : entry.assetId;
    case 'node':
      return entry.ref;
    case 'terrain':
      return entry.id;
  }
}

/**
 * Recent strip (plan 030 step 4) — a top-of-Library MRU of recently-picked assets, so a re-pick is one
 * tap instead of re-navigating the tree. Per the product decision, ALL tiles are grouped into ONE
 * horizontally-scrollable swatch row (dense tiles scan best together); decor/node/terrain follow in a
 * second scroll row. Every swatch re-arms through the parent's pick handlers (via `onRearm`), which also
 * re-records it as most-recent and auto-closes the compact drawer. Entries whose asset no longer
 * resolves are skipped (not rendered) — `resolveRecentSwatch` returns `null` for them.
 */
function RecentStrip({
  recents,
  catalog,
  nodeDefsParsed,
  terrainCatalog,
  onRearm,
}: {
  recents: RecentEntry[];
  catalog: AssetCatalog;
  nodeDefsParsed: Record<string, ParsedNodeDef>;
  terrainCatalog: TerrainCatalog | null;
  onRearm: (entry: RecentEntry) => void;
}) {
  const isCompact = useIsCompact();
  const sizePx = isCompact ? RECENT_SWATCH_PX_COMPACT : RECENT_SWATCH_PX;
  const resolved = recents
    .map((entry) => ({
      entry,
      swatch: resolveRecentSwatch(entry, catalog, nodeDefsParsed, terrainCatalog),
    }))
    .filter((r): r is { entry: RecentEntry; swatch: RecentSwatch } => r.swatch !== null);
  if (resolved.length === 0) return null;
  const tiles = resolved.filter((r) => r.entry.kind === 'tile');
  const others = resolved.filter((r) => r.entry.kind !== 'tile');

  const swatchButton = ({ entry, swatch }: { entry: RecentEntry; swatch: RecentSwatch }) => (
    <button
      key={recentIdentity(entry)}
      type="button"
      className={cn(
        'flex flex-none items-center justify-center rounded-[3px] border border-transparent bg-inset p-0.5 hover:border-gold-light',
        isCompact && 'p-1',
      )}
      title={recentTitle(entry)}
      onClick={() => onRearm(entry)}
    >
      <span className="flex items-center justify-center" style={{ width: sizePx, height: sizePx }}>
        <AssetSwatch swatch={swatch} sizePx={sizePx} />
      </span>
    </button>
  );

  return (
    <div className="mb-2.5 flex flex-col gap-1 border-b border-surface pb-2">
      <div className="text-[0.7rem] uppercase tracking-[0.03em] text-border-muted">Recent</div>
      {tiles.length > 0 && (
        <div className="flex gap-1 overflow-x-auto pb-1">{tiles.map(swatchButton)}</div>
      )}
      {others.length > 0 && (
        <div className="flex gap-1 overflow-x-auto pb-1">{others.map(swatchButton)}</div>
      )}
    </div>
  );
}

/** `[Tiles] [Objects] [Actors]` role-filter chips (plan 032 step 3) — near the top of the panel, above
 *  the Recent strip/search, since the filter governs BOTH of those plus the category tree below. A
 *  click sets `libraryRoleFilter` manually, which also flags the override so the very next tool switch
 *  leaves the pick alone (see `setLibraryRoleFilter`'s doc) — toggling a chip sticks until then. */
const LIBRARY_ROLE_FILTER_OPTIONS: { role: LibraryRoleFilter; label: string }[] = [
  { role: 'tile', label: 'Tiles' },
  { role: 'object', label: 'Objects' },
  { role: 'actor', label: 'Actors' },
];

function LibraryRoleFilterChips({ active }: { active: LibraryRoleFilter }) {
  const isCompact = useIsCompact();
  return (
    <div className="mb-2.5 flex gap-1.5">
      {LIBRARY_ROLE_FILTER_OPTIONS.map(({ role, label }) => (
        <button
          key={role}
          type="button"
          className={cn(
            'flex-1 rounded-md border border-transparent bg-inset px-2 py-1 text-[0.75rem] text-fg-muted hover:bg-surface',
            active === role && 'border-gold-light bg-surface text-fg-bright',
            isCompact && 'min-h-11 py-2 text-[0.85rem]',
          )}
          aria-pressed={active === role}
          onClick={() => useEditorStore.getState().setLibraryRoleFilter(role)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * Palette multi-select controls (plan 033 step 4; compacted to an icon button in step 8 follow-up) — a
 * small palette-with-plus toggle bound to `palettePickMode`, plus an "Add (N)" action shown only while
 * picking. Self-contained: it reads the transient pick state straight from the store (so a compact-
 * drawer unmount never loses the in-progress selection) and drives `togglePalettePickMode`/
 * `addTilesToActivePalette`. Exported so it can live in the Library **panel** on desktop and in the
 * Library **drawer's bottom bar** on compact (near the Library-close toggle, per phone feedback — a
 * full-width button wasted prime Library space). While pick mode is on the toggle is filled and
 * entering it toasts a hint (taps select rather than paint); the actual click-path branch lives in
 * `pickTile` (below), which every tile-frame surface funnels through, so object/node/terrain arm paths
 * are untouched.
 */
export function PalettePickControls() {
  const isCompact = useIsCompact();
  const pickMode = useEditorStore((s) => s.palettePickMode);
  const count = useEditorStore((s) => s.palettePickSelection.length);

  function addSelection(): void {
    const s = useEditorStore.getState();
    const selection = s.palettePickSelection;
    const n = selection.length;
    if (n === 0) return;
    // A Library pick carries no rotation context, so map each ticked id to a rotation-0 slot with the
    // rotation omitted (equivalent to 0, keeps slots byte-identical per the Step 1 contract). The add
    // may LAZILY create "Palette 1" and make it active, so resolve the palette name AFTER the call.
    s.addTilesToActivePalette(selection.map((assetId) => ({ assetId })));
    const after = useEditorStore.getState();
    const name =
      after.tilePalettes.find((p) => p.id === after.activeTilePaletteId)?.name ?? 'palette';
    // Exit pick mode — `togglePalettePickMode` also clears the selection on the way out (so no separate
    // `clearPalettePick` is needed here). `n` was captured before the exit for the toast.
    s.togglePalettePickMode();
    toast(`Added ${n} ${n === 1 ? 'tile' : 'tiles'} to ${name}`);
  }

  function toggle(): void {
    const wasOff = !useEditorStore.getState().palettePickMode;
    useEditorStore.getState().togglePalettePickMode();
    // No inline hint line any more (the control is a bare icon in a bottom bar) — a one-off toast on
    // entry tells the user their taps now select rather than paint.
    if (wasOff) toast('Tap tiles to add them to a palette');
  }

  // A palette icon with a small + badge — the entry point / active toggle for palette selection.
  const glyph = (
    <span className="relative inline-flex items-center justify-center">
      <Palette />
      <Plus className="absolute -right-1 -top-1 size-3 stroke-[3]" />
    </span>
  );

  return (
    <div className="flex flex-none items-center gap-1.5">
      <Button
        type="button"
        variant={pickMode ? 'default' : 'outline'}
        size={isCompact ? 'icon-lg' : 'icon-sm'}
        className={cn(isCompact && 'size-11')}
        aria-pressed={pickMode}
        title={
          pickMode ? 'Selecting tiles for a palette — tap to cancel' : 'Select tiles for a palette'
        }
        aria-label={
          pickMode ? 'Selecting tiles for a palette — tap to cancel' : 'Select tiles for a palette'
        }
        onClick={toggle}
      >
        {glyph}
      </Button>
      {pickMode && (
        <Button
          type="button"
          variant="default"
          size="sm"
          className={cn(isCompact && 'min-h-11 text-[0.85rem]')}
          disabled={count === 0}
          onClick={addSelection}
        >
          Add ({count})
        </Button>
      )}
    </div>
  );
}

export function LibraryPanel({ onPick }: { onPick?: () => void } = {}) {
  const isCompact = useIsCompact();
  // The catalog lives in the store (plan 017 step 3): the object-editor tab's Apply refetches it via
  // the shared `loadCatalog` → `setCatalog`, so reading it here (rather than a local copy) is what
  // makes a reclassify show up in the Library live. `null` until the mount fetch below lands.
  const catalog = useEditorStore((s) => s.catalog);
  // Browse state (search / selected pack+category / expanded packs) lives in the editor store now
  // (plan 030) instead of local `useState`, so it survives the compact drawer unmounting on close
  // (the Radix `Sheet` destroys `LibraryPanel`) and — for the persisted subset — a reload. `search`
  // is store-only/transient (see `libraryViewStore`). `patchLibraryBrowse` is the single writer.
  const { search, selectedPack, selectedCategory, expandedPacks } = useEditorStore(
    (s) => s.libraryBrowse,
  );
  // Call through `getState()` rather than selecting the action — zustand actions are stable, so a
  // subscription buys nothing, and selecting a method trips the `unbound-method` lint. Mirrors the
  // pick handlers' `getState()` use below.
  const patchLibraryBrowse = (partial: Partial<LibraryBrowseState>): void =>
    useEditorStore.getState().patchLibraryBrowse(partial);
  // Derived Set for O(1) expansion lookups — the store keeps `expandedPacks` as a serializable array.
  const expandedPackSet = useMemo(() => new Set(expandedPacks), [expandedPacks]);

  const brushAsset = useEditorStore((s) => s.brushAsset);
  const armedObjectAsset = useEditorStore((s) => s.armedObjectAsset);
  const armedNodeRef = useEditorStore((s) => s.armedNodeRef);
  const nodeDefsParsed = useEditorStore((s) => s.nodeDefsParsed);
  const activeZoneId = useEditorStore((s) => s.activeZoneId);
  const terrainCatalog = useEditorStore((s) => s.terrainCatalog);
  const activeTerrainId = useEditorStore((s) => s.activeTerrainId);
  const libraryRecents = useEditorStore((s) => s.libraryRecents);
  const libraryRoleFilter = useEditorStore((s) => s.libraryRoleFilter);
  // Re-render triggers only — see module doc. The actual map/favourites are read fresh below.
  useEditorStore((s) => s.docRevision);
  useEditorStore((s) => s.mapEpoch);

  // The catalog + terrain/node defs now load once on editor BOOT (see `EditorApp`'s mount effect), not
  // here — so every sprite surface (Node Types thumbnails, Inspector node preview, object tabs) is
  // populated even before the Library drawer is first opened on the compact shell. This panel just
  // reads the resident catalog from the store; a load failure surfaces as an editor-wide toast.

  const map = useEditorStore.getState().map;
  const favourites: string[] = map
    ? activeZoneId !== null
      ? (map.zones.defs.find((z) => z.id === activeZoneId)?.favourites ?? [])
      : (map.meta.favourites ?? [])
    : [];
  const favouriteSet = useMemo(() => new Set(favourites), [favourites]);
  // Favourites, filtered to the active role (plan 032 step 3, critique #2 — Favourites must not
  // bypass the filter like every other browse surface). A favourite id may carry `#frame`
  // (`parseAssetId` strips it back to the base catalog id before the role lookup); unresolvable ids
  // (pack removed/regenerated) are dropped here too — `FavouriteItem` renders a "missing" placeholder
  // for those, but only when they're actually in view under the current filter.
  const filteredFavourites = useMemo(() => {
    if (!catalog) return [];
    return favourites.filter((favId) => {
      try {
        const { pack, path } = parseAssetId(favId);
        return catalog.assets.find((a) => a.id === `${pack}/${path}`)?.role === libraryRoleFilter;
      } catch {
        return false;
      }
    });
  }, [catalog, favourites, libraryRoleFilter]);
  // Recent picks, filtered to the active role (critique #2) — same treatment as Favourites.
  const filteredLibraryRecents = useMemo(() => {
    if (!catalog) return [];
    return libraryRecents.filter((entry) => recentEntryRole(entry, catalog) === libraryRoleFilter);
  }, [catalog, libraryRecents, libraryRoleFilter]);

  const categoriesByPack = useMemo(() => {
    const out = new Map<string, string[]>();
    if (!catalog) return out;
    const seen = new Map<string, Set<string>>();
    for (const asset of catalog.assets) {
      // Role-filtered (plan 032 step 3, critique #2): a category with assets only outside the active
      // filter never makes it into `seen`, so it's simply absent from the tree — no empty header.
      if (asset.role !== libraryRoleFilter) continue;
      if (!seen.has(asset.pack)) seen.set(asset.pack, new Set());
      seen.get(asset.pack)?.add(asset.category);
    }
    for (const [pack, cats] of seen) out.set(pack, [...cats].sort());
    return out;
  }, [catalog, libraryRoleFilter]);

  const searchLower = search.trim().toLowerCase();
  const showingFavourites = searchLower.length === 0 && selectedCategory === FAVOURITES;
  // Nodes/Terrains pseudo-categories are pinned to one role each (mirrors `recentEntryRole`'s same
  // pinning) — they only ever show under their matching filter, exactly like a real pack category
  // whose assets are all the "wrong" role is hidden under the other filter.
  const showingNodes =
    searchLower.length === 0 &&
    selectedCategory === NODES_CATEGORY &&
    libraryRoleFilter === 'object';
  const showingTerrains =
    searchLower.length === 0 &&
    selectedCategory === TERRAINS_CATEGORY &&
    libraryRoleFilter === 'tile';
  const showingCategory =
    searchLower.length === 0 &&
    selectedCategory !== null &&
    selectedCategory !== FAVOURITES &&
    selectedCategory !== NODES_CATEGORY &&
    selectedCategory !== TERRAINS_CATEGORY;
  // Drill-down (plan 030 step 6, compact only): once a category/sentinel is picked, hide the tree and
  // give the results grid the full drawer height, with a Back control to return to the tree. Desktop
  // keeps its tree-above-list layout, so this is gated on `isCompact`.
  const drilledIn = isCompact && searchLower.length === 0 && selectedCategory !== null;

  const visibleAssets: CatalogAsset[] = useMemo(() => {
    if (!catalog) return [];
    if (searchLower.length > 0) {
      // Role-filtered (critique #2): search must not bypass the filter either.
      return catalog.assets.filter(
        (a) =>
          a.role === libraryRoleFilter &&
          (a.id.toLowerCase().includes(searchLower) || a.tags.some((t) => t.includes(searchLower))),
      );
    }
    if (showingCategory && selectedPack) {
      return catalog.assets.filter(
        (a) =>
          a.role === libraryRoleFilter &&
          a.pack === selectedPack &&
          a.category === selectedCategory,
      );
    }
    return [];
  }, [catalog, searchLower, showingCategory, selectedPack, selectedCategory, libraryRoleFilter]);

  // Each pick handler, after its existing store call, records the pick as a "Recent" (plan 030) and
  // fires `onPick` — the compact drawer passes `onPick` to auto-close so painting can start
  // immediately; desktop omits it (no-op). `pushLibraryRecent` no-ops the disk write when no map.
  function pickTile(assetId: string): void {
    const s = useEditorStore.getState();
    // Palette multi-select (plan 033 step 4): while pick mode is on, a tile-frame tap TOGGLES the
    // frame in the palette selection instead of arming the brush. Branching here — the single funnel
    // every tile-frame surface (TileFrameGrid, Favourites tile cards, the Recent strip's tile re-arm)
    // routes through — means all of them honour pick mode without touching each grid; and because only
    // the tile path calls `pickTile`, the object/node/terrain arm paths (`armObject`/`armNode`/… ) are
    // inherently unaffected. `onPick` (compact-drawer auto-close) is deliberately NOT fired here — the
    // user is mid multi-select and the drawer must stay open.
    if (s.palettePickMode) {
      s.togglePalettePickTile(assetId);
      return;
    }
    s.setBrushAsset(assetId);
    // Picking a tile means "I want to paint this" — switch to the Brush tool unless the user is
    // already on a brush-consuming tool (brush/rect), so a tile click never silently leaves Pan
    // active (which just drags the map).
    if (s.activeTool !== 'brush' && s.activeTool !== 'rect') s.setActiveTool('brush');
    s.pushLibraryRecent({ kind: 'tile', assetId });
    onPick?.();
  }
  function armObject(assetId: string): void {
    // Actor assets have no placement/editor path yet (plan 032 step 3, critique #5) — guard the arm
    // path so a click on one is a no-op rather than staging it for the `place` tool.
    if (isActorAsset(catalog, assetId)) return;
    const s = useEditorStore.getState();
    s.setArmedObjectAsset({ assetId });
    s.setActiveTool('place'); // mirrors pickTile switching to Brush — arming always arms a TOOL too
    s.pushLibraryRecent({ kind: 'decor', assetId });
    onPick?.();
  }
  /** Arms a specific atlas-sheet crop (`AtlasSheetPicker`'s hotspot click). */
  function armRegion(assetId: string, region: DecorRegion): void {
    // See armObject's actor guard comment — same reasoning applies to a region crop of an actor sheet.
    if (isActorAsset(catalog, assetId)) return;
    const s = useEditorStore.getState();
    s.setArmedObjectAsset({ assetId, region });
    s.setActiveTool('place');
    s.pushLibraryRecent({ kind: 'decor', assetId, region });
    onPick?.();
  }
  /** Arms an animated strip (`AnimatedStripPicker`'s click) — `fps` is stamped at placement time
   *  (`DECOR_ANIM_DEFAULT_FPS`), never carried here (critique #6: no per-instance editable fps). */
  function armAnim(assetId: string, anim: Omit<DecorAnim, 'fps'>): void {
    // See armObject's actor guard comment — an animated actor strip must not become placeable decor.
    if (isActorAsset(catalog, assetId)) return;
    const s = useEditorStore.getState();
    s.setArmedObjectAsset({ assetId, anim });
    s.setActiveTool('place');
    s.pushLibraryRecent({ kind: 'decor', assetId, anim });
    onPick?.();
  }
  function armNode(ref: string): void {
    const s = useEditorStore.getState();
    s.setArmedNodeRef(ref);
    s.setActiveTool('place');
    s.pushLibraryRecent({ kind: 'node', ref });
    onPick?.();
  }
  /** Arms a terrain for the terrain brush (step 10) — mirrors `pickTile`/`armObject`/`armNode` each
   *  switching to the tool their asset paints with. */
  function armTerrain(id: string): void {
    const s = useEditorStore.getState();
    s.setActiveTerrainId(id);
    s.setActiveTool('terrain');
    s.pushLibraryRecent({ kind: 'terrain', id });
    onPick?.();
  }
  function toggleFavourite(assetId: string): void {
    useEditorStore.getState().toggleFavourite(assetId);
  }
  function togglePack(packId: string): void {
    patchLibraryBrowse({
      expandedPacks: expandedPacks.includes(packId)
        ? expandedPacks.filter((p) => p !== packId)
        : [...expandedPacks, packId],
    });
  }

  return (
    // The shadcn Tooltips on the sparse chrome controls (zoom +/−, reclassify cog) are powered by the
    // single TooltipProvider mounted at the EditorApp root (plan 020 Step 5).
    <>
      <h2 className="mb-2 text-[0.85rem] uppercase tracking-[0.04em] text-fg-dim">Library</h2>
      {/* Role-filter chips (plan 032 step 3) — above the Recent strip/search since the active filter
          governs both of those plus the category tree below. */}
      <LibraryRoleFilterChips active={libraryRoleFilter} />
      {/* Palette multi-select (plan 033 step 4) — DESKTOP only here (under the role chips): while pick
          mode is on, a tap on any tile frame toggles its palette selection (branched centrally in
          `pickTile`) instead of arming the brush, and "Add (N)" flushes the selection into the active
          palette. On compact this control lives in the Library drawer's bottom bar (EditorApp) instead,
          so it doesn't eat the top of the touch Library. */}
      {!isCompact && (
        <div className="mb-2.5">
          <PalettePickControls />
        </div>
      )}
      {/* Recent strip (plan 030 step 4) — top-of-panel MRU of everything pickable, on desktop and
          compact. Re-arming goes through the same pick handlers as the main list, so a click also
          moves the entry to front (`pushLibraryRecent`) and auto-closes the compact drawer (`onPick`).
          Needs the resolved catalog to draw swatches; hidden entirely when there are no recents (or
          none survive the active role filter — plan 032 step 3, critique #2). */}
      {catalog && filteredLibraryRecents.length > 0 && (
        <RecentStrip
          recents={filteredLibraryRecents}
          catalog={catalog}
          nodeDefsParsed={nodeDefsParsed}
          terrainCatalog={terrainCatalog}
          onRearm={(entry) => {
            switch (entry.kind) {
              case 'tile':
                pickTile(entry.assetId);
                break;
              case 'decor':
                if (entry.region) armRegion(entry.assetId, entry.region);
                else if (entry.anim) armAnim(entry.assetId, entry.anim);
                else armObject(entry.assetId);
                break;
              case 'node':
                armNode(entry.ref);
                break;
              case 'terrain':
                armTerrain(entry.id);
                break;
            }
          }}
        />
      )}
      <input
        className={cn(
          'mb-2.5 w-full rounded-md border border-border bg-inset px-2 py-[5px] text-fg',
          isCompact && 'h-11 px-3 text-[0.95rem]',
        )}
        type="search"
        placeholder="Search id or tag…"
        value={search}
        onChange={(e) => patchLibraryBrowse({ search: e.target.value })}
      />
      {!catalog && <p className="text-[0.9rem] text-muted-2">Loading catalog…</p>}
      {catalog && (
        <>
          {searchLower.length === 0 && !drilledIn && (
            // Plain overflow div, NOT shadcn ScrollArea: this list is bounded by `max-height` inside
            // an auto-height flow, and Radix ScrollArea's viewport only bounds against a DEFINITE-height
            // ancestor — with just a max-height it doesn't cap, so the list overran the pane. (Convention:
            // ScrollArea suits a fixed/flex-bounded container; a max-height region in normal flow stays a
            // plain `overflow-auto` div.) On compact the cap is dropped: the tree is shown alone (drill-
            // down hides the results), so it gets the full drawer height and the drawer itself scrolls.
            <nav
              className={cn(
                'mb-2.5 flex flex-col gap-0.5 overflow-auto border-b border-surface pb-2',
                !isCompact && 'max-h-[40vh]',
              )}
            >
              {/* Hidden when nothing survives the active role filter — mirrors how an empty pack
                  category is hidden below (plan 032 step 3, critique #2). */}
              {filteredFavourites.length > 0 && (
                <TreeItem
                  active={selectedCategory === FAVOURITES}
                  onClick={() =>
                    patchLibraryBrowse({ selectedPack: null, selectedCategory: FAVOURITES })
                  }
                >
                  ♥ Favourites ({filteredFavourites.length})
                </TreeItem>
              )}
              {/* Nodes is pinned to the Objects filter (resource nodes are placeable props, not
                  actors) — only shown under it, like `showingNodes` gates the results below. */}
              {libraryRoleFilter === 'object' && (
                <TreeItem
                  active={selectedCategory === NODES_CATEGORY}
                  onClick={() =>
                    patchLibraryBrowse({ selectedPack: null, selectedCategory: NODES_CATEGORY })
                  }
                >
                  🌲 Nodes
                </TreeItem>
              )}
              {/* Terrains is pinned to the Tiles filter — only shown under it, like `showingTerrains`
                  gates the results below. */}
              {libraryRoleFilter === 'tile' && (
                <TreeItem
                  active={selectedCategory === TERRAINS_CATEGORY}
                  onClick={() =>
                    patchLibraryBrowse({ selectedPack: null, selectedCategory: TERRAINS_CATEGORY })
                  }
                >
                  🟩 Terrains
                </TreeItem>
              )}
              {catalog.packs
                .filter((pack) => (categoriesByPack.get(pack.id)?.length ?? 0) > 0)
                .map((pack) => {
                  const expanded = expandedPackSet.has(pack.id);
                  const categories = categoriesByPack.get(pack.id) ?? [];
                  return (
                    <div key={pack.id} className="mb-1">
                      <button
                        type="button"
                        className={cn(
                          'mt-1.5 mb-0.5 flex w-full items-center gap-1 text-[0.7rem] uppercase tracking-[0.03em] text-border-muted hover:text-fg-dim',
                          isCompact && 'min-h-11 py-2 text-[0.78rem]',
                        )}
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
                            onClick={() =>
                              patchLibraryBrowse({
                                selectedPack: pack.id,
                                selectedCategory: category,
                              })
                            }
                          >
                            {category}
                          </TreeItem>
                        ))}
                    </div>
                  );
                })}
            </nav>
          )}

          {drilledIn && (
            // Compact drill-down Back: clears the selection to return to the full-height category tree.
            <button
              type="button"
              className="mb-2 flex min-h-11 w-full items-center gap-1 rounded-md border border-border bg-inset px-3 text-left text-[0.9rem] text-fg-muted hover:bg-surface"
              onClick={() => patchLibraryBrowse({ selectedPack: null, selectedCategory: null })}
            >
              ‹ Back
            </button>
          )}

          <div className="flex flex-col gap-2.5">
            {searchLower.length === 0 && selectedCategory === null && (
              <p className="text-[0.9rem] text-muted-2">Pick a category, or search above.</p>
            )}

            {showingFavourites &&
              (filteredFavourites.length === 0 ? (
                <p className="text-[0.9rem] text-muted-2">
                  No favourites yet — click a ♡ to add one.
                </p>
              ) : (
                filteredFavourites.map((favId) => (
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
                  // A mixed sheet (plan 028): a `tile` asset that ALSO carries object-role regions
                  // shows BOTH — the frame grid (with the prop cells occluded out) and the props as
                  // armable hotspots on the whole-sheet view below it. A plain tile sheet has no such
                  // regions, so only the grid renders and it looks exactly as before.
                  const objRegions = (asset.regions ?? []).filter(isObjectRegion);
                  const grid = (
                    <TileFrameGrid
                      key={asset.id}
                      asset={asset}
                      brushAsset={brushAsset}
                      favourites={favouriteSet}
                      onPick={pickTile}
                      onToggleFavourite={toggleFavourite}
                    />
                  );
                  if (objRegions.length === 0) return grid;
                  return (
                    <div key={asset.id} className="flex flex-col gap-2">
                      {grid}
                      <AtlasSheetPicker
                        asset={asset}
                        armedObjectAsset={armedObjectAsset}
                        onArmRegion={armRegion}
                        heading={`Objects on ${asset.id.split('/').pop()}`}
                      />
                    </div>
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
  const isCompact = useIsCompact();
  // Fixed-size offender (plan 027 step 10): the frame grid is a real spritesheet's own row/col layout,
  // so a wide sheet (e.g. a 25-col Floors tileset) is `cols * previewPx` px wide regardless — shrinking
  // the swatch on compact is the additive lever that keeps it usable in a ~320px drawer without
  // reflowing the grid away from its 1:1 match to the source sheet (see `COMPACT_PREVIEW_PX`'s doc).
  const previewPx = isCompact ? COMPACT_PREVIEW_PX : PREVIEW_PX;
  const cols = catalogTileCols(asset, TILE_SIZE);
  const nativeRows = Math.max(1, Math.round(asset.h / TILE_SIZE));
  const frames = asset.frames ?? cols * nativeRows;
  const path = asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path;
  const url = tilesetAssetUrl(asset.pack, path);
  const bgSize = `${cols * previewPx}px ${nativeRows * previewPx}px`;
  // Occlusion (plan 028): on a mixed sheet, an object-role region declares a placeable prop; the 16px
  // grid cells beneath it are unusable terrain fragments, so hide them here (the props themselves are
  // armed from the AtlasSheetPicker rendered alongside). A cell is hidden iff its CENTRE falls inside
  // some object region — not any-pixel overlap, so a region bleeding 1px into a neighbouring terrain
  // cell can't silently delete that legitimate tile. `cols` is already floored (catalogTileCols), so a
  // sheet whose width isn't a clean multiple of TILE_SIZE still yields integer col/row math — no crash.
  const objRegions = (asset.regions ?? []).filter(isObjectRegion);
  const isOccluded = (col: number, row: number): boolean => {
    if (objRegions.length === 0) return false;
    const cx = col * TILE_SIZE + TILE_SIZE / 2;
    const cy = row * TILE_SIZE + TILE_SIZE / 2;
    return objRegions.some(
      (rg) => cx >= rg.x && cx < rg.x + rg.w && cy >= rg.y && cy < rg.y + rg.h,
    );
  };

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
        className={cn(
          'grid max-h-[260px] gap-px overflow-auto rounded-[3px] bg-inset p-0.5',
          isCompact && 'max-h-[45vh] gap-0.5 p-1',
        )}
        // gridTemplateColumns is computed from the catalog's own tile geometry — stays inline.
        style={{ gridTemplateColumns: `repeat(${cols}, ${previewPx}px)` }}
      >
        {Array.from({ length: frames }, (_, frame) => {
          const col = frame % cols;
          const row = Math.floor(frame / cols);
          if (isOccluded(col, row)) return null;
          const frameId = `${asset.id}#${frame}`;
          return (
            <TileFrameButton
              key={frame}
              frame={frame}
              frameId={frameId}
              isActive={brushAsset === frameId}
              isFav={favourites.has(frameId)}
              isCompact={isCompact}
              swatchStyle={{
                width: previewPx,
                height: previewPx,
                backgroundImage: `url(${url})`,
                backgroundPosition: `-${col * previewPx}px -${row * previewPx}px`,
                backgroundSize: bgSize,
              }}
              onPick={onPick}
              onToggleFavourite={onToggleFavourite}
            />
          );
        })}
      </div>
    </div>
  );
}

/** One frame swatch in a `TileFrameGrid` (plan 030 step 6 extracted this from the grid's map so it can
 *  own a `useLongPress` hook — hooks can't run inside a loop). Desktop: plain `onClick` pick + the
 *  visible overlay `FavHeart` (unchanged). Compact/touch: the long-press hook governs BOTH gestures —
 *  tap = pick, long-press = toggle favourite (with a toast) — and the overlay heart is dropped (it was
 *  the tap-thief on touch), so long-press is the only favourite path here. */
function TileFrameButton({
  frame,
  frameId,
  isActive,
  isFav,
  isCompact,
  swatchStyle,
  onPick,
  onToggleFavourite,
}: {
  frame: number;
  frameId: string;
  isActive: boolean;
  isFav: boolean;
  isCompact: boolean;
  swatchStyle: CSSProperties;
  onPick: (assetId: string) => void;
  onToggleFavourite: (assetId: string) => void;
}) {
  // Palette pick-mode selection state (plan 033 step 4) — read straight from the store so the check
  // overlay re-renders the instant this frame is (de)selected. In pick mode a tap still routes through
  // `onPick` (=`pickTile`), which branches to `togglePalettePickTile`; only the affordance changes here.
  const palettePickMode = useEditorStore((s) => s.palettePickMode);
  const palettePicked = useEditorStore((s) => s.palettePickSelection.includes(frameId));
  const showPickOverlay = palettePickMode && palettePicked;
  const longPress = useLongPress({
    onTap: () => onPick(frameId),
    onLongPress: () => {
      onToggleFavourite(frameId);
      toast(isFav ? 'Removed favourite' : '♥ Favourited', { duration: 1200 });
    },
  });
  return (
    <button
      className={cn(
        'relative rounded-[2px] border border-transparent bg-transparent p-0 leading-[0]',
        isActive && 'border-gold-light',
        // Selected-for-palette wins the ring so the multi-select is unmistakable while picking.
        showPickOverlay && 'border-selection',
      )}
      title={`frame ${frame}`}
      // Compact: the hook owns tap+long-press and swallows the trailing click; desktop keeps plain click.
      {...(isCompact ? longPress : { onClick: () => onPick(frameId) })}
    >
      <span
        className="pixelated block"
        // Per-frame sprite crop — backgroundImage/Position/Size are computed, so inline.
        style={swatchStyle}
      />
      {showPickOverlay && (
        // Selection tint + check — reuses the AtlasSheetPicker armed-region colour for one consistent
        // "this is selected" language across the Library.
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[rgba(95,208,255,0.28)] text-[0.7rem] font-bold text-fg-bright">
          ✓
        </span>
      )}
      {!isCompact && (
        <FavHeart
          fav={isFav}
          onToggle={() => onToggleFavourite(frameId)}
          className="absolute top-0 right-px"
        />
      )}
    </button>
  );
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
  const isCompact = useIsCompact();
  const url = nodePreviewUrl(def);
  return (
    <button className={libCardClass(isArmed, isCompact)} title={def.id} onClick={onArm}>
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
  const isCompact = useIsCompact();
  const sheetAsset = catalog.assets.find(
    (a) => a.pack === def.pack && a.source.kind === 'sheetFrame' && a.source.sheet === def.sheet,
  );
  const cols = sheetAsset ? catalogTileCols(sheetAsset, TILE_SIZE) : TERRAIN_SHEET_COLS_FALLBACK;
  const rows = sheetAsset ? Math.max(1, Math.round(sheetAsset.h / TILE_SIZE)) : cols;
  const url = tilesetAssetUrl(def.pack, def.sheet);
  const col = def.fillFrame % cols;
  const row = Math.floor(def.fillFrame / cols);
  return (
    <button className={libCardClass(isArmed, isCompact)} title={def.id} onClick={onArm}>
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
  const isCompact = useIsCompact();
  const path = asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path;
  const url = tilesetAssetUrl(asset.pack, path);
  const label = asset.id.split('/').pop() ?? asset.id;
  // Compact/touch: long-press governs tap (arm) + long-press (toggle favourite) and drops the inline
  // heart, so the whole row is one clean tap target; desktop keeps plain click + the visible heart.
  const longPress = useLongPress({
    onTap: onArm,
    onLongPress: () => {
      onToggleFavourite();
      toast(isFavourite ? 'Removed favourite' : '♥ Favourited', { duration: 1200 });
    },
  });
  return (
    <div className="relative">
      <button
        className={libCardClass(isArmed, isCompact)}
        title={asset.id}
        {...(isCompact ? longPress : { onClick: onArm })}
      >
        <span className={libSwatchClass} style={{ backgroundImage: `url(${url})` }} />
        <span className={libLabelClass}>{label}</span>
        {!isCompact && (
          <FavHeart fav={isFavourite} onToggle={onToggleFavourite} className="static px-0.5" />
        )}
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
  const isCompact = useIsCompact();
  const previewPx = isCompact ? COMPACT_PREVIEW_PX : PREVIEW_PX;
  // Palette pick-mode selection state (plan 033 step 4) — a favourited tile frame is a tile-frame
  // surface too, so it funnels through `onPickTile` (=`pickTile`) and honours pick mode; mirror the
  // TileFrameButton check overlay here. `favId` is the frame id used for the selection key.
  const palettePickMode = useEditorStore((s) => s.palettePickMode);
  const palettePicked = useEditorStore((s) => s.palettePickSelection.includes(favId));
  // Compact/touch tile-favourite gesture (plan 030 step 6): tap = pick, long-press = un-favourite,
  // matching TileFrameGrid so the heart never steals a pick tap here either. Called unconditionally
  // (rules of hooks); only wired in the tile branch below, and only on compact. The object branch
  // delegates to AssetCard, which has its own long-press.
  const tileLongPress = useLongPress({
    onTap: () => onPickTile(favId),
    onLongPress: () => {
      onToggleFavourite(favId);
      toast('Removed favourite', { duration: 1200 });
    },
  });
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
      <div className={cn(libCardClass(false, isCompact), 'text-danger')} title={favId}>
        <span className={libLabelClass}>missing: {favId}</span>
        <FavHeart fav onToggle={() => onToggleFavourite(favId)} className="static px-0.5" />
      </div>
    );
  }

  const { asset, frame } = resolved;
  if (asset.type === 'tile' && frame !== undefined) {
    // Reuse the shared crop renderer (plan 030 step 4) rather than re-deriving the frame math here —
    // `asset` already resolved above, so `swatch` is non-null, but the guard keeps this crash-free.
    const swatch = resolveRecentSwatch(
      { kind: 'tile', assetId: favId },
      catalog,
      EMPTY_NODE_DEFS,
      null,
    );
    return (
      <button
        className={cn(
          'relative rounded-[2px] border border-transparent bg-transparent p-0 leading-[0]',
          brushAsset === favId && 'border-gold-light',
          palettePickMode && palettePicked && 'border-selection',
        )}
        title={favId}
        {...(isCompact ? tileLongPress : { onClick: () => onPickTile(favId) })}
      >
        {swatch && <AssetSwatch swatch={swatch} sizePx={previewPx} />}
        {palettePickMode && palettePicked && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[rgba(95,208,255,0.28)] text-[0.7rem] font-bold text-fg-bright">
            ✓
          </span>
        )}
        {!isCompact && (
          <FavHeart
            fav
            onToggle={() => onToggleFavourite(favId)}
            className="absolute top-0 right-px"
          />
        )}
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
  heading,
}: {
  asset: CatalogAsset;
  armedObjectAsset: ArmedObjectAsset | null;
  onArmRegion: (assetId: string, region: DecorRegion) => void;
  /** Label line above the sheet. Defaults to the file name; a mixed tile sheet (plan 028) passes a
   *  distinguishing heading so its "Objects on …" hotspot view reads apart from the frame grid above. */
  heading?: string;
}) {
  const isCompact = useIsCompact();
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
  // On compact, fit to a bigger budget (mirrors NodeSpritePickerDialog's RegionStep) — the sheet is the
  // same "click the sprite on the sheet" hotspot picker, so a bigger base render gives every hotspot a
  // bigger tap target before the user even reaches for the zoom control.
  const previewMaxPx = isCompact ? ATLAS_PREVIEW_MAX_PX * 1.4 : ATLAS_PREVIEW_MAX_PX;
  const fitScale = Math.min(1, previewMaxPx / Math.max(asset.w, asset.h));
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
        {heading ?? asset.id.split('/').pop()}
      </div>
      {/* Zoom-row controls all share a 22px height so the row keeps ONE baseline, and the whole row is
          budgeted to ~200px because the Library column is a fixed 240px — every control size below is
          picked to fit that budget with the cog on the end. On compact the Library is a full-width
          drawer (Step 8), not the fixed 240px column, so the row is freed up to use bigger controls. */}
      <div className={cn('mb-1.5 flex items-center gap-1.5', isCompact && 'gap-2.5')}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              className={cn('size-[22px] shrink-0', isCompact && 'size-10')}
              disabled={zoom <= ATLAS_ZOOM_MIN}
              onClick={() => setZoom((z) => clampZoom(z - ATLAS_ZOOM_STEP))}
            >
              −
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom out</TooltipContent>
        </Tooltip>
        <Slider
          className={cn('w-[78px] shrink-0', isCompact && 'w-[110px]')}
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
              className={cn('size-[22px] shrink-0', isCompact && 'size-10')}
              disabled={zoom >= ATLAS_ZOOM_MAX}
              onClick={() => setZoom((z) => clampZoom(z + ATLAS_ZOOM_STEP))}
            >
              +
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom in</TooltipContent>
        </Tooltip>
        <span
          className={cn(
            'min-w-6 flex-none text-right text-[0.7rem] text-fg-dim',
            isCompact && 'text-[0.8rem]',
          )}
        >
          {zoom}×
        </span>
        <AssetReclassify asset={asset} inline />
      </div>
      {/* Plain overflow div, NOT shadcn ScrollArea: this viewport's scroll offset is driven imperatively
          through `viewportRef` — cursor-anchored wheel-zoom re-anchoring (layout effect), space/middle-
          drag panning that reads & writes scrollLeft/scrollTop, and a non-passive native wheel listener.
          Radix ScrollArea owns its internal viewport node and doesn't expose that ref, so it can't host
          this logic. (Convention: ScrollArea is for simple overflow; keep a plain div for ref-driven
          imperative scroll/pan/zoom.) */}
      <div
        className={cn(
          'max-h-[320px] overflow-auto rounded-[3px] bg-inset',
          isCompact && 'max-h-[50vh]',
        )}
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
          {(asset.regions ?? []).filter(isObjectRegion).map((region: CatalogRegion) => {
            const isArmed =
              armedRegion !== undefined &&
              armedRegion.x === region.x &&
              armedRegion.y === region.y &&
              armedRegion.w === region.w &&
              armedRegion.h === region.h;
            return (
              <button
                key={regionKey(region)}
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
  const isCompact = useIsCompact();
  const path = asset.source.kind === 'sheetFrame' ? asset.source.sheet : asset.source.path;
  const url = tilesetAssetUrl(asset.pack, path);
  const scale = (isCompact ? COMPACT_PREVIEW_PX : PREVIEW_PX) / asset.frameHeight;
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
        className={cn(libCardClass(isArmed, isCompact), 'flex-col items-start')}
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
  const isCompact = useIsCompact();
  function open(): void {
    useEditorStore.getState().openObjectTab(asset.id);
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          // Flex-centered square (not a bare font-size bump) so the ⚙ — which sits off-centre in its
          // own em-box — lands dead-centre. `inline` (atlas zoom row) drops the corner anchoring and
          // matches the row's 22px baseline; default self-anchors to the card's top-right corner. On
          // compact both grow towards a real tap target (the `inline` row already grew to size-10 to
          // match its neighbouring zoom buttons; the default corner badge grows to size-8 — it can't
          // reach the full size-10 without overrunning a small swatch's own corner).
          className={cn(
            'z-[5] flex cursor-pointer items-center justify-center rounded-md border border-border bg-inset leading-none text-muted-2 hover:border-active hover:text-gold',
            inline ? 'size-[22px] text-[14px]' : 'absolute top-0.5 right-0.5 size-5 text-[12px]',
            isCompact && (inline ? 'size-10 text-[18px]' : 'size-8 text-[15px]'),
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
