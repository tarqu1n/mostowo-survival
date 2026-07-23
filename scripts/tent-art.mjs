/**
 * Placeholder art for the destroyed-tent "salvage" nodes + their two new salvage item icons
 * (plan: salvage action — scavenge a wrecked 6-person tent for a loot roll). Same self-contained
 * RGBA/8-bit PNG encoder as `scripts/placeholder-art.mjs` (Node `zlib` only, no image deps).
 *
 * These are hand-authored PLACEHOLDERS — the game has no tent art in any pack and the Gemini
 * image-to-image pipeline (docs/AI-SPRITE-PIPELINE.md) needs a key that isn't reachable from a
 * cloud session. Regenerate the real sprites through that pipeline later; until then these read as
 * collapsed tents at game scale. Deterministic (no RNG) so it's safe to re-run.
 *
 * Emits (all under the self-made `mostowo-custom` pack + the shared icon dir):
 *   - tilesets/mostowo-custom/Environment/Props/Static/tent_wreck_{1,2,3}.png        (live)
 *   - tilesets/mostowo-custom/Environment/Props/Static/tent_wreck_{1,2,3}_searched.png (depleted)
 *   - icons/cloth.png, icons/canned_food.png                                          (32×32 items)
 *
 * Re-run: `node scripts/tent-art.mjs`.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ---- Minimal RGBA raster ----
class Raster {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 4); // transparent by default
  }
  set(x, y, [r, g, b, a]) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.px[i] = r;
    this.px[i + 1] = g;
    this.px[i + 2] = b;
    this.px[i + 3] = a;
  }
  rect(x0, y0, w, h, colour) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, colour);
  }
  disc(cx, cy, rad, colour) {
    for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++)
      for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= rad * rad) this.set(x, y, colour);
      }
  }
  /** Bresenham line, optionally thick (a small filled disc per step). */
  line(x0, y0, x1, y1, colour, thick = 0) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (thick > 0) this.disc(x0, y0, thick, colour);
      else this.set(x0, y0, colour);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
  /** Filled triangle (barycentric fill). */
  tri(ax, ay, bx, by, cx, cy, colour) {
    const minX = Math.floor(Math.min(ax, bx, cx));
    const maxX = Math.ceil(Math.max(ax, bx, cx));
    const minY = Math.floor(Math.min(ay, by, cy));
    const maxY = Math.ceil(Math.max(ay, by, cy));
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area === 0) return;
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const w0 = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / area;
        const w1 = ((cx - bx) * (y - by) - (cy - by) * (x - bx)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) this.set(x, y, colour);
      }
  }
}

// ---- PNG encode (colour type 6, 8-bit; CRC32 + zlib IDAT) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(raster) {
  const { w, h, px } = raster;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    px.subarray(y * w * 4, (y + 1) * w * 4).forEach((v, i) => {
      raw[y * (w * 4 + 1) + 1 + i] = v;
    });
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function write(path, raster) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePNG(raster));
  console.log(`wrote ${path} (${raster.w}×${raster.h})`);
}

const TILESET = 'public/assets/tilesets/mostowo-custom/Environment/Props/Static';
const ICONS = 'public/assets/icons';

// A destroyed 6-person tent reads at ~3×2 tiles (48×32px). Canvas leaves headroom for a leaning
// pole + slack guy-lines; content is base-anchored (originY≈0.85) so it sits on the ground tile.
const W = 56;
const H = 44;
const GROUND = 38; // baseline the collapsed fabric rests on

// Shared tones.
const DARK = [0x14, 0x10, 0x0e, 255]; // near-black outline / cast shadow
const POLE = [0x6b, 0x53, 0x33, 255]; // snapped tent pole (wood)
const POLE_HI = [0x8a, 0x6c, 0x44, 255];
const GROUND_SHADOW = [0x0d, 0x0b, 0x0a, 90]; // soft footprint under the wreck
const GUY = [0x3a, 0x33, 0x2a, 255]; // slack guy-line

/** One tent wreck. `canvas`/`shade`/`hi` are the fabric ramp; `tilt` leans the whole ruin so the
 *  three variations don't read as the same silhouette flipped. */
