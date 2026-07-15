/**
 * Shared loader for the generated terrain-defs file (`public/assets/tilesets/pixel-crawler/terrains.json`,
 * plan 014 step 10). Mirrors `catalogSource.ts`'s posture exactly: fetch cache-busted, narrow with
 * `parseTerrainCatalog`, install into the editor store via `setTerrainCatalog`. Called once from the
 * Library panel's mount effect (alongside `loadCatalog`) so the terrain catalog is resident before the
 * Library's Terrains category (or a Save's pre-serialize full rebake) needs it.
 */
import { ACTIVE_TILESET } from '../data/tileset';
import { tilesetAssetUrl } from './textureLoading';
import { parseTerrainCatalog, type TerrainCatalog } from './terrainCatalog';
import { useEditorStore } from './store/editorStore';

export async function loadTerrainCatalog(): Promise<TerrainCatalog> {
  const url = `${tilesetAssetUrl(ACTIVE_TILESET.id, 'terrains.json')}?t=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const json = (await res.json()) as unknown;
  const parsed = parseTerrainCatalog(json);
  useEditorStore.getState().setTerrainCatalog(parsed);
  return parsed;
}
