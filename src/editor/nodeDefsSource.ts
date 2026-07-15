/**
 * Shared loader for the authored node-defs registry (`src/data/maps/nodes.json`, plan 021 step 7).
 * Mirrors `catalogSource.ts`/`terrainCatalogSource.ts`'s posture, but fetches through the dev-only
 * editor API (`getNodes`) rather than a `public/` static file — `nodes.json` lives under
 * `src/data/maps/`, bundled at build time (see `src/data/nodes.ts`) and served live for editing only
 * via `scripts/vite-editor-api.mjs`'s `GET /__editor/nodes`. Validates the WHOLE file with
 * `parseNodeDefs` before handing its `defs` array to the store (`setNodeDefs` re-validates too — see
 * that action's doc — so an invalid fetch surfaces a toast and leaves the bundled seed/prior load in
 * place rather than corrupting the store). Called once from the Library panel's mount effect
 * (alongside `loadCatalog`/`loadTerrainCatalog`) so the store reflects whatever's actually committed
 * to disk, not just the build-time seed.
 */
import { getNodes } from './api';
import { parseNodeDefs, type NodeDefsFile } from '../systems/nodeDefs';
import { useEditorStore } from './store/editorStore';

export async function loadNodeDefs(): Promise<void> {
  const json = await getNodes();
  parseNodeDefs(json); // throws with a precise message if the committed file is somehow invalid
  useEditorStore.getState().setNodeDefs((json as NodeDefsFile).defs);
}
