import { describe, it, expect } from 'vitest';
import { rollLoot, type LootTable } from '../loot';

/** A deterministic rng that replays a fixed sequence of values in [0,1), cycling — lets each test
 *  drive `pickDrop`'s weight walk and the qty draw to exact, asserted outcomes (same injected-rng
 *  seam as combat.test.ts). */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

const TABLE: LootTable = {
  rolls: 2,
  drops: [
    { itemId: 'cloth', min: 1, max: 3, weight: 3 },
    { itemId: 'wood', min: 1, max: 2, weight: 2 },
    { itemId: 'cannedFood', min: 1, max: 1, weight: 1 },
  ],
};

describe('rollLoot', () => {
  it('does `rolls` weighted draws, each a qty within its drop range', () => {
    // total weight 6. roll0 pick: 0.0*6=0 → cloth; qty: 0.99 → min+floor(0.99*3)=1+2=3.
    // roll1 pick: 0.6*6=3.6 → past cloth(3), into wood; qty: 0.0 → 1.
    const rng = seqRng([0.0, 0.99, 0.6, 0.0]);
    const out = rollLoot(TABLE, rng);
    expect(out).toEqual([
      { itemId: 'cloth', qty: 3 },
      { itemId: 'wood', qty: 1 },
    ]);
  });

  it('merges repeated draws of the same item into one stack', () => {
    // Both rolls land on cloth (pick 0.0), qty 1 each → one merged stack of 2.
    const rng = seqRng([0.0, 0.0, 0.0, 0.0]);
    const out = rollLoot(TABLE, rng);
    expect(out).toEqual([{ itemId: 'cloth', qty: 2 }]);
  });

  it('respects weight boundaries when selecting a drop', () => {
    // A single roll near the top of the weight range lands on the last (lowest-weight) drop.
    const single: LootTable = { rolls: 1, drops: TABLE.drops };
    // pick 0.95*6=5.7 → past cloth(3)+wood(2)=5, into cannedFood; qty 0 → 1.
    expect(rollLoot(single, seqRng([0.95, 0.0]))).toEqual([{ itemId: 'cannedFood', qty: 1 }]);
  });

  it('honours min == max (a fixed-quantity drop)', () => {
    const fixed: LootTable = { rolls: 3, drops: [{ itemId: 'cloth', min: 2, max: 2, weight: 1 }] };
    // Every draw is cloth ×2 → merged to 6 across 3 rolls, regardless of the qty rng value.
    expect(rollLoot(fixed, seqRng([0.5]))).toEqual([{ itemId: 'cloth', qty: 6 }]);
  });

  it('never grants below min or above max across many random draws', () => {
    const rng = seqRng([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.05]);
    for (let i = 0; i < 50; i++) {
      for (const { itemId, qty } of rollLoot(TABLE, rng)) {
        const drop = TABLE.drops.find((d) => d.itemId === itemId)!;
        // qty is a merged sum over 1..rolls draws, so bounded by rolls*range, but never < min.
        expect(qty).toBeGreaterThanOrEqual(drop.min);
        expect(qty).toBeLessThanOrEqual(drop.max * TABLE.rolls);
      }
    }
  });
});
