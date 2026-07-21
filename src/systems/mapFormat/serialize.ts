/**
 * Serialization for the map schema — diff-friendly JSON output (`serializeMap`) plus the blank-map
 * constructor (`createEmptyMap`). Pure — no Phaser.
 */

import { TILE_SIZE } from '../../config';
import type { MapFile } from './schema';
import { fail } from './parse';

const CELLS_BLOCK = /"cells": \[\n([\s\S]*?)\n(\s*)\]/g;

/** Collapse every `"cells": [...]` array (one number per line, `JSON.stringify`'s default) into
 *  `width`-wide rows on their own compact line — every cells array in this schema is a
 *  `width*height` row-major grid, so one width applies uniformly. Diff-friendly: an edit to one
 *  row only touches that row's line. */
function collapseCellsArrays(json: string, width: number): string {
  return json.replace(CELLS_BLOCK, (_match, body: string, closeIndent: string) => {
    const numbers = body
      .split('\n')
      .map((line) => line.trim().replace(/,$/, ''))
      .filter((line) => line.length > 0);
    const rowIndent = `${closeIndent}  `;
    const rows: string[] = [];
    for (let i = 0; i < numbers.length; i += width) {
      rows.push(rowIndent + numbers.slice(i, i + width).join(','));
    }
    return `"cells": [\n${rows.join(',\n')}\n${closeIndent}]`;
  });
}

/**
 * Serialize a `MapFile` to diff-friendly JSON: stable key order (guaranteed by construction —
 * every `MapFile` in this codebase is built field-by-field in schema order, never spread from
 * arbitrary input, so plain `JSON.stringify` key insertion order already matches the schema),
 * 2-space indent, and cells grids collapsed to one compact line per row (see
 * `collapseCellsArrays`).
 */
export function serializeMap(map: MapFile): string {
  const json = JSON.stringify(map, null, 2);
  return `${collapseCellsArrays(json, map.meta.width)}\n`;
}

/** A blank rectangular (all-inside — no `shape`) map: one empty `ground` tile layer, no terrain,
 *  fully walkable, no zones/objects. `tileSize` defaults to the game's `TILE_SIZE`. */
export function createEmptyMap(id: string, name: string, width: number, height: number): MapFile {
  if (!Number.isInteger(width) || width <= 0) {
    fail('createEmptyMap: width must be a positive integer');
  }
  if (!Number.isInteger(height) || height <= 0) {
    fail('createEmptyMap: height must be a positive integer');
  }
  const size = width * height;
  return {
    meta: { schemaVersion: 1, id, name, width, height, tileSize: TILE_SIZE },
    palette: [null],
    layers: [
      {
        id: 'ground',
        name: 'Ground',
        kind: 'tiles',
        overhead: false,
        cells: new Array(size).fill(0) as number[],
      },
    ],
    terrain: [],
    walkability: { cells: new Array(size).fill(0) as number[] },
    zones: { defs: [], cells: new Array(size).fill(0) as number[] },
    objects: [],
  };
}
