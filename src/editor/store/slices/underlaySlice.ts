import { TILE_SIZE } from '../../../config';
import { toast } from 'sonner';
import { getMapReferenceSidecar, mapReferenceImageUrl } from '../../api';
import { computeAutoAlign, parseSidecar, type AutoAlign } from '../../underlayAlign';
import {
  deleteSettings,
  getCachedImage,
  getSettings,
  putCachedImage,
  putSettings,
  type UnderlaySettings,
} from '../../underlayStore';
import type { EditorSlice, EditorState, UnderlayState } from '../types';

/** Starting opacity for a freshly-picked underlay — a shade above the `GHOST_ALPHA=0.4` precedent so
 *  the trace-over image reads clearly while tile layers still paint legibly on top. */
const DEFAULT_UNDERLAY_OPACITY = 0.5;
/** Read a `Blob`/`File` as a base64 data URL (`FileReader`) — used for both fetched reference PNGs
 *  and ad-hoc picked/dropped files, so a single data-URI path feeds `load.image` and `localStorage`
 *  (plan 022's no-object-URL simplification). Rejects on a read error. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}
/** Decode a data URL just far enough to read its intrinsic pixel size — needed so `computeAutoAlign`
 *  can compare the actually-loaded image against the sidecar's recorded dimensions. */
function imageSizeFromDataUrl(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = dataUrl;
  });
}
/** Strip the in-memory `dataUrl` off a live `UnderlayState`, leaving the `UnderlaySettings` half that
 *  is what actually persists to `localStorage` (the data URL is re-resolved on load, never stored in
 *  the settings blob). */
