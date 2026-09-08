import { describe, it, expect } from 'vitest';
import { secondaryOpPerUnit, secondaryOpsCostPerUnit, secondaryOpsLineItems } from './secondaryOps';
import { calculateMilledCosts, MilledProfile } from './milledEstimator';
import { DEFAULT_SHOP_SETTINGS } from '../constants';
import type { SecondaryOperation } from '../types';

const gold: SecondaryOperation = { id: 'g', name: 'Gold plate', category: 'plating', lotCharge: 200, perPartCost: 2.5 };
const fai: SecondaryOperation = { id: 'f', name: 'FAI', category: 'inspection', lotCharge: 85, perPartCost: 0.75 };

describe('secondary-ops cost math', () => {
  it('amortises the lot charge over the batch and adds per-part', () => {
    expect(secondaryOpPerUnit(gold, 1)).toBeCloseTo(202.5, 6); // 200/1 + 2.5
    expect(secondaryOpPerUnit(gold, 100)).toBeCloseTo(4.5, 6); // 200/100 + 2.5
  });

  it('sums a selection', () => {
    expect(secondaryOpsCostPerUnit([gold, fai], 10)).toBeCloseTo(200 / 10 + 2.5 + 85 / 10 + 0.75, 6);
  });

  it('is zero for no ops', () => {
    expect(secondaryOpsCostPerUnit(undefined, 5)).toBe(0);
    expect(secondaryOpsCostPerUnit([], 5)).toBe(0);
  });

  it('emits one line item per op with a readable driver', () => {
    const items = secondaryOpsLineItems([gold], 4);
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe('secondary');
    expect(items[0].name).toBe('Gold plate');
    expect(items[0].driver).toContain('$200 lot ÷ 4');
    expect(items[0].driver).toContain('$2.50/part');
    expect(items[0].value).toBeCloseTo(52.5, 6); // 200/4 + 2.5
  });
});

describe('secondary ops fold into the milled quote', () => {
  const profile: MilledProfile = {
    stockMm: { x: 40, y: 14, z: 32 }, stockVolumeCm3: 18, partVolumeCm3: 8,
    removedVolumeCm3: 10, surfaceAreaCm2: 60, setupCount: 3,
    pocketCount: 0, bossCount: 2, deepPocketCount: 0, holeCount: 6,
    holeDiametersMm: [1.6, 2.1, 2.3, 3.6, 4.4, 4.4],
  };
  const run = (ops: SecondaryOperation[] | undefined, qty: number) =>
    calculateMilledCosts(
      { materialName: 'Aluminium 6082', profile, materialPricePerKg: 16.5, secondaryOps: ops },
      qty, false, 0.25, DEFAULT_SHOP_SETTINGS
    );

  it('a plated quote costs more than an unplated one', () => {
    const plain = run(undefined, 1);
    const plated = run([gold], 1);
    expect(plated.subtotal).toBeGreaterThan(plain.subtotal);
    // plating shows up as its own line item
    expect(plated.lineItems.some((l) => l.key === 'secondary' && l.name === 'Gold plate')).toBe(true);
  });

  it('the plating premium shrinks with quantity (lot charge amortises)', () => {
    const at1 = run([gold], 1);
    const at100 = run([gold], 100);
    const premiumAt1 = at1.lineItems.find((l) => l.key === 'secondary')!.value;
    const premiumAt100 = at100.lineItems.find((l) => l.key === 'secondary')!.value;
    expect(premiumAt1).toBeCloseTo(202.5, 4);
    expect(premiumAt100).toBeCloseTo(4.5, 4);
    expect(premiumAt100).toBeLessThan(premiumAt1);
  });

  it('overhead + margin apply to the secondary cost (folded into subtotal)', () => {
    const plain = run(undefined, 1);
    const plated = run([gold], 1);
    const unitPlain = plain.subtotal + plain.overhead + plain.marginAmount;
    const unitPlated = plated.subtotal + plated.overhead + plated.marginAmount;
    // the extra unit price exceeds the raw $202.5 because overhead + margin ride on top
    expect(unitPlated - unitPlain).toBeGreaterThan(202.5);
  });
});
