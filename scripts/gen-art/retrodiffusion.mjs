// Generate a test pixel-art image via the Retro Diffusion API (retrodiffusion.ai) — one of the
// two free AI pixel-art services we're trialling for bespoke/environment assets alongside CC0
// tilesets (see docs/ASSETS.md). API verified against https://github.com/Retro-Diffusion/api-examples
// and https://astropulse.gitbook.io/retro-diffusion (2026-07-11).
//
// Usage:
//   RETRODIFFUSION_API_KEY=rdpk-... node scripts/gen-art/retrodiffusion.mjs \
//     --prompt "mossy stone brick wall" --style rd_tile__single_tile --width 16 --height 16 \
//     --out docs/assets/ai-tests/retro-diffusion/wall.png
//
// Useful flags:
//   --prompt          required. Describe the SUBJECT only — never include "pixel art" (the style
//                     already implies it; per RD's own guidance including it hurts results).
//   --style           prompt_style ID (default: rd_tile__single_tile — a single tileable object/tile).
//                     Other tile styles: rd_tile__tileset, rd_tile__tileset_advanced,
//                     rd_tile__tile_variation, rd_tile__tile_object, rd_tile__scene_object.
//                     Non-tile styles (characters/items): rd_plus__topdown_asset, rd_plus__environment,
//                     rd_plus__item_sheet, rd_fast__game_asset. Full list in docs/gen-art README.
//   --width/--height  default 16x16 (this repo's TILE_SIZE). 16-512 range.
//   --seed            optional int, for reproducible re-runs.
//   --tile-x/--tile-y pass --tile-x to request seamless horizontal tiling (repeatable env tiles).
//   --check-cost      dry run — prints the credit cost without generating or spending anything.
//   --out             output PNG path (default: scripts/.gen-art/retrodiffusion-<timestamp>.png)
import { parseArgs, requireEnv, writeBase64Png } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));

if (!args.prompt) {
  console.error(
    'Usage: node scripts/gen-art/retrodiffusion.mjs --prompt "..." [--style rd_tile__single_tile] [--width 16] [--height 16] [--out path.png]',
  );
  process.exit(1);
}

const apiKey = requireEnv('RETRODIFFUSION_API_KEY');

const payload = {
  prompt: args.prompt,
  prompt_style: args.style ?? 'rd_tile__single_tile',
  width: Number(args.width ?? 16),
  height: Number(args.height ?? 16),
  num_images: 1,
  ...(args.seed ? { seed: Number(args.seed) } : {}),
  ...(args['tile-x'] ? { tile_x: true } : {}),
  ...(args['tile-y'] ? { tile_y: true } : {}),
  ...(args['check-cost'] ? { check_cost: true } : {}),
};

const res = await fetch('https://api.retrodiffusion.ai/v1/inferences', {
  method: 'POST',
  headers: { 'X-RD-Token': apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

const data = await res.json();

if (!res.ok) {
  console.error('Retro Diffusion error', res.status, JSON.stringify(data));
  process.exit(1);
}

if (args['check-cost']) {
  console.log('Estimated cost:', data.balance_cost ?? data);
  process.exit(0);
}

const [image] = data.base64_images ?? [];
if (!image) {
  console.error('No image in response:', JSON.stringify(data));
  process.exit(1);
}

const out = args.out ?? `scripts/.gen-art/retrodiffusion-${Date.now()}.png`;
writeBase64Png(image, out);
console.log(`cost: $${data.balance_cost}  remaining balance: $${data.remaining_balance}`);
