import { describe, it, expect } from 'vitest';
import { parseEdgeSet } from '../edgeSets';
// Static JSON import (`resolveJsonModule`) — mirrors `biomeDefs.test.ts`'s committed-file integration
// test rather than `node:fs` (no `@types/node` dependency in this repo).
import grassDoc from '../../../public/assets/tilesets/pixel-crawler/edge-sets/grass.json';
import mudDoc from '../../../public/assets/tilesets/pixel-crawler/edge-sets/mud.json';
import waterDoc from '../../../public/assets/tilesets/pixel-crawler/edge-sets/water.json';

describe('parseEdgeSet', () => {
  it('parses the committed grass.json (blob) end-to-end', () => {
    const set = parseEdgeSet(grassDoc, 'grass');
    if (set.method !== 'blob') throw new Error('expected blob method');
    expect(set.id).toBe('grass');
    expect(set.surfaces[0].variants.length).toBeGreaterThan(0);
    expect(Object.keys(set.mapping).length).toBeGreaterThan(0);
  });

  it('parses the committed mud.json (blob) end-to-end', () => {
    const set = parseEdgeSet(mudDoc, 'mud');
    if (set.method !== 'blob') throw new Error('expected blob method');
    expect(set.id).toBe('mud');
  });

  it('parses the committed water.json (depth) end-to-end, with fillAsset on authored levels', () => {
    const set = parseEdgeSet(waterDoc, 'water');
    if (set.method !== 'depth') throw new Error('expected depth method');
    expect(set.levels.map((l) => l.name)).toEqual(['shallow', 'mid', 'deep']);
    expect(set.levels[0].fillAuthored).toBe(true);
    expect(set.levels[0].fillAsset).toBe('water-shallow-fill.png');
    expect(set.levels[2].authored).toBe(true);
    expect(set.levels[2].fillAsset).toBe('water-deep-fill.png');
    expect(set.levels[1].fillAsset).toBeUndefined();
    expect(set.transitions).toHaveLength(2);
    expect(set.generate.bands).toEqual([2.5, 8.5]);
  });

  it('rejects an unknown method', () => {
    expect(() => parseEdgeSet({ method: 'wat' }, 'bad')).toThrow(
      /method must be 'blob' or 'depth'/,
    );
  });

  it('rejects a depth level missing fillAsset when authored', () => {
    const bad = {
      ...waterDoc,
      levels: [
        waterDoc.levels[0],
        waterDoc.levels[1],
        { ...waterDoc.levels[2], fillAsset: undefined },
      ],
    };
    expect(() => parseEdgeSet(bad, 'bad')).toThrow(/fillAsset must be a string/);
  });

  it('rejects a blob edge set with a malformed mapping option', () => {
    const bad = { ...grassDoc, mapping: { 16: [[28]] } };
    expect(() => parseEdgeSet(bad, 'bad')).toThrow(/must be a \[frame, rot\] pair/);
  });
});
