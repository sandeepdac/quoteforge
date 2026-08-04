import { describe, it, expect } from 'vitest';
import { calculateMachiningCosts, computeStock, MachiningInput } from './cncEstimator';
import { TurningProfile } from './turning';
import { DEFAULT_SHOP_SETTINGS } from '../constants';

const profile: TurningProfile = {
  odMm: 20,
  lengthMm: 100,
  boreDiaMm: 8,
  boreDepthMm: 60,
  grooveCount: 0,
  threadCount: 0,
  faceCount: 2,
  crossFeatures: false,
};

const partVol = (Math.PI / 4) * 20 * 20 * 100 / 1000 - (Math.PI / 4) * 8 * 8 * 60 / 1000; // solid − bore

const brass: MachiningInput = {
  isTurned: true,
  materialName: 'Brass CZ121',
  volumeCm3: partVol,
  profile,
  setups: 1,
  materialPricePerKg: 9,
};

describe('computeStock', () => {
  it('selects the next standard bar over OD + radial allowance', () => {
    const s = computeStock(profile);
    // od 20 + 2×2 = 24 → next standard bar = 25 mm
    expect(s.barDiameterMm).toBe(25);
    // length + facing(2) + parting(3)
    expect(s.barLengthMm).toBeCloseTo(105, 5);
    expect(s.stockVolumeCm3).toBeCloseTo((Math.PI / 4) * 25 * 25 * 105 / 1000, 3);
  });
});

describe('calculateMachiningCosts (turning cycle-time)', () => {
  const costs = calculateMachiningCosts(brass, 1, false, 0.25, DEFAULT_SHOP_SETTINGS);

  it('produces a positive per-part cycle time', () => {
    expect(costs.cycleTimeSec).toBeGreaterThan(0);
  });

  it('reports a buy-to-fly ratio between 0 and 1', () => {
    expect(costs.buyToFlyRatio).toBeGreaterThan(0);
    expect(costs.buyToFlyRatio).toBeLessThan(1);
  });

  it('line items sum to the subtotal and each carries a driver', () => {
    const sum = costs.lineItems.reduce((s, li) => s + li.value, 0);
    expect(sum).toBeCloseTo(costs.subtotal, 4);
    expect(costs.lineItems.every((li) => li.value > 0 && li.driver.length > 0)).toBe(true);
  });

  it('amortises setup over the batch — unit price falls as quantity rises', () => {
    expect(costs.batchCurve).toHaveLength(5);
    const q1 = costs.batchCurve[0];
    const q500 = costs.batchCurve[4];
    expect(q1.quantity).toBe(1);
    expect(q500.quantity).toBe(500);
    expect(q1.unitPrice).toBeGreaterThan(q500.unitPrice);
    expect(q1.setupPerUnit).toBeGreaterThan(q500.setupPerUnit * 10);
  });

  it('at qty 1 setup dominates; at qty 500 it is negligible', () => {
    const q1 = costs.batchCurve[0];
    const q500 = costs.batchCurve[4];
    expect(q1.setupPerUnit).toBeGreaterThan(q1.unitPrice * 0.3);
    expect(q500.setupPerUnit).toBeLessThan(q500.unitPrice * 0.05);
  });

  it('machines stainless slower (more machine cost) than brass', () => {
    const stainless = calculateMachiningCosts(
      { ...brass, materialName: 'Stainless 316' }, 1, false, 0.25, DEFAULT_SHOP_SETTINGS
    );
    expect(stainless.machineCost).toBeGreaterThan(costs.machineCost);
  });

  it('rolls up subtotal → overhead → margin and adds rush only when set', () => {
    expect(costs.overhead).toBeCloseTo(costs.subtotal * DEFAULT_SHOP_SETTINGS.overheadPercent, 5);
    expect(costs.marginAmount).toBeCloseTo((costs.subtotal + costs.overhead) * 0.25, 5);
    expect(costs.rushPremium).toBe(0);
    const rushed = calculateMachiningCosts(brass, 5, true, 0.25, DEFAULT_SHOP_SETTINGS);
    expect(rushed.rushPremium).toBeGreaterThan(0);
  });

  it('a worse efficiency factor increases cycle time and machine cost', () => {
    const slow = calculateMachiningCosts(brass, 1, false, 0.25, {
      ...DEFAULT_SHOP_SETTINGS,
      cnc: { ...DEFAULT_SHOP_SETTINGS.cnc!, efficiencyFactor: 0.6 },
    });
    expect(slow.cycleTimeSec).toBeGreaterThan(costs.cycleTimeSec);
    expect(slow.machineCost).toBeGreaterThan(costs.machineCost);
  });
});
