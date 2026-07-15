import { useId } from 'react';
import { useEditorStore } from '../store/editorStore';
import type {
  DecorObject,
  MapObject,
  NodeObject,
  PortalFacing,
  PortalObject,
} from '../../systems/mapFormat';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { cn } from '../lib/utils';

/**
 * Inspector panel (plan 014 step 7) — shows/edits the selected object(s). Empty selection shows a
 * placeholder; exactly one selected shows its full editable fields (decor: x/y/scale/rotation/flip/
 * depth; node: ref read-only + col/row; portal: name/facing/rect); multiple selected shows a count
 * plus the batch buttons (rotate/flip/depth/duplicate/delete apply to every selected object, decor
 * ones for rotate/flip/depth — node/portal ids are silently skipped by the store actions since they
 * have no rotation/flip/depth concept).
 *
 * Re-render note: mirrors `LayersPanel`/`LibraryPanel` — `map` is mutated in place by store commands,
 * so this subscribes to `docRevision`/`mapEpoch`/`selectedObjectIds` purely as re-render triggers and
 * reads the current `map` via `getState()` in the render body.
 */

/* Shared utility strings for the repeated Inspector shapes (plan 020 Step 7). */
/** `.editor-pane h2` treatment (matches `LibraryPanel`'s heading) — the pane's ancestor rule that used
 *  to apply this uppercase/label look is gone now the panel isn't wrapped in `.editor-pane`, so it's
 *  restated here as utilities. */
const headingClass = 'mb-2 text-[0.85rem] uppercase tracking-[0.04em] text-fg-dim';
/** `.editor-placeholder`. */
const placeholderClass = 'text-[0.9rem] text-muted-2';
/** `.insp-fields`. */
const fieldsWrapperClass = 'mb-2.5 flex flex-col gap-2';
/** `.insp-field-row`. */
const rowClass = 'flex gap-2';
/** `.insp-field`, sans the `flex:1;min-width:0` that only applied when nested in a row (added at the
 *  call site — see `NumberField`, the only field that's always row-nested). */
const fieldClass = 'flex flex-col gap-[3px]';
const fieldLabelClass = 'text-[0.8rem] font-normal text-fg-dim';
/** `.insp-field input, .insp-field select`. `md:text-[0.8rem]` cancels shadcn `Input`'s own
 *  `md:text-sm` breakpoint override so the size stays 0.8rem at every width. */
const fieldInputClass =
  'h-auto border-border bg-inset px-1.5 py-1 text-[0.8rem] text-fg shadow-none md:text-[0.8rem]';

export function InspectorPanel() {
  const selectedObjectIds = useEditorStore((s) => s.selectedObjectIds);
  useEditorStore((s) => s.docRevision);
  useEditorStore((s) => s.mapEpoch);

  const map = useEditorStore.getState().map;

  if (!map) {
    return (
      <>
        <h2 className={headingClass}>Inspector</h2>
        <p className={placeholderClass}>No map open.</p>
      </>
    );
  }

  const selected = map.objects.filter((o) => selectedObjectIds.includes(o.id));

  if (selected.length === 0) {
    return (
      <>
        <h2 className={headingClass}>Inspector</h2>
        <p className={placeholderClass}>No selection.</p>
      </>
    );
  }

  const ids = selected.map((o) => o.id);
  const hasDecor = selected.some((o) => o.kind === 'decor');

  return (
    <>
      <h2 className={headingClass}>Inspector</h2>
      {selected.length === 1 ? (
        <SingleObjectFields obj={selected[0]} />
      ) : (
        <p className={placeholderClass}>{selected.length} objects selected.</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button
          variant="outline"
          size="sm"
          disabled={!hasDecor}
          title="Rotate the selected decor -90°"
          onClick={() => useEditorStore.getState().rotateObjects(ids, -90)}
        >
          ⟲ -90°
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasDecor}
          title="Rotate the selected decor +90°"
          onClick={() => useEditorStore.getState().rotateObjects(ids, 90)}
        >
          ⟳ +90°
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasDecor}
          onClick={() => useEditorStore.getState().flipObjects(ids, 'x')}
        >
          Flip H
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasDecor}
          onClick={() => useEditorStore.getState().flipObjects(ids, 'y')}
        >
          Flip V
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasDecor}
          title="Bring forward (stack on top)"
          onClick={() => useEditorStore.getState().bumpDepth(ids, 1)}
        >
          Bring forward
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasDecor}
          title="Send backward (stack underneath)"
          onClick={() => useEditorStore.getState().bumpDepth(ids, -1)}
        >
          Send back
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => useEditorStore.getState().duplicateObjects(ids)}
        >
          Duplicate
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => useEditorStore.getState().deleteObjects(ids)}
        >
          Delete
        </Button>
      </div>
    </>
  );
}

