import { useMemo, type ReactNode } from 'react';
import type { ParsedNodeDef } from '../../systems/nodeDefs';
import type { DecorAnim, DecorRegion } from '../../systems/mapFormat';
import { parseAssetId } from '../textureLoading';
import type { TerrainCatalog } from '../terrainCatalog';
import type { AssetCatalog, CatalogAsset } from '../catalog';
import { useEditorStore, type LibraryRoleFilter } from '../store/editorStore';
import { recentIdentity, type LibraryBrowseState, type RecentEntry } from '../libraryViewStore';
import { AssetSwatch, resolveRecentSwatch, type RecentSwatch } from './assetSwatch';
import { Button } from '../ui/button';
import { cn } from '../lib/utils';
import { Palette, Plus } from 'lucide-react';
import { useIsCompact } from '../hooks/useIsCompact';
import { toast } from 'sonner';
import { isObjectRegion } from './library/shared';
import { TileFrameGrid, NodeCard, TerrainCard, AssetCard, FavouriteItem } from './library/cards';
import { AtlasSheetPicker } from './library/AtlasSheetPicker';
import { AnimatedStripPicker, isAnimatableStrip } from './library/AnimatedStripPicker';

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
 * The card + picker components (`TileFrameGrid`/`NodeCard`/`TerrainCard`/`AssetCard`/`FavouriteItem`,
 * `AtlasSheetPicker`, `AnimatedStripPicker`, `AssetReclassify`) live under `panels/library/` (plan 043
 * step 9); this file owns the browse chrome (role filter, recent strip, category tree) and composes
 * them.
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
