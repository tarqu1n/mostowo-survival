# Assets & Art Pipeline

How we make and manage art. Direction lives in [GAME-DESIGN.md](GAME-DESIGN.md#art-direction);
this is the *how*.

## Art direction (summary)

**Slightly dark and grotty, but humorous.** Grimy survival-horror palette, comic item/enemy visuals,
visual gags. Readable at small pixel sizes. Consistent base resolution + nearest-neighbour scaling.

## Approach (phased)

1. **Placeholder-first.** Coloured rects / programmatic tiles so mechanics get built fast (decided —
   see DECISIONS.md). Art is *not* on the critical path for the MVP slice.
2. **Free CC0 tilesets** to make it look game-like quickly without drawing everything (see shortlist).
3. **Gemini-generated bespoke assets** for characterful, on-theme items/enemies where stock art
   doesn't fit the dark-comic identity.

## Free tileset shortlist (to evaluate)

Prefer **CC0 / Creative Commons Zero** (free commercial use, no attribution needed). On itch.io,
filter by CC0 + tags `tileset`, `top-down`, `zombies`, `pixel-art`. Candidates to review:

- **Kenney** ([kenney.nl](https://kenney.nl)) — huge library of CC0 pixel/top-down packs, animated
  characters, tilesets, UI, weapons. Reliable, consistent, genuinely free. First stop.
- itch.io CC0 top-down / post-apocalyptic **16×16 tilesets** with scenery + animated characters.
- itch.io **Zombie Apocalypse** packs (tilesets + animated zombies + weapons/UI/FX).
- **RGS_Dev** CC0 top-down tileset template (16×16, colour variants) — good for prototyping.

> Action: when we move past placeholders, pick ONE base tileset for world tiles to keep a coherent
> look, then layer bespoke Gemini items/enemies on top. Record the chosen pack + its licence here.
> Keep a `LICENSES.md` / per-pack licence note alongside any downloaded assets.

Sources for the shortlist:
[itch.io CC0 assets](https://itch.io/game-assets/assets-cc0) ·
[itch.io CC0 tilesets](https://itch.io/game-assets/assets-cc0/tag-tileset) ·
[itch.io free zombie assets](https://itch.io/game-assets/free/tag-zombies) ·
[itch.io pixel-art + zombies](https://itch.io/game-assets/tag-pixel-art/tag-zombies) ·
[Kenney](https://kenney.nl)

## Gemini asset generation (via guppi)

Matt's home server (**guppi** repo / Beelink) has a working Gemini image-gen setup we can mirror.
The API key is `GEMINI_API_KEY`, stored in `guppi/house-helper/.env` (**gitignored — never commit
it**, and it's on the home LAN, not reachable from a cloud dev sandbox).

Reference implementation to copy from: **`guppi/house-helper/catalog_icons.py`**. Key facts:

- **Model:** `gemini-2.5-flash-image` (aka *"Nano Banana"*) — image generation.
- **Endpoint:** `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`
- **Auth:** header `x-goog-api-key: <GEMINI_API_KEY>`.
- Returns a ~1024px PNG (inline base64) on a solid background; guppi post-processes (square-crop →
  alpha key-out → resize). For pixel-art game assets we'd instead **downscale hard to the target
  pixel grid** (e.g. 16×16 / 32×32) with nearest-neighbour, and likely quantise the palette.

Practical workflow (proposed, to firm up when we start generating):

1. Write a tight prompt per asset — enforce the dark-grotty-but-funny style, transparent/flat
   background, top-down or item-icon framing, low detail suited to pixel downscaling.
2. Generate at high res via the endpoint above.
3. Downscale to the pixel grid + palette-quantise → sprite/atlas.
4. Commit the *processed* sprite (not the raw 1024px) into the repo's assets dir; note its origin.

> Because generation needs the LAN key, expect to run the generation step from a machine that can
> reach guppi (or with the key exported locally), then commit the resulting sprites so cloud/other
> devices just consume them.

## Where assets live (proposed)

- `public/assets/` (or `src/assets/`) — sprites/tilesets/atlases the game loads (path finalised with
  the Vite scaffold).
- `docs/assets/reference/` — reference material (e.g. the Google Maps screenshot of Mostowa).
- Licence notes travel with any third-party pack.
