// Generate a test pixel-art image via the PixelLab API (pixellab.ai) — the other of the two free
// AI pixel-art services we're trialling alongside CC0 tilesets (see docs/ASSETS.md).
//
// Schema verified against https://api.pixellab.ai/v1/openapi.json on 2026-07-11. PixelLab's docs
// UI (https://api.pixellab.ai/v1/docs) is the source of truth if this drifts — the API is young
// and the free tier's exact limits (200x200 max canvas on free, per pixellab.ai/docs pricing notes)
// aren't guaranteed stable; re-check there if this script starts erroring.
//
// Usage:
//   PIXELLAB_API_KEY=... node scripts/gen-art/pixellab.mjs \
//     --description "mossy stone brick wall, top down" --width 32 --height 32 \
//     --out docs/assets/ai-tests/pixellab/wall.png
//
// Useful flags:
//   --description         required. What to generate.
//   --negative             optional negative_description.
//   --model                pixflux (default, general-purpose text-to-pixel-art) or bitforge
//                          (supports --style-image below, for matching an existing pack's look).
//   --width/--height       default 16x16 (this repo's TILE_SIZE) — but the API's free-tier minimum
//                          canvas is verified at 32x32 (pixflux 422s below that); downscale to 16x16
//                          in post if you need the exact tile size. Free tier caps at 200x200 total.
//   --view                 CameraView enum, verified against the live OpenAPI schema: "side",
//                          "low top-down", "high top-down".
//   --shading               Shading enum: "flat shading", "basic shading", "medium shading",
//                          "detailed shading", "highly detailed shading".
//   --detail               Detail enum: "low detail", "medium detail", "highly detailed".
//   --outline               Outline enum: "single color black outline", "single color outline",
//                          "selective outline", "lineless".
//   --no-background        transparent background.
//   --style-image           bitforge only. Path to a local reference PNG for style transfer — sets
//                          model to bitforge automatically. Pairs with --style-strength.
//   --style-strength       bitforge only, 0-100, default 50 when --style-image is set (the API
//                          itself defaults to 0 = no style transfer, so this must be set explicitly).
//   --seed                 optional int, for reproducible re-runs.
//   --out                  output PNG path (default: scripts/.gen-art/pixellab-<timestamp>.png)
import { parseArgs, requireEnv, writeBase64Png, readPngAsBase64 } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));

if (!args.description) {
  console.error(
    'Usage: node scripts/gen-art/pixellab.mjs --description "..." [--width 16] [--height 16] [--model pixflux|bitforge] [--out path.png]',
  );
  process.exit(1);
}

const apiKey = requireEnv('PIXELLAB_API_KEY');

const model = args.model === 'bitforge' || args['style-image'] ? 'bitforge' : 'pixflux';
const endpoint = `https://api.pixellab.ai/v1/generate-image-${model}`;

if (args['style-image'] && model !== 'bitforge') {
  console.error(
    '--style-image requires bitforge (pass --model bitforge, or omit --model — it is inferred).',
  );
  process.exit(1);
}

const payload = {
  description: args.description,
  image_size: { width: Number(args.width ?? 16), height: Number(args.height ?? 16) },
  ...(args.negative ? { negative_description: args.negative } : {}),
  ...(args.view ? { view: args.view } : {}),
  ...(args.shading ? { shading: args.shading } : {}),
  ...(args.detail ? { detail: args.detail } : {}),
  ...(args.outline ? { outline: args.outline } : {}),
  ...(args['no-background'] ? { no_background: true } : {}),
  ...(args.seed ? { seed: Number(args.seed) } : {}),
  ...(args['style-image']
    ? {
        style_image: { type: 'base64', base64: readPngAsBase64(args['style-image']) },
        style_strength: Number(args['style-strength'] ?? 50),
      }
    : {}),
};

const res = await fetch(endpoint, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

const data = await res.json();

if (!res.ok) {
  console.error('PixelLab error', res.status, JSON.stringify(data));
  process.exit(1);
}

// Base64Image response shape isn't pinned down beyond "an object with the image data" from the
// OpenAPI summary — handle both a {base64: "..."} wrapper and a bare base64 string.
const base64 = data.image?.base64 ?? (typeof data.image === 'string' ? data.image : null);
if (!base64) {
  console.error('Unexpected response shape — dumping full response for debugging:');
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}

const out = args.out ?? `scripts/.gen-art/pixellab-${Date.now()}.png`;
writeBase64Png(base64, out);
if (data.usage) console.log('usage:', JSON.stringify(data.usage));
