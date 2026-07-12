# Pixel Crawler tileset tooling

Small Python (Pillow + numpy) helpers used to explore the **Pixel Crawler** pack and stitch the demo
maps. They read the committed PNGs under `public/assets/tilesets/pixel-crawler/` and write outputs
under `docs/assets/pixel-crawler/`. Dev-only — **not** part of the game build.

## Setup

```sh
python3 -m pip install pillow numpy
```

## Scripts

|Script|What it does|
|---|---|
|`compose.py`|Shared lib: loads sheets, crops tiles/objects, tile-grid previews. Sets `PC` = the in-repo asset dir.|
|`gridoverlay.py`|Overlays a numbered 16px grid on a sheet → read exact `(col,row)` tile indices. `python3 gridoverlay.py <sheet.png> <out.png> [tile]`|
|`analyze.py`|Detects **seamless fill tiles** (opaque + self-tiling) per sheet → the terrain fills table. `python3 analyze.py <sheet.png> …`|
|`objects.py`|Extracts individual objects from multi-object sheets via **connected-component bounding boxes**; `preview_components()` dumps numbered contact sheets.|
|`extract.py`|Reusable CLI wrapping `objects.py`: `--list <sheet-rel>` previews components, `<sheet-rel> <index> <out-rel>` extracts one to `_derived/`, `--scan [dir]` flags multi-object sheets pack-wide. See `docs/ASSETS.md` "Sprite extraction pipeline".|
|`blob_map.py`|Prints each tile's edge/corner alpha **signature** for a terrain block — how the blob template was reverse-engineered.|
|`autotile.py`|The **8-neighbour blob autotiler**: `build_blob()` (colour-gated per-terrain table), `paint_mask()` (paint any terrain mask with smooth edges/corners + variety), `smooth_mask()`/`disc()` mask helpers.|
|`compose_demos.py`|Builds the 3 demo maps: autotiled terrain + depth-sorted objects + thinning tree borders. **`python3 compose_demos.py`** → `docs/assets/pixel-crawler/demos/`.|

## Regenerate the demos

```sh
python3 scripts/pixel-crawler/compose_demos.py
```

Deterministic (`random.seed(7)`), so output is stable across machines. Fill-tile indices and object
indices are documented in the pack's own
[`README.md`](../../public/assets/tilesets/pixel-crawler/README.md).
