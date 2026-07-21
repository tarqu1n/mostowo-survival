import { type Command } from '../history';
import type { EditorSlice, EditorState } from '../types';

export const favouritesSlice: EditorSlice<Pick<EditorState, 'toggleFavourite'>> = (_set, get) => ({
  // ---- favourites ----

  toggleFavourite: (assetId) => {
    const map = get().map;
    if (!map) return;
    const zoneId = get().activeZoneId;

    if (zoneId !== null) {
      const zoneDef = map.zones.defs.find((z) => z.id === zoneId);
      if (!zoneDef) return;
      const has = zoneDef.favourites.includes(assetId);
      const cmd: Command = {
        do: () => {
          zoneDef.favourites = has
            ? zoneDef.favourites.filter((a) => a !== assetId)
            : [...zoneDef.favourites, assetId];
        },
        undo: () => {
          zoneDef.favourites = has
            ? [...zoneDef.favourites, assetId]
            : zoneDef.favourites.filter((a) => a !== assetId);
        },
      };
      get().applyCommand(cmd);
      return;
    }

    const has = (map.meta.favourites ?? []).includes(assetId);
    const cmd: Command = {
      do: () => {
        const current = map.meta.favourites ?? [];
        map.meta.favourites = has ? current.filter((a) => a !== assetId) : [...current, assetId];
      },
      undo: () => {
        const current = map.meta.favourites ?? [];
        map.meta.favourites = has ? [...current, assetId] : current.filter((a) => a !== assetId);
      },
    };
    get().applyCommand(cmd);
  },
});
