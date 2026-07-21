/**
 * Map file schema v1 (plan 014 step 1) — public barrel. The module was split into cohesive files
 * (`schema` types + cell helpers + y-sort law, `parse` validation, `serialize` output, `resize`
 * remap + migrate + texture enumeration) but the `systems/mapFormat` import path and its full
 * export surface are preserved here so no consumer changed. Pure — no Phaser.
 *
 * `parse` also exports `fail`/`expectRecord`/`objectFootprintCells` for `serialize`/`resize` to
 * reuse; those are deliberately NOT re-exported below — the public surface stays exactly what the
 * old flat `mapFormat.ts` exported.
 */

export * from './schema';
export * from './serialize';
export * from './resize';
export { parseMap } from './parse';
