import { useEffect, useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ITEMS } from '../../data/items';
import { parseNodeDefs, type AuthoredNodeDef, type NodeSkinDef } from '../../systems/nodeDefs';
import { putNodes } from '../api';
import type { AssetCatalog } from '../catalog';
import { cn } from '../lib/utils';
import { NodeSpritePickerDialog } from '../NodeSpritePickerDialog';
import { useIsCompact } from '../hooks/useIsCompact';
import { colorToHex, hexToColor, validateNodeDefPatch } from '../nodeTypesUi';
import { useEditorStore } from '../store/editorStore';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { SkinThumb } from '../ui/SkinThumb';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

/**
 * "Node Types" authoring panel (plan 021 step 8) — a permanent central-pane tab (alongside Map/
 * World, mirroring `WorldViewTab`'s structure) that lets a user CREATE/duplicate/delete resource-node
 * DEFS and author their stats + skins, replacing hand-editing `src/data/maps/nodes.json`. Two panes:
 * a left def list (create/duplicate/delete) and a right detail view — a stats form (batched draft +
 * explicit Save, validated live via `validateNodeDefPatch`, which runs the SAME `parseNodeDefs` choke
 * point every other node-def mutation commits through) and a skin manager (add/remove/reorder skins;
 * per-skin live + optional depleted sprite via `NodeSpritePickerDialog`, weight, optional sizing
 * overrides). Persisting the whole registry to disk (`PUT /__editor/nodes`) is a separate top-bar
 * "Save node types" button gated on `nodeDefsDirty`, mirroring `WorldViewTab`'s "Save world" button —
 * the in-store create/duplicate/update/skin actions all commit to the LIVE store immediately (so the
 * Library palette reflects them without a reload — see `LibraryPanel`'s module doc), independent of
 * whether the user has written that registry to `nodes.json` yet.
 *
 * Visibility: like every tab panel (see `WorldViewTab`'s header note), this owns no show/hide —
 * `EditorApp` mounts every panel at once and hides inactive ones with `invisible pointer-events-none`
 * (never `display:none`).
 */

const headingClass = 'text-[0.85rem] uppercase tracking-[0.04em] text-fg-dim';
const fieldClass = 'flex flex-col gap-[3px]';
const fieldLabelClass = 'text-[0.8rem] font-normal text-fg-dim';
const fieldInputClass =
  'h-auto border-border bg-inset px-1.5 py-1 text-[0.8rem] text-fg shadow-none md:text-[0.8rem]';

