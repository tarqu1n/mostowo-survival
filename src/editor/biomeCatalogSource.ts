/**
 * Loader for the biome catalog (`public/assets/tilesets/pixel-crawler/biomes.json`, plan 052 step 6).
 * Mirrors `terrainCatalogSource.ts`'s posture: fetch cache-busted, narrow with `parseBiomeDefs`.
 * Biomes are editor-only content (like `terrains.json`) — fetched, not bundled into the game.
 *
 * Unlike `loadTerrainCatalog`, this does NOT install into the Zustand store yet — no `biomeSlice`
 * (plan 052 step 10) exists to hold the result. Cross-catalog validation
 * (`BiomeValidationContext.decorAssetIds`) is best-effort: it uses whatever asset catalog is already
 * loaded into the store (via `loadCatalog`/`setCatalog`) at call time, and silently skips that one
 * check if the Library hasn't fetched it yet — same graceful-degrade posture `parseBiomeDefs` itself
 * documents. `edgeSetIds` isn't threaded through yet: no typed edge-set catalog loader exists (the
 * terrain generator that will actually consume `edge-sets/*.json`, plan 052 step 7, is what first
 * needs one) — `terrain.base`/`bands[].edgeSetId` get shape validation only until then.
 */
import { ACTIVE_TILESET } from '../data/tileset';
import { tilesetAssetUrl } from './textureLoading';
import { parseBiomeDefs, type BiomeDef } from '../systems/biomeDefs';
import { useEditorStore } from './store/editorStore';

export async function loadBiomeCatalog(): Promise<Record<string, BiomeDef>> {
  const url = `${tilesetAssetUrl(ACTIVE_TILESET.id, 'biomes.json')}?t=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const json = (await res.json()) as unknown;

  const catalog = useEditorStore.getState().catalog;
  const decorAssetIds = catalog === null ? undefined : new Set(catalog.assets.map((a) => a.id));

  return parseBiomeDefs(json, { decorAssetIds });
}
