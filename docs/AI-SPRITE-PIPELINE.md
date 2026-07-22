# AI sprite pipeline — generating animated, pack-matching sprites

A reusable two-stage workflow for **adding a missing animation to an existing pack
character** (first use: the Rogue's attack strip, plan 042 shipped no attack art). It
worked well enough to generalise, so this is the playbook.

**The two stages** (one script each, both in `scripts/pixel-crawler/`):

1. **Generate** — `gen_rogue_gemini.py`: Gemini (`gemini-2.5-flash-image`, "Nano
   Banana") **image-to-image**, fed the character's OWN sprite as a reference, prompted
   for a single-row strip of attack frames on a magenta background.
2. **Process** — `process_gemini.py`: downscale + **outline-first cel-shade** the raw
   generation into a sheet that sits beside the pack's existing sprites.

Endpoint/auth/key are the same as the item-icon pipeline — see
[gemini-pipeline.md](gemini-pipeline.md). Raw ~1024px generations are gitignored scratch
(`scripts/.gen-icons/raw/`); **only the processed sheet is committed** (e.g.
`public/assets/tilesets/pixel-crawler/_derived/rogue/Slice_Side-Sheet.png`).

## When this works / when it doesn't

- **Good fit:** you have an existing sprite to anchor identity, and want extra
  poses/animation in the same look. The reference image is what keeps it on-model.
- **Poor fit:** brand-new characters with no reference (identity drifts frame-to-frame);
  anything needing frame-perfect in-betweening (the frames are independent poses, not a
  rigged tween). For those, prefer pose-conditioned diffusion (see Prior art).
- **Approaches we tried first and rejected** (all worse than Gemine image-to-image):
  recolour + hood-graft onto the player's Body_A attack motion; a literal chop-up of the
  rogue into body parts posed on Body_A keypoints (janky — flat cutouts don't
  articulate); a self-inferred whole-body lean/lunge transform (clean but stiff). Gemini
  won on character fidelity because the reference image pins identity.

## Stage 1 — generate

The one lever that matters most: **pass the real sprite as an inline image** and tell the
model to redraw *that* character. Text-only prompts invent a new character; image-to-image
keeps it on-model (this is the same idea as ReferenceNet in the Sprite Sheet Diffusion
paper — see Prior art).

Prompt patterns that worked (`VARIANTS` in the gen script):

- **"Redraw THIS EXACT character … "** referencing the attached sprite.
- **Single horizontal row, N equal frames, one shared feet baseline, equal gaps** — the
  `row5a` variant produced a clean ordered strip; grid/2-row layouts came out irregular.
- **Flat / chunky / low-detail** wording — the closer the gen is to flat pixel art, the
  less the downscale has to fight.
- **Solid magenta `#FF00FF` background** — Gemini image models cannot output alpha, so
  generate on a flat chroma key and key it out later (a known, widely-reported limitation).
- **Restate background + style in every prompt** — the model doesn't reliably carry them.
- **Generate several variants, keep the cleanest.** Cheap; the model is stochastic.

Per-asset knobs: `CHAR` (appearance description), the `FRAMES*` pose list, and the
reference crop in `reference_png()`. `--dry-run` composes prompts with no key/spend.

## Stage 2 — process (the order matters)

`process_gemini.py`, pipeline order and the reason for each step:

1. **Key out magenta** (`KEY_TOL` high, ~130) — high enough to also remove the
   anti-aliased pink *ring* around the figure, not just pure magenta.
2. **Split the row into per-figure columns** — content-aware (gaps between opaque
   columns), NOT a uniform grid; the model never spaces frames perfectly evenly.
3. **Defringe** (`defringe`) — bleed edge RGB outward into the transparent border so the
   downscale blends the character's colour at the silhouette, not leftover magenta.
4. **One shared downscale** to pack height (`BODY_H`) + hard alpha threshold — one scale
   factor for all frames so relative sizes stay true.
5. **Reorder** frames (`REORDER`) to the intended animation sequence.
6. **Baseline-align** each frame (feet on a common line).
7. **Outline-first cel-shade** (`posterize_cel`) — the step that made it match the pack:
   - draw the **silhouette edge + dark internal seams black** first (locks clean shapes);
   - **flat-fill interiors by MATERIAL**, classified from hue/saturation (olive cloak /
     near-neutral blade greys / low-hue belt orange) so materials never compete, with the
     **shade chosen by brightness** off a small ramp;
   - **re-inject accents last**: detect the gen's own blue-eye / purple-mouth pixels and
     repaint them in the pack's exact tones; reduce each eye blob to **1px** at its
     centroid (`_one_px_per_blob`).

**The failure ladder** (why outline-first, recorded so nobody re-walks it):

- *Nearest-colour snap of every pixel to the pack palette* → bright highlights fall onto
  saturated accents (blue/orange) or the metal greys → **speckle/freckle**.
- *Saturation boost before snapping* → **blows the body out to white**.
- *Outline-first + material fill* → **clean flat cel art.** Separating silhouette from
  fill, and fill-material from fill-shade, is what removes the gen's texture without the
  freckling.

Other tuning lessons: skew the olive ramp/thresholds **bright** so the cloak reads as the
pack's *highlight* green, not its shadow green; accents (eyes/mouth) must be painted on
top, after the outline/void steps.

Per-asset knobs: the palette ramps (`OUTLINE`/`OLIVE`/`METAL`/`ORANGE`/`EYE`/`MOUTH`),
`OLIVE_THRESH`, the material hue/sat cutoffs in `posterize_cel`, and `BODY_H` /
`FRAME_W,H` / `BASELINE`.

## Adapting to a new asset — checklist

1. **Sample the target sprite's palette** (dominant body ramp + accent colours) — those
   become the `posterize_cel` ramps.
2. In the gen script: set `CHAR`, the pose `FRAMES` list, and `reference_png()`'s crop;
   `--dry-run` to check prompts; generate a few variants; pick the cleanest strip.
3. In the process script: set the palette ramps, the material classifiers (hue/sat rules
   for each material the sprite has), and the size/baseline constants.
4. Iterate on a zoomed strip preview: tune brightness thresholds (shadow vs highlight),
   material hue cutoffs, and accent detection until it sits next to the source sprite.
5. Commit the **processed sheet only**; leave raws in the gitignored scratch dir.

## Prior art & references (how this is done in the wild)

**Practical guides / tools** — corroborate our choices (image-to-image for identity, no
alpha so chroma-key, restate prompts, content-aware slicing) and suggest refinements:

- [Rosebud — Sprite sheets with Gemini + Nano Banana](https://lab.rosebud.ai/blog/how-to-create-a-sprite-sheet-with-ai-using-google-gemini-and-nano-banana-easy-guide)
- [Robotic Ape — Nano Banana sprite lessons learned](https://roboticape.com/2026/03/07/generating-game-sprites-with-gemini-image-generation-nano-banana-pro-lessons-learned/):
  green chroma-key + a **white outline buffer** for cleaner edge anti-aliasing, **HSV**
  (not RGB) colour detection, content-aware slicing, restate the background/outline rules
  every prompt. Two ideas worth trying here: a green-key + white-outline buffer instead of
  our magenta+defringe, and building the outline from the gen's own white buffer.
- [Scenario — AI sprite generator](https://www.scenario.com/blog/ai-sprite-generator) ·
  [PixelLab](https://www.pixellab.ai/) · commercial tools with "character memory".
- [SD_PixelArt_SpriteSheet_Generator (HF)](https://huggingface.co/Onodofthenorth/SD_PixelArt_SpriteSheet_Generator) —
  a Stable-Diffusion img2img checkpoint for 4-angle sprite sheets; consistency via a
  DreamBooth character model merged into the checkpoint.

**Academic** — the identity/consistency and the downscale problems, done "properly":

- [Sprite Sheet Diffusion](https://arxiv.org/html/2412.03685v1) (2024) — **ReferenceNet**
  (appearance) + **Pose Guider** (a pose sequence) + **Motion Module** (temporal
  coherence). This is the rigorous version of what our image-to-image reference does by
  hand; pose-conditioning is the path to true in-between frames rather than independent
  poses.
- [Deep Unsupervised Pixelization](https://github.com/PeterZs/Deep-Unsupervised-Pixelization)
  (SIGGRAPH Asia 2018) — a learned image→pixel-art downscaler (GridNet→PixelNet→DepixelNet
  with a mirror loss) that beats naive downscaling on crispness. A candidate replacement
  for our LANCZOS-downscale + cel-shade if the hand-tuned posterize hits its limits.
- [Pixel VQ-VAE](https://arxiv.org/pdf/2203.12130) — learned representations specifically
  for pixel art.

**Takeaway:** our pipeline is a lightweight, hand-tuned version of the same shape the
literature uses — reference image for identity, then a pixelization/quantisation pass. The
biggest available upgrades are (a) pose-conditioned generation for genuine tweening and
(b) a learned pixelizer in place of the manual cel-shade.