function tentWreck({ canvas, shade, hi, tilt, torn }) {
  const r = new Raster(W, H);
  const cx = W / 2;

  // Ground footprint shadow (an ellipse-ish smear of low-alpha dark).
  for (let i = 0; i < 3; i++) r.disc(cx + tilt * 2, GROUND + 1, 22 - i * 5, GROUND_SHADOW);

  // Collapsed ridge: the peak has sagged toward one side (tilt) and dropped LOW — a caved-in tent,
  // not a standing pitch. Sits well under half the canvas height so it reads as slumped. Left/right
  // hems still pegged at the ground but the whole ruin is squat.
  const peakX = cx + tilt * 10;
  const peakY = 20 + Math.abs(tilt) * 2; // low, slumped ridge (canvas is 44 tall, ground at 38)
  const leftX = cx - 22;
  const rightX = cx + 20;

  // Cast shadow slab first (offset down-right), then the two fabric faces.
  r.tri(leftX + 2, GROUND, peakX + 2, peakY + 3, rightX + 2, GROUND, DARK);

  // Far (shaded) face and near (lit) face split at the ridge line for a bit of form.
  r.tri(leftX, GROUND, peakX, peakY, cx + tilt * 3, GROUND, shade); // back slope
  r.tri(cx + tilt * 3, GROUND, peakX, peakY, rightX, GROUND, canvas); // front slope

  // Sag: pull a deep scoop out of the ridge (overdraw transparent) to read as caved-in canvas — a
  // wide central collapse where the poles gave way, plus a smaller secondary dip off to one side.
  for (let x = peakX - 10; x <= peakX + 10; x++) {
    const dip = 7 - Math.abs(x - peakX) * 0.6;
    for (let y = peakY; y < peakY + Math.max(0, dip); y++) r.set(x, y, [0, 0, 0, 0]);
  }
  for (let x = leftX + 6; x <= leftX + 14; x++) {
    const slope = GROUND - (GROUND - peakY) * ((rightX - x) / (rightX - leftX));
    const dip = 4 - Math.abs(x - (leftX + 10)) * 0.7;
    for (let y = slope; y < slope + Math.max(0, dip); y++) r.set(x, y, [0, 0, 0, 0]);
  }

  // Fabric seams / highlight ribs down each slope.
  r.line(peakX, peakY + 2, leftX + 4, GROUND - 1, hi);
  r.line(peakX, peakY + 2, rightX - 3, GROUND - 1, hi);
  r.line(peakX - 3, peakY + 4, cx - 10, GROUND - 1, shade);

  // Dark triangular entrance flap on the front slope, hanging open.
  r.tri(cx + 4, GROUND, cx + 9, GROUND - 12, cx + 14, GROUND, DARK);

  // Torn hem: chew jagged bites out of the bottom edge so it looks ripped, not cut.
  for (const [bx, bw, bh] of torn) {
    r.tri(bx, GROUND, bx + bw / 2, GROUND - bh, bx + bw, GROUND, [0, 0, 0, 0]);
  }

  // Snapped pole poking out of the collapse (two segments at a break angle) + guy-lines.
  r.line(peakX, peakY + 1, peakX - 3 + tilt, peakY - 9, POLE, 0);
  r.line(peakX - 3 + tilt, peakY - 9, peakX + 4 + tilt, peakY - 6, POLE_HI, 0);
  r.line(leftX + 3, GROUND - 2, leftX - 4, GROUND + 1, GUY); // slack guy to a pulled peg
  r.line(rightX - 2, GROUND - 2, rightX + 5, GROUND, GUY);

  // Outline the base hem in dark so it separates from grass.
  r.line(leftX, GROUND, rightX, GROUND, DARK);

  return r;
}

/** The "searched" husk: same wreck flattened further, desaturated, entrance torn wider, no pole —
 *  the depleted look after the tent's been ransacked. */
