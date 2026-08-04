import { describe, it, expect } from 'vitest';
import { calculateMachiningCosts, stockVolumeCm3, MachiningInput } from './cncEstimator';
import { DEFAULT_SHOP_SETTINGS } from '../constants';

// A turned brass part: ⌀20 × 100 finished, machined from round bar.
const turnedBrass: MachiningInput = {
  partClass: 'turned',
  materialName: 'Brass CZ121',
  volumeCm3: (Math.PI / 4) * 20 * 20 * 100 / 1000, // solid ⌀20×100 ≈ 31.4 cm³
  surfaceAreaCm2: 70,
  boundingBoxMm: { lengthMm: 100, widthMm: 20, heightMm: 20 },
  diameterMm: 20,
  axisLengthMm: 100,
  holeCount: 2,
  holeDetails: [{ diameterMm: 6, count: 2 }],
  setups: 1,
  materialPricePerKg: 9,
};

describe('stockVolumeCm3', () => {
  it('uses round bar (⌀ + allowance, length + facing) for turned parts', () => {
    const v = stockVolumeCm3(turnedBrass);
    // bar ⌀22 × 105 → π/4·22²·105/1000
    const expected = (Math.PI / 4) * 22 * 22 * 105 / 1000;
    expect(v).toBeCloseTo(expected, 3);
    expect(v).toBeGreaterThan(turnedBrass.volumeCm3); // stock must exceed the part
  });

  it('uses a rectangular billet (grown faces) for milled parts', () => {
    const v = stockVolumeCm3({
      ...turnedBrass,
      partClass: 'milled',
      boundingBoxMm: { lengthMm: 100, widthMm: 60, heightMm: 40 },
    });
    // each face +3mm → 106 × 66 × 46
    expect(v).toBeCloseTo((106 * 66 * 46) / 1000, 3);
  });
});

describe('calculateMachiningCosts', () => {
  const costs = calculateMachiningCosts(turnedBrass, 1, false, 0.25, DEFAULT_SHOP_SETTINGS);

  it('computes a buy-to-fly ratio (part ÷ stock) between 0 and 1', () => {
    expect(costs.buyToFlyRatio).toBeGreaterThan(0);
    expect(costs.buyToFlyRatio).toBeLessThan(1);
  });

  it('removes the stock-minus-part volume as roughing', () => {
    expect(costs.removedVolumeCm3).toBeCloseTo(costs.stockVolumeCm3 - costs.partVolumeCm3, 1);
    expect(costs.roughingCost).toBeGreaterThan(0);
  });

  it('produces traceable, positive-only line items that sum to the subtotal', () => {
    const sum = costs.lineItems.reduce((s, li) => s + li.value, 0);
    expect(sum).toBeCloseTo(costs.subtotal, 5);
    expect(costs.lineItems.every((li) => li.value > 0)).toBe(true);
    expect(costs.lineItems.find((li) => li.key === 'stock')?.name).toBe('Bar stock');
  });

  it('rolls up subtotal → overhead → margin', () => {
    expect(costs.overhead).toBeCloseTo(costs.subtotal * DEFAULT_SHOP_SETTINGS.overheadPercent, 5);
    expect(costs.marginAmount).toBeCloseTo((costs.subtotal + costs.overhead) * 0.25, 5);
  });

  it('machines stainless far slower than brass for the same geometry', () => {
    const stainless = calculateMachiningCosts(
      { ...turnedBrass, materialName: 'Stainless 316' },
      1, false, 0.25, DEFAULT_SHOP_SETTINGS
    );
    expect(stainless.roughingCost).toBeGreaterThan(costs.roughingCost * 3);
  });

  it('charges no rush premium for standard orders and adds one when rushed', () => {
    expect(costs.rushPremium).toBe(0);
    const rushed = calculateMachiningCosts(turnedBrass, 2, true, 0.25, DEFAULT_SHOP_SETTINGS);
    expect(rushed.rushPremium).toBeGreaterThan(0);
  });
});
