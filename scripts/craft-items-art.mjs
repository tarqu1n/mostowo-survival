/**
 * Placeholder icons for the plan-048 rope resource + the three craftable-item stubs (brand/bow/
 * sword). These items are added as data in plan 048 Step 1 as INERT bag items — no equip/durability/
 * combat/light behaviour yet (that lands in plan 049) — but `PreloadScene` still needs a resident
 * `icons/<file>` for every `ITEMS` entry or the boot smoke test 404s. Same self-contained RGBA/8-bit
 * PNG encoder as `scripts/placeholder-art.mjs`/`scripts/tent-art.mjs` (Node `zlib` only, no image deps).
 *
 * Emits (32×32 item icons under public/assets/icons/):
 *   - rope.png    — coiled rope (new salvage resource, matches items.ts `rope` colour 0xb5966a)
 *   - brand.png   — a wrapped hand-torch (the `brand` recipe output, name "Brand")
 *   - bow.png     — a strung wooden bow
 *   - sword.png   — a plain short blade
 *
 * Deterministic (no RNG), safe to re-run: `node scripts/craft-items-art.mjs`.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ---- Minimal RGBA raster (same primitives as scripts/tent-art.mjs) ----
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

const ICONS = 'public/assets/icons';

// ---- rope.png: a coiled loop of rope (matches items.ts rope colour 0xb5966a) ----
{
  const r = new Raster(32, 32);
  const ROPE = [0xb5, 0x96, 0x6a, 255];
  const ROPE_SH = [0x83, 0x6a, 0x49, 255];
  const ROPE_HI = [0xd6, 0xbb, 0x8f, 255];
  // Three concentric coil rings (thick lines), each darker toward the core.
  for (let i = 0; i < 3; i++) {
    const rad = 12 - i * 3.2;
    for (let a = 0; a < 360; a += 6) {
      const rad0 = (a * Math.PI) / 180;
      const x = 16 + rad * Math.cos(rad0);
      const y = 17 + rad * 0.72 * Math.sin(rad0);
      r.disc(x, y, 2.1, i === 2 ? ROPE_SH : ROPE);
    }
  }
  // Highlight sheen along the top-left of the outer ring.
  for (let a = 200; a < 340; a += 8) {
    const rad0 = (a * Math.PI) / 180;
    r.disc(16 + 12 * Math.cos(rad0), 17 + 12 * 0.72 * Math.sin(rad0), 1.2, ROPE_HI);
  }
  // A loose trailing end.
  r.line(24, 22, 28, 27, ROPE, 1.6);
  r.line(28, 27, 26, 30, ROPE_SH, 1.2);
  write(`${ICONS}/rope.png`, r);
}

// ---- brand.png: a wrapped hand-torch (recipe output "Brand" — wood + cloth) ----
{
  const r = new Raster(32, 32);
  const WOOD = [0x8a, 0x5a, 0x2b, 255];
  const WOOD_HI = [0xab, 0x76, 0x40, 255];
  const WRAP = [0xc9, 0xba, 0x9a, 255]; // cloth wrap (unlit — no equip/light behaviour this step)
  const WRAP_SH = [0x9a, 0x8a, 0x6c, 255];
  const EMBER = [0xd9, 0x82, 0x2b, 255];
  const EMBER_HI = [0xf0, 0xb0, 0x5a, 255];
  // Handle shaft.
  r.line(12, 28, 18, 14, WOOD, 2.2);
  r.line(13, 28, 19, 14, WOOD_HI, 0.8);
  // Cloth wrap band near the grip.
  for (let y = 20; y <= 26; y += 2) r.line(11, y, 16, y - 5, WRAP);
  r.line(11, 25, 15, 20, WRAP_SH);
  // Charred tip / unlit ember head (placeholder — no light source behaviour yet).
  r.disc(19, 12, 4, EMBER);
  r.disc(18, 10, 1.6, EMBER_HI);
  write(`${ICONS}/brand.png`, r);
}

// ---- bow.png: a strung wooden bow ----
{
  const r = new Raster(32, 32);
  const WOOD = [0x8a, 0x5a, 0x2b, 255];
  const WOOD_HI = [0xab, 0x76, 0x40, 255];
  const STRING = [0xe4, 0xd8, 0xbd, 255];
  // Bow stave: a curved limb approximated by short line segments.
  const stave = [
    [16, 4],
    [12, 8],
    [10, 16],
    [12, 24],
    [16, 28],
  ];
  for (let i = 0; i < stave.length - 1; i++) {
    const [ax, ay] = stave[i];
    const [bx, by] = stave[i + 1];
    r.line(ax, ay, bx, by, WOOD, 1.6);
  }
  r.line(15, 5, 11, 15, WOOD_HI, 0.6);
  // Taut string from tip to tip.
  r.line(16, 5, 16, 27, STRING);
  write(`${ICONS}/bow.png`, r);
}

// ---- sword.png: a plain short blade ----
{
  const r = new Raster(32, 32);
  const BLADE = [0xaa, 0xb0, 0xb8, 255];
  const BLADE_HI = [0xd6, 0xda, 0xdf, 255];
  const BLADE_SH = [0x76, 0x7c, 0x84, 255];
  const GUARD = [0x8a, 0x5a, 0x2b, 255];
  const GRIP = [0x4a, 0x33, 0x1f, 255];
  // Blade: a tapered triangle from the guard up to the tip.
  r.tri(13, 22, 19, 22, 16, 4, BLADE);
  r.line(16, 4, 14, 22, BLADE_HI);
  r.line(16, 4, 18, 22, BLADE_SH);
  // Crossguard.
  r.rect(10, 21, 12, 2, GUARD);
  // Grip + pommel.
  r.rect(14, 23, 4, 6, GRIP);
  r.disc(16, 30, 2, GUARD);
  write(`${ICONS}/sword.png`, r);
}