function settingsOf(u: UnderlayState): UnderlaySettings {
  return {
    referenceName: u.referenceName,
    visible: u.visible,
    locked: u.locked,
    opacity: u.opacity,
    offsetX: u.offsetX,
    offsetY: u.offsetY,
    scale: u.scale,
  };
}
/** Fetch `url` and resolve to a base64 data URL (throws on a non-OK response). */
async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status} ${res.statusText}`);
  return blobToDataUrl(await res.blob());
}

export const underlaySlice: EditorSlice<
  Pick<
    EditorState,
    | 'underlay'
    | 'underlayRevision'
    | 'setUnderlayReference'
    | 'setUnderlayImageFromFile'
    | 'clearUnderlay'
    | 'setUnderlayOpacity'
    | 'setUnderlayOffset'
    | 'setUnderlayScale'
    | 'toggleUnderlayVisible'
    | 'toggleUnderlayLock'
    | 'hydrateUnderlay'
    | 'syncUnderlayFromSettings'
  >
> = (set, get) => ({
  underlay: null,
  underlayRevision: 0,
  // ---- reference underlay (plan 022 step 4) ----

  setUnderlayReference: async (name) => {
    const mapId = get().mapId;
    if (!mapId) return;
    // Cache first (deduped by reference name across maps), else fetch the committed PNG + cache it.
    let dataUrl = getCachedImage(name);
    if (dataUrl === null) {
      try {
        dataUrl = await fetchAsDataUrl(mapReferenceImageUrl(name));
      } catch (e) {
        toast.error(`Couldn't load reference "${name}": ${(e as Error).message}`);
        return;
      }
      if (get().mapId !== mapId) return; // map swapped during the fetch — abandon
      putCachedImage(name, dataUrl);
    }
    // Auto-align from the sidecar (optional). Any failure degrades to identity — non-fatal.
    let align: AutoAlign = { scale: 1, offsetX: 0, offsetY: 0 };
    try {
      const size = await imageSizeFromDataUrl(dataUrl);
      if (get().mapId !== mapId) return;
      const sidecarJson = await getMapReferenceSidecar(name);
      if (get().mapId !== mapId) return;
      // Centre the reference over the map so the captured centre coordinate lands at the map's
      // centre (the reference PNG is captured centred on that coordinate — see `capture.mjs`).
      const meta = get().map?.meta;
      align = computeAutoAlign({
        sidecar: parseSidecar(sidecarJson),
        imageW: size.w,
        imageH: size.h,
        tileSize: TILE_SIZE,
        mapWidth: meta?.width,
        mapHeight: meta?.height,
      });
    } catch (e) {
      console.warn(`[editor] underlay auto-align failed for "${name}":`, e);
    }
    if (align.warning) toast.warning(align.warning);
    const settings: UnderlaySettings = {
      referenceName: name,
      visible: true,
      locked: false,
      opacity: DEFAULT_UNDERLAY_OPACITY,
      offsetX: align.offsetX,
      offsetY: align.offsetY,
      scale: align.scale,
    };
    if (get().mapId !== mapId) return;
    putSettings(mapId, settings);
    set((s) => ({
      underlay: { ...settings, dataUrl },
      underlayRevision: s.underlayRevision + 1,
    }));
  },

  setUnderlayImageFromFile: async (file) => {
    const mapId = get().mapId;
    if (!mapId) return;
    let dataUrl: string;
    try {
      dataUrl = await blobToDataUrl(file);
    } catch (e) {
      toast.error(`Couldn't read image file: ${(e as Error).message}`);
      return;
    }
    if (get().mapId !== mapId) return; // map swapped during the read — abandon
    // No sidecar for an ad-hoc file → identity align (imageW/H irrelevant with sidecar absent).
    const align = computeAutoAlign({ sidecar: null, imageW: 0, imageH: 0, tileSize: TILE_SIZE });
    const settings: UnderlaySettings = {
      referenceName: null,
      visible: true,
      locked: false,
      opacity: DEFAULT_UNDERLAY_OPACITY,
      offsetX: align.offsetX,
      offsetY: align.offsetY,
      scale: align.scale,
    };
    putSettings(mapId, settings);
    set((s) => ({
      underlay: { ...settings, dataUrl },
      underlayRevision: s.underlayRevision + 1,
    }));
  },

  clearUnderlay: () => {
    const mapId = get().mapId;
    if (!mapId) return;
    deleteSettings(mapId);
    set((s) => ({ underlay: null, underlayRevision: s.underlayRevision + 1 }));
  },

  setUnderlayOpacity: (opacity) => {
    const { underlay, mapId } = get();
    if (!underlay || !mapId) return;
    const next: UnderlayState = { ...underlay, opacity };
    putSettings(mapId, settingsOf(next));
    set((s) => ({ underlay: next, underlayRevision: s.underlayRevision + 1 }));
  },

  setUnderlayOffset: (offsetX, offsetY) => {
    const { underlay, mapId } = get();
    if (!underlay || !mapId) return;
    const next: UnderlayState = { ...underlay, offsetX, offsetY };
    putSettings(mapId, settingsOf(next));
    set((s) => ({ underlay: next, underlayRevision: s.underlayRevision + 1 }));
  },

  setUnderlayScale: (scale) => {
    const { underlay, mapId } = get();
    if (!underlay || !mapId) return;
    const next: UnderlayState = { ...underlay, scale };
    putSettings(mapId, settingsOf(next));
    set((s) => ({ underlay: next, underlayRevision: s.underlayRevision + 1 }));
  },

  toggleUnderlayVisible: () => {
    const { underlay, mapId } = get();
    if (!underlay || !mapId) return;
    const next: UnderlayState = { ...underlay, visible: !underlay.visible };
    putSettings(mapId, settingsOf(next));
    set((s) => ({ underlay: next, underlayRevision: s.underlayRevision + 1 }));
  },

  toggleUnderlayLock: () => {
    const { underlay, mapId } = get();
    if (!underlay || !mapId) return;
    const next: UnderlayState = { ...underlay, locked: !underlay.locked };
    putSettings(mapId, settingsOf(next));
    set((s) => ({ underlay: next, underlayRevision: s.underlayRevision + 1 }));
  },

  hydrateUnderlay: async (mapId) => {
    const settings = getSettings(mapId);
    // Only committed references are re-resolvable; ad-hoc file images (referenceName === null) have
    // no cache key, so their bytes don't survive a reload — skip them.
    if (!settings || !settings.referenceName) return;
    const name = settings.referenceName;
    let dataUrl = getCachedImage(name);
    if (dataUrl === null) {
      try {
        dataUrl = await fetchAsDataUrl(mapReferenceImageUrl(name));
      } catch (e) {
        console.warn(`[editor] couldn't restore underlay "${name}":`, e);
        return; // non-fatal — leave `underlay` null
      }
      if (get().mapId !== mapId) return; // map swapped during the fetch — abandon
      putCachedImage(name, dataUrl);
    }
    if (get().mapId !== mapId) return;
    set((s) => ({
      underlay: { ...settings, dataUrl },
      underlayRevision: s.underlayRevision + 1,
    }));
  },

  syncUnderlayFromSettings: () => {
    const mapId = get().mapId;
    if (!mapId) return;
    const s = getSettings(mapId);
    const u = get().underlay;
    if (u && s && (u.offsetX !== s.offsetX || u.offsetY !== s.offsetY || u.scale !== s.scale)) {
      set((st) => ({
        underlay: { ...u, offsetX: s.offsetX, offsetY: s.offsetY, scale: s.scale },
        underlayRevision: st.underlayRevision + 1,
      }));
    }
  },
});
