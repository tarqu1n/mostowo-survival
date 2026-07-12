import { describe, it, expect } from 'vitest';
import { worldToTile, tileToWorldCenter, snapToTileCenter, tileKey } from '../grid';
import { TILE_SIZE } from '../../config';

describe('worldToTile', () => {
  it('floors pixel coordinates to a tile index', () => {
    expect(worldToTile(0)).toBe(0);
    expect(worldToTile(TILE_SIZE - 1)).toBe(0);
    expect(worldToTile(TILE_SIZE)).toBe(1);
    expect(worldToTile(TILE_SIZE * 3 + 5)).toBe(3);
  });
});

describe('tileToWorldCenter', () => {
  it('returns the pixel centre of a tile', () => {
    expect(tileToWorldCenter(0)).toBe(TILE_SIZE / 2);
    expect(tileToWorldCenter(2)).toBe(2 * TILE_SIZE + TILE_SIZE / 2);
  });
});

describe('snapToTileCenter', () => {
  it('round-trips through worldToTile/tileToWorldCenter', () => {
    const px = TILE_SIZE * 4 + 3;
    expect(snapToTileCenter(px)).toBe(tileToWorldCenter(worldToTile(px)));
  });

  it('snaps any pixel within a tile to that tile center', () => {
    for (let offset = 0; offset < TILE_SIZE; offset++) {
      expect(snapToTileCenter(TILE_SIZE * 5 + offset)).toBe(5 * TILE_SIZE + TILE_SIZE / 2);
    }
  });
});

describe('tileKey', () => {
  it('stringifies col,row as "col,row"', () => {
    expect(tileKey(3, 7)).toBe('3,7');
    expect(tileKey(0, 0)).toBe('0,0');
  });

  it('round-trips distinct tiles to distinct keys', () => {
    expect(tileKey(1, 2)).not.toBe(tileKey(2, 1));
  });
});
