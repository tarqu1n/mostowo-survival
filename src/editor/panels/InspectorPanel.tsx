import { useEditorStore } from '../store/editorStore';
import type {
  DecorObject,
  MapObject,
  NodeObject,
  PortalFacing,
  PortalObject,
} from '../../systems/mapFormat';

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
export function InspectorPanel() {
  const selectedObjectIds = useEditorStore((s) => s.selectedObjectIds);
  useEditorStore((s) => s.docRevision);
  useEditorStore((s) => s.mapEpoch);

  const map = useEditorStore.getState().map;

  if (!map) {
    return (
      <>
        <h2>Inspector</h2>
        <p className="editor-placeholder">No map open.</p>
      </>
    );
  }

  const selected = map.objects.filter((o) => selectedObjectIds.includes(o.id));

  if (selected.length === 0) {
    return (
      <>
        <h2>Inspector</h2>
        <p className="editor-placeholder">No selection.</p>
      </>
    );
  }

  const ids = selected.map((o) => o.id);
  const hasDecor = selected.some((o) => o.kind === 'decor');

  return (
    <>
      <h2>Inspector</h2>
      {selected.length === 1 ? (
        <SingleObjectFields obj={selected[0]} />
      ) : (
        <p className="editor-placeholder">{selected.length} objects selected.</p>
      )}
      <div className="insp-actions">
        <button
          disabled={!hasDecor}
          title="Rotate the selected decor -90°"
          onClick={() => useEditorStore.getState().rotateObjects(ids, -90)}
        >
          ⟲ -90°
        </button>
        <button
          disabled={!hasDecor}
          title="Rotate the selected decor +90°"
          onClick={() => useEditorStore.getState().rotateObjects(ids, 90)}
        >
          ⟳ +90°
        </button>
        <button
          disabled={!hasDecor}
          onClick={() => useEditorStore.getState().flipObjects(ids, 'x')}
        >
          Flip H
        </button>
        <button
          disabled={!hasDecor}
          onClick={() => useEditorStore.getState().flipObjects(ids, 'y')}
        >
          Flip V
        </button>
        <button
          disabled={!hasDecor}
          title="Bring forward (stack on top)"
          onClick={() => useEditorStore.getState().bumpDepth(ids, 1)}
        >
          Bring forward
        </button>
        <button
          disabled={!hasDecor}
          title="Send backward (stack underneath)"
          onClick={() => useEditorStore.getState().bumpDepth(ids, -1)}
        >
          Send back
        </button>
        <button onClick={() => useEditorStore.getState().duplicateObjects(ids)}>Duplicate</button>
        <button onClick={() => useEditorStore.getState().deleteObjects(ids)}>Delete</button>
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
 *  uncontrolled input to resync rather than showing stale in-progress text. */
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
  return (
    <label className="insp-field">
      {label}
      <input
        type="number"
        step={step}
        defaultValue={value}
        key={value}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n !== value) onCommit(n);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

function DecorFields({ obj }: { obj: DecorObject }) {
  const update = (patch: Partial<Omit<DecorObject, 'id' | 'kind' | 'asset'>>): void => {
    if (!useEditorStore.getState().updateDecor(obj.id, patch)) {
      console.warn('[editor] decor edit refused — would land on void/out-of-bounds');
    }
  };
  return (
    <div className="insp-fields">
      <p className="editor-placeholder" title={obj.asset}>
        Decor: {obj.asset.split('/').pop()}
      </p>
      <div className="insp-field-row">
        <NumberField label="X" value={obj.x} onCommit={(x) => update({ x })} />
        <NumberField label="Y" value={obj.y} onCommit={(y) => update({ y })} />
      </div>
      <div className="insp-field-row">
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
      <div className="insp-field-row">
        <NumberField
          label="Rotation°"
          value={obj.rotation}
          onCommit={(rotation) => update({ rotation })}
        />
        <NumberField label="Depth" value={obj.depth} onCommit={(depth) => update({ depth })} />
      </div>
      <div className="insp-field-row insp-checkboxes">
        <label>
          <input
            type="checkbox"
            checked={obj.flipX}
            onChange={(e) => update({ flipX: e.target.checked })}
          />
          Flip X
        </label>
        <label>
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
  const update = (patch: Partial<Pick<NodeObject, 'col' | 'row'>>): void => {
    if (!useEditorStore.getState().updateNode(obj.id, patch)) {
      console.warn('[editor] node edit refused — would land on void/out-of-bounds');
    }
  };
  return (
    <div className="insp-fields">
      <p className="editor-placeholder">Node: {obj.ref}</p>
      <div className="insp-field-row">
        <NumberField label="Col" value={obj.col} onCommit={(col) => update({ col })} />
        <NumberField label="Row" value={obj.row} onCommit={(row) => update({ row })} />
      </div>
    </div>
  );
}

const FACINGS: PortalFacing[] = ['up', 'down', 'left', 'right'];

function PortalFields({ obj }: { obj: PortalObject }) {
  const update = (patch: Partial<Pick<PortalObject, 'name' | 'facing' | 'rect'>>): void => {
    if (!useEditorStore.getState().updatePortal(obj.id, patch)) {
      console.warn('[editor] portal edit refused — would land on void/out-of-bounds');
    }
  };
  return (
    <div className="insp-fields">
      <label className="insp-field">
        Name
        <input
          defaultValue={obj.name}
          key={obj.name}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v.length > 0 && v !== obj.name) update({ name: v });
          }}
        />
      </label>
      <label className="insp-field">
        Facing
        <select
          value={obj.facing}
          onChange={(e) => update({ facing: e.target.value as PortalFacing })}
        >
          {FACINGS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <div className="insp-field-row">
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
      <div className="insp-field-row">
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
