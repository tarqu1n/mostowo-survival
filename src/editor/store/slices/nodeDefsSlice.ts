import { toast } from 'sonner';
import { NODES } from '../../../data/nodes';
import nodesJson from '../../../data/maps/nodes.json';
import {
  parseNodeDefs,
  type AuthoredNodeDef,
  type NodeDefsFile,
  type NodeSkinDef,
  type ParsedNodeDef,
} from '../../../systems/nodeDefs';
import { ITEMS } from '../../../data/items';
import type { MapFile } from '../../../systems/mapFormat';
import type { EditorSlice, EditorState } from '../types';

// ---- node defs registry helpers (plan 021 step 7) ----

/** Validates a candidate node-defs array as a whole `NodeDefsFile` (`{version:1, defs: candidate}`)
 *  via `parseNodeDefs` — the single choke point every node-def mutation (create/duplicate/update/
 *  delete/skin sub-actions) AND `setNodeDefs`'s initial/reload install commit through. Never throws
 *  itself; callers toast `error` and leave state untouched on failure. */
function tryParseNodeDefs(
  candidate: AuthoredNodeDef[],
): { ok: true; parsed: Record<string, ParsedNodeDef> } | { ok: false; error: string } {
  try {
    return { ok: true, parsed: parseNodeDefs({ version: 1, defs: candidate }) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Lowest-numbered free id of the form `base`, `base_2`, `base_3`, … not already present in
 *  `existing` — node-def ids and per-def skin ids are freeform authored strings (unlike the
 *  sequential `prefix_0001` scheme `nextObjectId` mints for placed map objects), so a fresh one just
 *  needs to dodge whatever's already taken. */
function freshId(existing: Iterable<string>, base: string): string {
  const used = new Set(existing);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Placeholder skin asset id stamped by `createNodeDef`/`addSkin` — passes `parseNodeDefs` (which
 *  only requires a non-empty string) but isn't a real catalog asset. The Node Types panel (plan 021
 *  step 8) is expected to replace it via the region/asset picker before the def is placed or saved
 *  for real use; the world-integrity test (`src/data/maps/__tests__/world.test.ts`) catches an
 *  unreplaced placeholder landing in a COMMITTED `nodes.json` (it cross-checks every def's skins
 *  against the asset catalog). */
export const PLACEHOLDER_SKIN_ASSET = '__unassigned__';

/** Fallback `yieldItemId` for a freshly-created def — the first entry in `ITEMS` (deterministic; and
 *  always valid — `parseNodeDefs` would refuse the candidate anyway if `ITEMS` were somehow empty). */
const DEFAULT_YIELD_ITEM_ID = Object.keys(ITEMS)[0] ?? 'wood';

function defaultAuthoredNodeDef(id: string): AuthoredNodeDef {
  return {
    id,
    name: 'New node',
    maxHp: 10,
    yieldItemId: DEFAULT_YIELD_ITEM_ID,
    yieldPerHit: 1,
    regrowMs: 60_000,
    blocksPath: true,
    color: 0xffffff,
    stumpColor: 0x808080,
    scale: 1,
    originX: 0.5,
    originY: 1,
    skins: [{ id: 'default', asset: PLACEHOLDER_SKIN_ASSET, weight: 1 }],
  };
}

/** True if the CURRENTLY OPEN map places a `kind:'node'` object referencing `defId` (optionally also
 *  matching a specific `skinId`) — the delete-guard's cross-ref check. See `deleteNodeDef`/
 *  `removeSkin`'s interface docs for the open-map-only limitation (this store holds one open
 *  `MapFile` at a time, not every committed map). */
function openMapReferencesNodeDef(map: MapFile | null, defId: string, skinId?: string): boolean {
  if (!map) return false;
  return map.objects.some(
    (obj) =>
      obj.kind === 'node' && obj.ref === defId && (skinId === undefined || obj.skin === skinId),
  );
}

export const nodeDefsSlice: EditorSlice<
  Pick<
    EditorState,
    | 'nodeDefs'
    | 'nodeDefsParsed'
    | 'nodeDefsDirty'
    | 'nodeDefsRevision'
    | 'setNodeDefs'
    | 'markNodeDefsSaved'
    | 'createNodeDef'
    | 'duplicateNodeDef'
    | 'updateNodeDef'
    | 'deleteNodeDef'
    | 'addSkin'
    | 'updateSkin'
    | 'removeSkin'
    | 'moveSkin'
  >
> = (set, get) => ({
  // Seeded synchronously from the bundled JSON (see `nodeDefs`/`nodeDefsParsed`'s interface docs) —
  // `NODES` (src/data/nodes.ts) IS `parseNodeDefs(nodesJson)`, reused here directly as the initial
  // parsed view so it's byte-identical to boot-time NODES until `loadNodeDefs()` overwrites it with
  // whatever's actually on disk via the editor API.
  nodeDefs: (nodesJson as NodeDefsFile).defs,
  nodeDefsParsed: NODES,
  nodeDefsDirty: false,
  nodeDefsRevision: 0,
  setNodeDefs: (defs) => {
    const result = tryParseNodeDefs(defs);
    if (!result.ok) {
      toast.error(`Couldn't load node defs: ${result.error}`);
      return;
    }
    set((s) => ({
      nodeDefs: defs,
      nodeDefsParsed: result.parsed,
      nodeDefsDirty: false,
      nodeDefsRevision: s.nodeDefsRevision + 1,
    }));
  },
  markNodeDefsSaved: () => set({ nodeDefsDirty: false }),
  // ---- node defs registry (plan 021 step 7) ----

  createNodeDef: () => {
    const { nodeDefs } = get();
    const id = freshId(
      nodeDefs.map((d) => d.id),
      'node',
    );
    const candidate = [...nodeDefs, defaultAuthoredNodeDef(id)];
    const result = tryParseNodeDefs(candidate);
    if (!result.ok) {
      toast.error(`Couldn't create node def: ${result.error}`);
      return null;
    }
    set((s) => ({
      nodeDefs: candidate,
      nodeDefsParsed: result.parsed,
      nodeDefsDirty: true,
      nodeDefsRevision: s.nodeDefsRevision + 1,
    }));
    return id;
  },

  duplicateNodeDef: (id) => {
    const { nodeDefs } = get();
    const source = nodeDefs.find((d) => d.id === id);
    if (!source) {
      toast.error(`Can't duplicate — node def "${id}" not found`);
      return null;
    }
    const newId = freshId(
      nodeDefs.map((d) => d.id),
      `${id}_copy`,
    );
    // Deep-copy via JSON round-trip (mirrors `serializeMap`'s posture elsewhere) — `AuthoredNodeDef`
    // is plain JSON-shaped data, no functions/Dates/etc to worry about losing.
    const cloned = JSON.parse(JSON.stringify(source)) as AuthoredNodeDef;
    const copy: AuthoredNodeDef = { ...cloned, id: newId, name: `${source.name} copy` };
    const candidate = [...nodeDefs, copy];
    const result = tryParseNodeDefs(candidate);
    if (!result.ok) {
      toast.error(`Couldn't duplicate node def: ${result.error}`);
      return null;
    }
    set((s) => ({
      nodeDefs: candidate,
      nodeDefsParsed: result.parsed,
      nodeDefsDirty: true,
      nodeDefsRevision: s.nodeDefsRevision + 1,
    }));
    return newId;
  },

  updateNodeDef: (id, patch) => {
    const { nodeDefs } = get();
    const index = nodeDefs.findIndex((d) => d.id === id);
    if (index < 0) {
      toast.error(`Can't update — node def "${id}" not found`);
      return false;
    }
    const candidate = nodeDefs.slice();
    candidate[index] = { ...candidate[index], ...patch, id, skins: candidate[index].skins };
    const result = tryParseNodeDefs(candidate);
    if (!result.ok) {
      toast.error(`Invalid node def: ${result.error}`);
      return false;
    }
    set((s) => ({
      nodeDefs: candidate,
      nodeDefsParsed: result.parsed,
      nodeDefsDirty: true,
      nodeDefsRevision: s.nodeDefsRevision + 1,
    }));
    return true;
  },

  deleteNodeDef: (id) => {
    const { nodeDefs, map } = get();
    const index = nodeDefs.findIndex((d) => d.id === id);
    if (index < 0) {
      toast.error(`Can't delete — node def "${id}" not found`);
      return false;
    }
    if (openMapReferencesNodeDef(map, id)) {
      toast.error(`Can't delete "${id}" — it's still placed in the open map`);
      return false;
    }
    const candidate = nodeDefs.slice();
    candidate.splice(index, 1);
    const result = tryParseNodeDefs(candidate);
    if (!result.ok) {
      toast.error(`Couldn't delete node def: ${result.error}`);
      return false;
    }
    set((s) => ({
      nodeDefs: candidate,
      nodeDefsParsed: result.parsed,
      nodeDefsDirty: true,
      nodeDefsRevision: s.nodeDefsRevision + 1,
    }));
    return true;
  },

  addSkin: (defId) => {
    const { nodeDefs } = get();
    const defIndex = nodeDefs.findIndex((d) => d.id === defId);
    if (defIndex < 0) {
      toast.error(`Can't add skin — node def "${defId}" not found`);
      return null;
    }
    const def = nodeDefs[defIndex];
    const skinId = freshId(
      def.skins.map((s) => s.id),
      'skin',
    );
    const newSkin: NodeSkinDef = { id: skinId, asset: PLACEHOLDER_SKIN_ASSET, weight: 1 };
    const candidate = nodeDefs.slice();
    candidate[defIndex] = { ...def, skins: [...def.skins, newSkin] };
    const result = tryParseNodeDefs(candidate);
    if (!result.ok) {
      toast.error(`Couldn't add skin: ${result.error}`);
      return null;
    }
    set((s) => ({
      nodeDefs: candidate,
      nodeDefsParsed: result.parsed,
      nodeDefsDirty: true,
      nodeDefsRevision: s.nodeDefsRevision + 1,
    }));
    return skinId;
  },

  updateSkin: (defId, skinId, patch) => {
    const { nodeDefs } = get();
    const defIndex = nodeDefs.findIndex((d) => d.id === defId);
    if (defIndex < 0) {
      toast.error(`Can't update skin — node def "${defId}" not found`);
      return false;
    }
    const def = nodeDefs[defIndex];
    const skinIndex = def.skins.findIndex((s) => s.id === skinId);
    if (skinIndex < 0) {
      toast.error(`Can't update skin — "${skinId}" not found on def "${defId}"`);
      return false;
    }
    const skins = def.skins.slice();
    skins[skinIndex] = { ...skins[skinIndex], ...patch, id: skinId };
    const candidate = nodeDefs.slice();
    candidate[defIndex] = { ...def, skins };
    const result = tryParseNodeDefs(candidate);
    if (!result.ok) {
      toast.error(`Invalid skin: ${result.error}`);
      return false;
    }
    set((s) => ({
      nodeDefs: candidate,
      nodeDefsParsed: result.parsed,
      nodeDefsDirty: true,
      nodeDefsRevision: s.nodeDefsRevision + 1,
    }));
    return true;
  },

  removeSkin: (defId, skinId) => {
    const { nodeDefs, map } = get();
    const defIndex = nodeDefs.findIndex((d) => d.id === defId);
    if (defIndex < 0) {
      toast.error(`Can't remove skin — node def "${defId}" not found`);
      return false;
    }
    const def = nodeDefs[defIndex];
    const skinIndex = def.skins.findIndex((s) => s.id === skinId);
    if (skinIndex < 0) {
      toast.error(`Can't remove skin — "${skinId}" not found on def "${defId}"`);
      return false;
    }
    if (openMapReferencesNodeDef(map, defId, skinId)) {
      toast.error(`Can't remove skin "${skinId}" — it's still placed on a node in the open map`);
      return false;
    }
    const skins = def.skins.slice();
    skins.splice(skinIndex, 1);
    const candidate = nodeDefs.slice();
    candidate[defIndex] = { ...def, skins };
    // parseNodeDefs itself refuses an empty `skins` array — no separate "last skin" check needed.
    const result = tryParseNodeDefs(candidate);
    if (!result.ok) {
      toast.error(`Couldn't remove skin: ${result.error}`);
      return false;
    }
    set((s) => ({
      nodeDefs: candidate,
      nodeDefsParsed: result.parsed,
      nodeDefsDirty: true,
      nodeDefsRevision: s.nodeDefsRevision + 1,
    }));
    return true;
  },

  moveSkin: (defId, skinId, toIndex) => {
    const { nodeDefs } = get();
    const defIndex = nodeDefs.findIndex((d) => d.id === defId);
    if (defIndex < 0) {
      toast.error(`Can't reorder skins — node def "${defId}" not found`);
      return false;
    }
    const def = nodeDefs[defIndex];
    const skinIndex = def.skins.findIndex((s) => s.id === skinId);
    if (skinIndex < 0) {
      toast.error(`Can't reorder skins — "${skinId}" not found on def "${defId}"`);
      return false;
    }
    const skins = def.skins.slice();
    const [moved] = skins.splice(skinIndex, 1);
    const clampedIndex = Math.max(0, Math.min(toIndex, skins.length));
    skins.splice(clampedIndex, 0, moved);
    const candidate = nodeDefs.slice();
    candidate[defIndex] = { ...def, skins };
    const result = tryParseNodeDefs(candidate);
    if (!result.ok) {
      toast.error(`Couldn't reorder skins: ${result.error}`);
      return false;
    }
    set((s) => ({
      nodeDefs: candidate,
      nodeDefsParsed: result.parsed,
      nodeDefsDirty: true,
      nodeDefsRevision: s.nodeDefsRevision + 1,
    }));
    return true;
  },
});