function SingleObjectFields({ obj }: { obj: MapObject }) {
  if (obj.kind === 'decor') return <DecorFields obj={obj} />;
  if (obj.kind === 'node') return <NodeFields obj={obj} />;
  return <PortalFields obj={obj} />;
}

/** A numeric field that commits on blur/Enter (not per-keystroke) — one undoable command per commit.
 *  Keyed by `value` so an external change (undo, a rotate/flip/depth button, a redo) forces the
 *  uncontrolled input to resync rather than showing stale in-progress text. Always used row-nested
 *  (X/Y, Scale X/Y, Rotation/Depth, Col/Row, W/H), hence the hardcoded `flex-1 min-w-0`. */
function NumberField({
  label,
  value,
  onCommit,
  step = 1,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
  step?: number;
}) {
  const id = useId();
  return (
    <div className={cn(fieldClass, 'min-w-0 flex-1')}>
      <Label htmlFor={id} className={fieldLabelClass}>
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        step={step}
        defaultValue={value}
        key={value}
        className={fieldInputClass}
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

function DecorFields({ obj }: { obj: DecorObject }) {
  const update = (patch: Partial<Omit<DecorObject, 'id' | 'kind' | 'asset'>>): void => {
    if (!useEditorStore.getState().updateDecor(obj.id, patch)) {
      console.warn('[editor] decor edit refused — would land on void/out-of-bounds');
    }
  };
  return (
    <div className={fieldsWrapperClass}>
      <p className={placeholderClass} title={obj.asset}>
        Decor: {obj.asset.split('/').pop()}
      </p>
      {obj.region && (
        <p className={placeholderClass} title="Atlas crop — set by the Library's hotspot picker">
          Region: {obj.region.w}×{obj.region.h} @ ({obj.region.x},{obj.region.y})
        </p>
      )}
      {obj.anim && (
        <p className={placeholderClass} title="Animated strip — fps is a fixed placement default">
          Anim: {obj.anim.frames}f {obj.anim.frameWidth}×{obj.anim.frameHeight} @ {obj.anim.fps}fps
        </p>
      )}
      <div className={rowClass}>
        <NumberField label="X" value={obj.x} onCommit={(x) => update({ x })} />
        <NumberField label="Y" value={obj.y} onCommit={(y) => update({ y })} />
      </div>
      <p className={cn(placeholderClass, '-mt-0.5 mb-0.5 text-[0.72rem] opacity-75')}>
        Arrow keys nudge 1px · Shift+Arrow = 1 tile
      </p>
      <div className={rowClass}>
        <NumberField
          label="Scale X"
          value={obj.scaleX}
          step={0.1}
          onCommit={(scaleX) => update({ scaleX })}
        />
        <NumberField
          label="Scale Y"
          value={obj.scaleY}
          step={0.1}
          onCommit={(scaleY) => update({ scaleY })}
        />
      </div>
      <div className={rowClass}>
        <NumberField
          label="Rotation°"
          value={obj.rotation}
          onCommit={(rotation) => update({ rotation })}
        />
        <NumberField label="Depth" value={obj.depth} onCommit={(depth) => update({ depth })} />
      </div>
      <div className={cn(rowClass, 'items-center text-[0.8rem] text-fg-muted')}>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={obj.flipX}
            onChange={(e) => update({ flipX: e.target.checked })}
          />
          Flip X
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={obj.flipY}
            onChange={(e) => update({ flipY: e.target.checked })}
          />
          Flip Y
        </label>
      </div>
    </div>
  );
}

function NodeFields({ obj }: { obj: NodeObject }) {
  const skinId = useId();
  // Subscribe so the picker refreshes if the def's skins change while a node is selected.
  const def = useEditorStore((s) => s.nodeDefsParsed[obj.ref]);
  const update = (patch: Partial<Pick<NodeObject, 'col' | 'row' | 'skin'>>): void => {
    if (!useEditorStore.getState().updateNode(obj.id, patch)) {
      console.warn('[editor] node edit refused — would land on void/out-of-bounds');
    }
  };
  const skins = def?.skins ?? [];
  return (
    <div className={fieldsWrapperClass}>
      <p className={placeholderClass}>Node: {obj.ref}</p>
      <div className={rowClass}>
        <NumberField label="Col" value={obj.col} onCommit={(col) => update({ col })} />
        <NumberField label="Row" value={obj.row} onCommit={(row) => update({ row })} />
      </div>
      {/* Skin override — placement rolls a weighted-random skin (plan 021 step 9); this picker (and the
          'S' cycle shortcut) let you override it. Only shown when the def has a real choice (≥2 skins);
          a single-skin def has nothing to pick. Value falls back to skins[0] when unset (the omitted
          `skin` = the def's default). */}
      {skins.length >= 2 && (
        <div className={fieldClass}>
          <Label htmlFor={skinId} className={fieldLabelClass}>
            Skin
          </Label>
          <Select value={obj.skin ?? skins[0].id} onValueChange={(v) => update({ skin: v })}>
            <SelectTrigger
              id={skinId}
              size="sm"
              className={cn(fieldInputClass, 'w-full justify-between font-normal')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {skins.map((s, i) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.id}
                  {i === 0 ? ' (default)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

const FACINGS: PortalFacing[] = ['up', 'down', 'left', 'right'];

function PortalFields({ obj }: { obj: PortalObject }) {
  const nameId = useId();
  const facingId = useId();
  const update = (patch: Partial<Pick<PortalObject, 'name' | 'facing' | 'rect'>>): void => {
    if (!useEditorStore.getState().updatePortal(obj.id, patch)) {
      console.warn('[editor] portal edit refused — would land on void/out-of-bounds');
    }
  };
  return (
    <div className={fieldsWrapperClass}>
      <div className={fieldClass}>
        <Label htmlFor={nameId} className={fieldLabelClass}>
          Name
        </Label>
        <Input
          id={nameId}
          defaultValue={obj.name}
          key={obj.name}
          className={fieldInputClass}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v.length > 0 && v !== obj.name) update({ name: v });
          }}
        />
      </div>
      <div className={fieldClass}>
        <Label htmlFor={facingId} className={fieldLabelClass}>
          Facing
        </Label>
        {/* Controlled value/onValueChange maps 1:1 onto the old value/onChange native select, so the
            shadcn Select swap carries no behaviour risk (plan 020 Step 7 guidance). */}
        <Select value={obj.facing} onValueChange={(v) => update({ facing: v as PortalFacing })}>
          <SelectTrigger
            id={facingId}
            size="sm"
            className={cn(fieldInputClass, 'w-full justify-between font-normal')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FACINGS.map((f) => (
              <SelectItem key={f} value={f}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className={rowClass}>
        <NumberField
          label="Col"
          value={obj.rect.col}
          onCommit={(col) => update({ rect: { ...obj.rect, col } })}
        />
        <NumberField
          label="Row"
          value={obj.rect.row}
          onCommit={(row) => update({ rect: { ...obj.rect, row } })}
        />
      </div>
      <div className={rowClass}>
        <NumberField
          label="W"
          value={obj.rect.w}
          onCommit={(w) => update({ rect: { ...obj.rect, w } })}
        />
        <NumberField
          label="H"
          value={obj.rect.h}
          onCommit={(h) => update({ rect: { ...obj.rect, h } })}
        />
      </div>
    </div>
  );
}
