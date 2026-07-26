/**
 * Plan 052 — one-shot Node bridge so `gen_biome_tests.py` can call the REAL shipped
 * `generateScatter` (src/systems/biomeGen/scatter.ts) instead of a second, approximate
 * reimplementation. Invoked via `vite-node` (the only TS-execution binary this repo has installed —
 * see docs/BIOMES.md's scatter-preview section for why: no tsx/ts-node, and this must never be picked
 * up by `npm test`'s vitest globs, so it isn't a `*.test.ts` file and isn't run through vitest at all).
 *
 * Contract: argv[2] is a JSON file matching `ScatterGenInput` verbatim (region/layers/field/seed/
 * cellEdgeSet — see scatter.ts), argv[3] is where to write the resulting `ScatterGenResult` JSON.
 * Pure passthrough — no flag parsing, no defaults — the Python side owns every input value.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { generateScatter } from '../../src/systems/biomeGen/scatter';
import type { ScatterGenInput } from '../../src/systems/biomeGen/scatter';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: vite-node scatter_bridge.ts <input.json> <output.json>');
  process.exit(1);
}

const input = JSON.parse(readFileSync(inPath, 'utf8')) as ScatterGenInput;
const result = generateScatter(input);
writeFileSync(outPath, JSON.stringify(result));