export function NodeTypesTab() {
  const nodeDefs = useEditorStore((s) => s.nodeDefs);
  const nodeDefsDirty = useEditorStore((s) => s.nodeDefsDirty);
  const catalog = useEditorStore((s) => s.catalog);
  // `map` is mutated in place by store commands (module convention — see LibraryPanel/InspectorPanel's
  // doc), so subscribe to the revision counters purely as re-render triggers and read it live below.
  // Both are threaded into `referencedDefIds`'s useMemo deps below (NOT `map` itself, whose reference
  // never changes on an in-place mutation like `placeNode` — a `[map]` dep would silently never
  // recompute after the first placement).
  const docRevision = useEditorStore((s) => s.docRevision);
  const mapEpoch = useEditorStore((s) => s.mapEpoch);
  const map = useEditorStore.getState().map;

  const [selectedId, setSelectedId] = useState<string | null>(nodeDefs[0]?.id ?? null);
  const [saving, setSaving] = useState(false);
  // Collapse state for the list-on-top layout (plan 030 step 7). Selecting a def collapses the list
  // to reveal its controls; with nothing selected the list is forced open (see `listOpen` below).
  const [listExpanded, setListExpanded] = useState(false);

  // If the selected def was deleted (by this panel or elsewhere), fall back to the first remaining def.
  useEffect(() => {
    if (selectedId !== null && !nodeDefs.some((d) => d.id === selectedId)) {
      setSelectedId(nodeDefs[0]?.id ?? null);
    }
  }, [nodeDefs, selectedId]);

  const selected = nodeDefs.find((d) => d.id === selectedId) ?? null;

  const referencedDefIds = useMemo(() => {
    const ids = new Set<string>();
    if (map) {
      for (const obj of map.objects) {
        if (obj.kind === 'node') ids.add(obj.ref);
      }
    }
    return ids;
    // Deliberately NOT `[map]` — see the field doc above: `map`'s reference never changes on an
    // in-place mutation, so `docRevision`/`mapEpoch` are the real recompute signals.
  }, [docRevision, mapEpoch]);

  async function handleSaveNodeTypes(): Promise<void> {
    setSaving(true);
    try {
      const json = `${JSON.stringify({ version: 1, defs: nodeDefs }, null, 2)}\n`;
      parseNodeDefs(JSON.parse(json)); // validate the exact bytes before writing (mirrors handleSave in WorldViewTab)
      await putNodes(json);
      useEditorStore.getState().markNodeDefsSaved();
      toast.success('Saved node types.');
    } catch (e) {
      toast.error(`Node types save failed: ${(e as Error).message}`, { duration: 5000 });
    } finally {
      setSaving(false);
    }
  }

  // Force the list open whenever nothing is selected (show the empty-state list), else honour the
  // collapse toggle. Selecting a def (list click / New / duplicate) collapses to reveal its controls.
  const listOpen = selected === null || listExpanded;
  function selectDef(id: string): void {
    setSelectedId(id);
    setListExpanded(false);
  }

  return (
    <div className="flex h-full w-full flex-col">
      {/* Collapsible "Node types" list (plan 030 step 7) — full-width on top, on desktop and compact.
          Selecting a def collapses this to a summary header ("Node types — {name}") and reveals that
          def's controls below; tapping the header re-expands to switch. Mirrors LibraryPanel's pack
          expander (▾/▸). The collapse toggle is disabled with nothing selected (list stays open). */}
      <div className="flex-none border-b border-surface bg-raised">
        <div className="flex items-center gap-2 p-3">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left disabled:cursor-default"
            aria-expanded={listOpen}
            disabled={selected === null}
            onClick={() => setListExpanded((v) => !v)}
          >
            <span className="flex-none text-[0.7rem] text-border-muted">
              {listOpen ? '▾' : '▸'}
            </span>
            <h2 className={headingClass}>Node types</h2>
            {!listOpen && selected && (
              <span className="min-w-0 truncate text-[0.82rem] text-fg-muted">
                — {selected.name || selected.id}
              </span>
            )}
          </button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const id = useEditorStore.getState().createNodeDef();
              if (id) selectDef(id);
            }}
          >
            + New
          </Button>
        </div>
        {listOpen && (
          <div className="max-h-[40vh] overflow-auto px-3 pb-3">
            {nodeDefs.length === 0 && (
              <p className="text-[0.85rem] text-muted-2">No node types defined.</p>
            )}
            <div className="flex flex-col gap-1">
              {nodeDefs.map((def) => {
                const referenced = referencedDefIds.has(def.id);
                const active = def.id === selectedId;
                return (
                  <div
                    key={def.id}
                    className={cn(
                      'flex items-center gap-1 rounded-md border border-transparent p-1',
                      active && 'border-gold-light bg-surface',
                    )}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-[0.82rem] text-fg"
                      title={def.id}
                      onClick={() => selectDef(def.id)}
                    >
                      {def.name || def.id}
                      <span className="ml-1 text-[0.68rem] text-muted-2">{def.id}</span>
                    </button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => {
                            const newId = useEditorStore.getState().duplicateNodeDef(def.id);
                            if (newId) selectDef(newId);
                          }}
                        >
                          ⧉
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Duplicate</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            disabled={referenced}
                            onClick={() => useEditorStore.getState().deleteNodeDef(def.id)}
                          >
                            ✕
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {referenced
                          ? "Can't delete — placed in the open map"
                          : 'Delete this node type'}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Save bar — the global registry save (nodes.json), always visible below the list. */}
      <div className="flex flex-none items-center gap-3 border-b border-surface bg-raised px-3 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              size="sm"
              disabled={saving || !nodeDefsDirty}
              onClick={() => void handleSaveNodeTypes()}
            >
              Save node types
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {nodeDefsDirty
              ? 'Write nodes.json (PUT /__editor/nodes)'
              : 'No unsaved node-type changes'}
          </TooltipContent>
        </Tooltip>
        {nodeDefsDirty && (
          <span className="text-gold" title="Unsaved node-type changes">
            ●
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!selected ? (
          <p className="text-[0.9rem] text-muted-2">
            No node type selected — create one to get started.
          </p>
        ) : (
          <div className="flex flex-col gap-4" key={selected.id}>
            <NodeStatsForm def={selected} allDefs={nodeDefs} />
            <SkinManager def={selected} catalog={catalog} map={map} />
          </div>
        )}
      </div>
    </div>
  );
}

type HarvestAnimOption = '' | 'chop' | 'gather' | 'mine' | 'salvage';

interface StatsDraft {
  name: string;
  maxHpText: string;
  yieldItemId: string;
  yieldPerHitText: string;
  /** Regrow delay authored in MINUTES (the stored def field is `regrowMs`); converted at the
   *  draft⇄def seam so the input reads in a human unit while the data model stays milliseconds. */
  regrowMinText: string;
  blocksPath: boolean;
  harvestAnim: HarvestAnimOption;
  colorHex: string;
  stumpColorHex: string;
  scaleText: string;
  originXText: string;
  originYText: string;
}

function draftOf(def: AuthoredNodeDef): StatsDraft {
  return {
    name: def.name,
    maxHpText: String(def.maxHp),
    yieldItemId: def.yieldItemId,
    yieldPerHitText: String(def.yieldPerHit),
    regrowMinText: String(def.regrowMs / 60000),
    blocksPath: def.blocksPath,
    harvestAnim: def.harvestAnim ?? '',
    colorHex: colorToHex(def.color),
    stumpColorHex: colorToHex(def.stumpColor),
    scaleText: String(def.scale ?? 1),
    originXText: String(def.originX),
    originYText: String(def.originY),
  };
}

/** Builds the `updateNodeDef` patch this draft represents. Numeric fields parse whatever text is
 *  currently typed (including a mid-edit `NaN`, e.g. a lone "-") straight into the candidate —
 *  `validateNodeDefPatch`/`parseNodeDefs` surface that as a normal inline error rather than this
 *  component inventing its own numeric-parsing rules (single validation source of truth). */
function draftToPatch(d: StatsDraft): Partial<Omit<AuthoredNodeDef, 'id' | 'skins'>> {
  return {
    name: d.name,
    maxHp: Number(d.maxHpText),
    yieldItemId: d.yieldItemId,
    yieldPerHit: Number(d.yieldPerHitText),
    // Minutes → ms for the stored def. A mid-edit non-number (e.g. a lone "-") yields NaN and flows
    // straight to `validateNodeDefPatch` as a normal inline error, same as the other numeric fields.
    regrowMs: Math.round(Number(d.regrowMinText) * 60000),
    blocksPath: d.blocksPath,
    harvestAnim: d.harvestAnim === '' ? undefined : d.harvestAnim,
    color: hexToColor(d.colorHex),
    stumpColor: hexToColor(d.stumpColorHex),
    scale: Number(d.scaleText),
    originX: Number(d.originXText),
    originY: Number(d.originYText),
  };
}

function statsEqual(a: StatsDraft, b: StatsDraft): boolean {
  return (
    a.name === b.name &&
    a.maxHpText === b.maxHpText &&
    a.yieldItemId === b.yieldItemId &&
    a.yieldPerHitText === b.yieldPerHitText &&
    a.regrowMinText === b.regrowMinText &&
    a.blocksPath === b.blocksPath &&
    a.harvestAnim === b.harvestAnim &&
    a.colorHex === b.colorHex &&
    a.stumpColorHex === b.stumpColorHex &&
    a.scaleText === b.scaleText &&
    a.originXText === b.originXText &&
    a.originYText === b.originYText
  );
}

/** The def's stats form — a BATCHED draft (not per-field auto-commit like the Inspector's
 *  `NumberField`): every field edit updates local state and re-validates live via
 *  `validateNodeDefPatch`, but nothing commits to the store until "Save changes", which is disabled
 *  while the draft is invalid OR unchanged. Remounted (via the parent's `key={selected.id}`) whenever
 *  the selected def changes, so switching defs always starts from a clean draft. */
function NodeStatsForm({ def, allDefs }: { def: AuthoredNodeDef; allDefs: AuthoredNodeDef[] }) {
  const [draft, setDraft] = useState<StatsDraft>(() => draftOf(def));
  const nameId = useId();
  const yieldId = useId();
  const harvestId = useId();

  const patch = draftToPatch(draft);
  const error = validateNodeDefPatch(allDefs, def.id, patch);
  const dirty = !statsEqual(draft, draftOf(def));

  function set<K extends keyof StatsDraft>(key: K, value: StatsDraft[K]): void {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function save(): void {
    if (error) return;
    useEditorStore.getState().updateNodeDef(def.id, patch);
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-surface bg-inset p-3">
      <div className="flex items-center justify-between">
        <h3 className={headingClass}>Stats — {def.id}</h3>
        <Button size="sm" disabled={!!error || !dirty} onClick={save}>
          Save changes
        </Button>
      </div>

      <div className={fieldClass}>
        <Label htmlFor={nameId} className={fieldLabelClass}>
          Name
        </Label>
        <Input
          id={nameId}
          className={fieldInputClass}
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
        />
      </div>

      <div className="flex gap-2">
        <div className={cn(fieldClass, 'flex-1')}>
          <Label className={fieldLabelClass}>Max HP</Label>
          <Input
            type="number"
            className={fieldInputClass}
            value={draft.maxHpText}
            onChange={(e) => set('maxHpText', e.target.value)}
          />
        </div>
        <div className={cn(fieldClass, 'flex-1')}>
          <Label className={fieldLabelClass}>Yield / hit</Label>
          <Input
            type="number"
            className={fieldInputClass}
            value={draft.yieldPerHitText}
            onChange={(e) => set('yieldPerHitText', e.target.value)}
          />
        </div>
        <div className={cn(fieldClass, 'flex-1')}>
          <Label className={fieldLabelClass}>Regrow (min)</Label>
          <Input
            type="number"
            step="any"
            className={fieldInputClass}
            value={draft.regrowMinText}
            onChange={(e) => set('regrowMinText', e.target.value)}
          />
        </div>
      </div>

      <div className={fieldClass}>
        <Label htmlFor={yieldId} className={fieldLabelClass}>
          Yield item
        </Label>
        <Select value={draft.yieldItemId} onValueChange={(v) => set('yieldItemId', v)}>
          <SelectTrigger id={yieldId} size="sm" className={cn(fieldInputClass, 'w-full')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ITEMS).map(([id, item]) => (
              <SelectItem key={id} value={id}>
                {item.name} ({id})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 text-[0.8rem] text-fg-muted">
          <input
            type="checkbox"
            checked={draft.blocksPath}
            onChange={(e) => set('blocksPath', e.target.checked)}
          />
          Blocks path
        </label>
        <div className={fieldClass}>
          <Label htmlFor={harvestId} className={fieldLabelClass}>
            Harvest anim
          </Label>
          <Select
            value={draft.harvestAnim || '__none__'}
            onValueChange={(v) =>
              set('harvestAnim', v === '__none__' ? '' : (v as HarvestAnimOption))
            }
          >
            <SelectTrigger id={harvestId} size="sm" className={cn(fieldInputClass, 'w-[140px]')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">none</SelectItem>
              <SelectItem value="chop">chop</SelectItem>
              <SelectItem value="gather">gather</SelectItem>
              <SelectItem value="mine">mine</SelectItem>
              <SelectItem value="salvage">salvage</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex gap-4">
        <div className={fieldClass}>
          <Label className={fieldLabelClass}>Color</Label>
          <input
            type="color"
            className="h-8 w-14 rounded border border-border bg-inset"
            value={draft.colorHex}
            onChange={(e) => set('colorHex', e.target.value)}
          />
        </div>
        <div className={fieldClass}>
          <Label className={fieldLabelClass}>Stump color</Label>
          <input
            type="color"
            className="h-8 w-14 rounded border border-border bg-inset"
            value={draft.stumpColorHex}
            onChange={(e) => set('stumpColorHex', e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <div className={cn(fieldClass, 'flex-1')}>
          <Label className={fieldLabelClass}>Scale</Label>
          <Input
            type="number"
            step={0.1}
            className={fieldInputClass}
            value={draft.scaleText}
            onChange={(e) => set('scaleText', e.target.value)}
          />
        </div>
        <div className={cn(fieldClass, 'flex-1')}>
          <Label className={fieldLabelClass}>Origin X</Label>
          <Input
            type="number"
            step={0.1}
            className={fieldInputClass}
            value={draft.originXText}
            onChange={(e) => set('originXText', e.target.value)}
          />
        </div>
        <div className={cn(fieldClass, 'flex-1')}>
          <Label className={fieldLabelClass}>Origin Y</Label>
          <Input
            type="number"
            step={0.1}
            className={fieldInputClass}
            value={draft.originYText}
            onChange={(e) => set('originYText', e.target.value)}
          />
        </div>
      </div>

      {error && <p className="text-[0.78rem] text-danger">{error}</p>}
    </div>
  );
}

type PickerTarget = { skinId: string; which: 'live' | 'depleted' };

function SkinManager({
  def,
  catalog,
  map,
}: {
  def: AuthoredNodeDef;
  catalog: AssetCatalog | null;
  map: ReturnType<typeof useEditorStore.getState>['map'];
}) {
  const isCompact = useIsCompact();
  const [pickerFor, setPickerFor] = useState<PickerTarget | null>(null);
  // Collapsible Skins section (plan 030 step 8): default expanded on desktop, collapsed on compact so
  // the phone view leads with the stats form and a skin summary bar. Remounts per selected def (parent
  // `key={selected.id}`), so switching defs re-applies the default. Committed skin edits live in the
  // store, so collapsing mid-edit loses nothing.
  const [expanded, setExpanded] = useState(!isCompact);

  function skinReferenced(skinId: string): boolean {
    if (!map) return false;
    return map.objects.some((o) => o.kind === 'node' && o.ref === def.id && o.skin === skinId);
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-surface bg-inset p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex flex-none items-center gap-1.5 text-left"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="flex-none text-[0.7rem] text-border-muted">{expanded ? '▾' : '▸'}</span>
          <h3 className={headingClass}>Skins</h3>
          <span className="text-[0.7rem] text-muted-2">({def.skins.length})</span>
        </button>
        {/* Collapsed: an at-a-glance thumbnail summary (each skin's live sprite), scrolling rather than
            overflowing when a def has many skins. Kept outside the toggle button so it can scroll on
            touch without the button swallowing the gesture. */}
        {!expanded && (
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {def.skins.map((skin) => (
              <SkinThumb
                key={skin.id}
                assetId={skin.asset}
                region={skin.region}
                catalog={catalog}
              />
            ))}
          </div>
        )}
        {expanded && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => useEditorStore.getState().addSkin(def.id)}
          >
            + Add skin
          </Button>
        )}
      </div>
      {expanded && (
        <div className="flex flex-col gap-2">
          {def.skins.map((skin, index) => (
            <SkinRow
              key={skin.id}
              def={def}
              skin={skin}
              index={index}
              lastIndex={def.skins.length - 1}
              catalog={catalog}
              removeDisabled={def.skins.length <= 1 || skinReferenced(skin.id)}
              removeDisabledReason={
                def.skins.length <= 1
                  ? 'A node type needs at least one skin'
                  : "Can't remove — placed on a node in the open map"
              }
              onPickLive={() => setPickerFor({ skinId: skin.id, which: 'live' })}
              onPickDepleted={() => setPickerFor({ skinId: skin.id, which: 'depleted' })}
            />
          ))}
        </div>
      )}
      {/* Always mounted (not inside the expanded branch) so an open picker keeps working even if the
          section is toggled; its only open trigger is a SkinRow button, which exists only when expanded. */}
      <NodeSpritePickerDialog
        open={pickerFor !== null}
        onOpenChange={(open) => {
          if (!open) setPickerFor(null);
        }}
        title={pickerFor?.which === 'depleted' ? 'Pick depleted sprite' : 'Pick live sprite'}
        catalog={catalog}
        onPick={(asset, region) => {
          if (!pickerFor) return;
          if (pickerFor.which === 'live') {
            useEditorStore.getState().updateSkin(def.id, pickerFor.skinId, { asset, region });
          } else {
            useEditorStore
              .getState()
              .updateSkin(def.id, pickerFor.skinId, { depleted: { asset, region } });
          }
          setPickerFor(null);
        }}
      />
    </div>
  );
}

function SkinRow({
  def,
  skin,
  index,
  lastIndex,
  catalog,
  removeDisabled,
  removeDisabledReason,
  onPickLive,
  onPickDepleted,
}: {
  def: AuthoredNodeDef;
  skin: NodeSkinDef;
  index: number;
  lastIndex: number;
  catalog: AssetCatalog | null;
  removeDisabled: boolean;
  removeDisabledReason: string;
  onPickLive: () => void;
  onPickDepleted: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-surface bg-raised p-2">
      <div className="flex items-center gap-2">
        <span className="text-[0.78rem] text-fg">{skin.name || skin.id}</span>
        {skin.name && <span className="text-[0.68rem] text-muted-2">{skin.id}</span>}
        {index === 0 && (
          <span className="rounded-full bg-gold-light px-1.5 py-0.5 text-[0.65rem] font-semibold text-black">
            Default
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={index === 0}
                onClick={() => useEditorStore.getState().moveSkin(def.id, skin.id, index - 1)}
              >
                ▲
              </Button>
            </TooltipTrigger>
            <TooltipContent>Move up (earlier = higher pick priority order)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={index === lastIndex}
                onClick={() => useEditorStore.getState().moveSkin(def.id, skin.id, index + 1)}
              >
                ▼
              </Button>
            </TooltipTrigger>
            <TooltipContent>Move down</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={removeDisabled}
                  onClick={() => useEditorStore.getState().removeSkin(def.id, skin.id)}
                >
                  ✕
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{removeDisabled ? removeDisabledReason : 'Remove skin'}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex flex-col items-center gap-1">
          <SkinThumb assetId={skin.asset} region={skin.region} catalog={catalog} />
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-1.5 text-[0.68rem]"
            onClick={onPickLive}
          >
            Live…
          </Button>
        </div>
        <div className="flex flex-col items-center gap-1">
          {skin.depleted ? (
            <SkinThumb
              assetId={skin.depleted.asset}
              region={skin.depleted.region}
              catalog={catalog}
            />
          ) : (
            <div
              className="flex items-center justify-center rounded-[2px] border border-dashed border-border bg-inset text-center text-[0.6rem] leading-tight text-muted-2"
              style={{ width: 40, height: 40 }}
            >
              none
            </div>
          )}
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-1.5 text-[0.68rem]"
              onClick={onPickDepleted}
            >
              Depleted…
            </Button>
            {skin.depleted && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-[0.68rem]"
                onClick={() =>
                  useEditorStore.getState().updateSkin(def.id, skin.id, { depleted: undefined })
                }
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-1.5">
          <OptionalTextField
            label="Name (override)"
            value={skin.name}
            onCommit={(name) => useEditorStore.getState().updateSkin(def.id, skin.id, { name })}
          />
          <div className="flex gap-1.5">
            <NumField
              label="Weight"
              value={skin.weight ?? 1}
              onCommit={(weight) =>
                useEditorStore.getState().updateSkin(def.id, skin.id, { weight })
              }
            />
            <OptionalNumField
              label="Max HP (override)"
              value={skin.maxHp}
              onCommit={(maxHp) => useEditorStore.getState().updateSkin(def.id, skin.id, { maxHp })}
            />
          </div>
          <div className="flex gap-1.5">
            <OptionalNumField
              label="Scale (override)"
              value={skin.scale}
              onCommit={(scale) => useEditorStore.getState().updateSkin(def.id, skin.id, { scale })}
            />
            <OptionalNumField
              label="Origin X (override)"
              value={skin.originX}
              onCommit={(originX) =>
                useEditorStore.getState().updateSkin(def.id, skin.id, { originX })
              }
            />
            <OptionalNumField
              label="Origin Y (override)"
              value={skin.originY}
              onCommit={(originY) =>
                useEditorStore.getState().updateSkin(def.id, skin.id, { originY })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** A required numeric field that commits on blur/Enter — mirrors `InspectorPanel`'s `NumberField`
 *  (uncontrolled, `key`-reset on external value change so a rejected/undone edit snaps back). */
function NumField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
}) {
  const id = useId();
  return (
    <div className={fieldClass}>
      <Label htmlFor={id} className={cn(fieldLabelClass, 'text-[0.7rem]')}>
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        defaultValue={value}
        key={value}
        className={cn(fieldInputClass, 'w-24')}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n !== value) onCommit(n);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

/** An OPTIONAL numeric override field (a skin's `scale`/`originX`/`originY`) — blank commits
 *  `undefined` ("use the def's default"), matching `NodeSkinDef`'s "omitted ⇒ inherit" semantics. */
function OptionalNumField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number | undefined;
  onCommit: (n: number | undefined) => void;
}) {
  const id = useId();
  return (
    <div className={cn(fieldClass, 'flex-1')}>
      <Label htmlFor={id} className={cn(fieldLabelClass, 'text-[0.7rem]')}>
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        placeholder="default"
        defaultValue={value ?? ''}
        key={value ?? '__unset__'}
        className={fieldInputClass}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          if (raw === '') {
            if (value !== undefined) onCommit(undefined);
            return;
          }
          const n = Number(raw);
          if (Number.isFinite(n) && n !== value) onCommit(n);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

/** An OPTIONAL text override field (a skin's display `name`) — blank commits `undefined` ("fall back
 *  to the skin id"), matching `NodeSkinDef.name`'s "omitted ⇒ inherit the id-based label" semantics.
 *  The text mirror of `OptionalNumField`. */
function OptionalTextField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string | undefined;
  onCommit: (v: string | undefined) => void;
}) {
  const id = useId();
  return (
    <div className={cn(fieldClass, 'flex-1')}>
      <Label htmlFor={id} className={cn(fieldLabelClass, 'text-[0.7rem]')}>
        {label}
      </Label>
      <Input
        id={id}
        placeholder="default"
        defaultValue={value ?? ''}
        key={value ?? '__unset__'}
        className={fieldInputClass}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          const next = raw === '' ? undefined : raw;
          if (next !== value) onCommit(next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}