function tentSearched({ canvas, shade, tilt }) {
  const r = new Raster(W, H);
  const cx = W / 2;
  const flat = (c) => [Math.round(c[0] * 0.6), Math.round(c[1] * 0.6), Math.round(c[2] * 0.6), 255];
  for (let i = 0; i < 3; i++) r.disc(cx + tilt, GROUND + 1, 20 - i * 5, GROUND_SHADOW);
  // A low mound of collapsed, trampled fabric — peak barely above the ground.
  const peakX = cx + tilt * 4;
  const peakY = GROUND - 9;
  r.tri(cx - 20, GROUND, peakX + 2, peakY + 2, cx + 20, GROUND, DARK);
  r.tri(cx - 19, GROUND, peakX, peakY, cx, GROUND, flat(shade));
  r.tri(cx, GROUND, peakX, peakY, cx + 18, GROUND, flat(canvas));
  // Gaping torn-open middle (the ransacked hole).
  r.tri(cx - 6, GROUND, cx, peakY + 1, cx + 7, GROUND, DARK);
  r.tri(cx - 4, GROUND, cx, peakY + 3, cx + 5, GROUND, [0, 0, 0, 0]);
  // A couple of scattered debris flecks + the base outline.
  r.disc(cx - 16, GROUND - 1, 1.5, flat(canvas));
  r.disc(cx + 15, GROUND - 2, 1.5, flat(shade));
  r.line(cx - 20, GROUND, cx + 20, GROUND, DARK);
  return r;
}

// Three visually distinct wrecks: green ridge tent, blue dome, scorched red/orange tent.
const VARIANTS = [
  {
    n: 1,
    canvas: [0x4f, 0x6b, 0x3a, 255],
    shade: [0x38, 0x4e, 0x29, 255],
    hi: [0x6f, 0x8c, 0x50, 255],
    tilt: -1,
    torn: [
      [12, 6, 4],
      [30, 5, 3],
    ],
  },
  {
    n: 2,
    canvas: [0x36, 0x5a, 0x7c, 255],
    shade: [0x26, 0x41, 0x5b, 255],
    hi: [0x59, 0x7f, 0xa3, 255],
    tilt: 1,
    torn: [
      [16, 7, 5],
      [34, 6, 4],
    ],
  },
  {
    n: 3,
    canvas: [0x8a, 0x43, 0x2f, 255],
    shade: [0x5f, 0x2c, 0x1f, 255],
    hi: [0xac, 0x5e, 0x3e, 255],
    tilt: 0,
    torn: [
      [10, 6, 5],
      [24, 8, 6],
      [38, 5, 4],
    ],
  },
];

for (const v of VARIANTS) {
  write(`${TILESET}/tent_wreck_${v.n}.png`, tentWreck(v));
  write(`${TILESET}/tent_wreck_${v.n}_searched.png`, tentSearched(v));
}

// ---- Item icons for the two new salvage items (32×32) ----
// cloth: a folded bolt of grubby canvas.
{
  const r = new Raster(32, 32);
  const CLOTH = [0xc9, 0xba, 0x9a, 255];
  const CLOTH_SH = [0x9a, 0x8a, 0x6c, 255];
  const CLOTH_HI = [0xe4, 0xd8, 0xbd, 255];
  r.rect(6, 9, 20, 15, CLOTH_SH); // stacked-fold shadow slab
  r.rect(5, 7, 20, 14, CLOTH); // main folded bolt
  r.rect(5, 7, 20, 3, CLOTH_HI); // lit top fold
  for (let y = 12; y < 21; y += 3) r.line(6, y, 23, y, CLOTH_SH); // fold seams
  r.line(5, 7, 24, 7, [0x6b, 0x5f, 0x48, 255]); // top edge
  r.line(5, 20, 24, 20, [0x6b, 0x5f, 0x48, 255]); // bottom edge
  write(`${ICONS}/cloth.png`, r);
}
// canned_food: a dented tin can with a label band.
{
  const r = new Raster(32, 32);
  const TIN = [0x9b, 0xa3, 0xa8, 255];
  const TIN_HI = [0xcf, 0xd6, 0xda, 255];
  const TIN_SH = [0x6a, 0x71, 0x76, 255];
  const LABEL = [0xb8, 0x5c, 0x33, 255];
  const LABEL_HI = [0xd8, 0x7a, 0x4c, 255];
  r.rect(9, 6, 14, 21, TIN); // can body
  r.rect(9, 6, 3, 21, TIN_HI); // left highlight
  r.rect(20, 6, 3, 21, TIN_SH); // right shade
  r.rect(9, 12, 14, 9, LABEL); // paper label band
  r.rect(9, 12, 14, 2, LABEL_HI);
  r.disc(16, 6, 7, TIN); // lid ellipse-ish top
  r.rect(9, 5, 14, 2, TIN_HI); // lid rim
  r.line(9, 5, 22, 5, TIN_SH);
  // A dent in the side.
  r.disc(21, 18, 2, TIN_SH);
  write(`${ICONS}/canned_food.png`, r);
}
