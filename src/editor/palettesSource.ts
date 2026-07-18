/**
 * Loader + autosave subscriber for the editor's GLOBAL tile palettes (`src/data/maps/palettes.json`,
 * plan 033 step 9). Mirrors `nodeDefsSource.ts`'s posture: fetches through the dev-only editor API
 * (`getPalettes`) rather than a `public/` static file — `palettes.json` lives under `src/data/maps/`,
 * served live for editing only via `scripts/vite-editor-api.mjs`'s `GET/PUT /__editor/palettes`.
 *
 * Unlike node-defs (a manual Save), palettes are AUTO-SAVED: every add/remove immediately mutates the
 * store's `tilePalettes` slice, and `installPaletteAutosave` debounces those changes back to disk. So
 * there is no manual Save button and no undo for palettes — the file on disk is always the live slice.
 */
import { getPalettes, putPalettes } from './api';
import { useEditorStore } from './store/editorStore';
import type { NamedTilePalette } from '../systems/mapFormat';

/** Debounce (ms) for the autosave write — coalesces a burst of edits (e.g. a multi-tile "Add (N)")
 *  into one PUT. */
const AUTOSAVE_DEBOUNCE_MS = 400;

interface PalettesFile {
  palettes: NamedTilePalette[];
}

/** Best-effort narrowing of the raw `palettes.json` shape. Defensive: a shape mismatch (or a genuine
 *  404 caught here) falls back to an empty set rather than throwing, so a missing/corrupt file just
 *  starts the editor with no palettes. A thrown NETWORK error propagates to the caller's `.catch`
 *  (mirrors `loadNodeDefs` letting a fetch failure surface). */
export async function loadPalettes(): Promise<void> {
  let file: PalettesFile = { palettes: [] };
  try {
    const json = await getPalettes();
    if (
      json &&
      typeof json === 'object' &&
      Array.isArray((json as { palettes?: unknown }).palettes)
    ) {
      file = json as PalettesFile;
    }
  } catch (e) {
    // A 404 (no file yet) is expected on a fresh checkout — treat it as "no palettes". Any other
    // network error is genuinely exceptional: re-throw so the boot caller can warn.
    if (!(e instanceof Error) || !/404/.test(e.message)) throw e;
  }
  useEditorStore.getState().setTilePalettes(file.palettes ?? []);
}

/** Subscribe to `tilePalettes` changes and debounce-persist them to `palettes.json`. Returns the
 *  unsubscribe fn. A failed PUT warns (console) but never throws into the store's notify loop. Install
 *  this AFTER the initial `loadPalettes()` resolves so the load's own `setTilePalettes` doesn't
 *  immediately re-save. */
export function installPaletteAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduleSave = (palettes: NamedTilePalette[]): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void putPalettes(`${JSON.stringify({ palettes }, null, 2)}\n`).catch((e: unknown) => {
        console.warn('[editor] palettes autosave failed:', (e as Error).message);
      });
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  return useEditorStore.subscribe(
    (s) => s.tilePalettes,
    (palettes) => scheduleSave(palettes),
  );
}
