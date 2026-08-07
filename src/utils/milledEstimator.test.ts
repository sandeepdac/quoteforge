import { describe, it, expect } from 'vitest';
import { calculateMilledCosts, MilledMachiningInput, MilledProfile } from './milledEstimator';
import { DEFAULT_SHOP_SETTINGS } from '../constants';

// A 60×40×20 mm aluminium block with one open pocket (~12.5% removed), 1 setup.
const baseProfile: MilledProfile = {
  stockMm: { x: 60, y: 40, z: 20 },
  stockVolumeCm3: 48,
  partVolumeCm3: 42,
  removedVolumeCm3: 6,
  surfaceAreaCm2: 120,
  setupCount: 1,
  pocketCount: 1,
  bossCount: 0,
  deepPocketCount: 0,
  holeCount: 0,
};

const input = (profile: MilledProfile): MilledMachiningInput => ({
  materialName: 'Aluminium 6082',
  profile,
  materialPricePerKg: 6,
});

describe('calculateMilledCosts (milling cycle-time)', () => {
  const costs = calculateMilledCosts(input(baseProfile), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);

  it('flags the milling route and reports stock/pocket metadata', () => {
    expect(costs.machineClass).toBe('mill');
    expect(costs.stockMm).toEqual({ x: 60, y: 40, z: 20 });
    expect(costs.pocketCount).toBe(1);
    expect(costs.setups).toBe(1);
  });

  it('produces a positive per-part cycle time and machine cost', () => {
    expect(costs.cycleTimeSec).toBeGreaterThan(0);
    expect(costs.machineCost).toBeGreaterThan(0);
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
});

describe('setup amortisation (batch curve)', () => {
  const costs = calculateMilledCosts(input(baseProfile), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);

  it('unit price falls as quantity rises (setup spread over the batch)', () => {
    const prices = costs.batchCurve.map((p) => p.unitPrice);
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).toBeLessThan(prices[i - 1]);
    }
  });
});

describe('the three geometric rules move the price', () => {
  it('more setups (Rule 1) raise the setup cost', () => {
    const one = calculateMilledCosts(input({ ...baseProfile, setupCount: 1 }), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    const three = calculateMilledCosts(input({ ...baseProfile, setupCount: 3 }), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    expect(three.setupCost).toBeGreaterThan(one.setupCost);
    expect(three.subtotal).toBeGreaterThan(one.subtotal);
  });

  it('a deep pocket (Rule 3) increases the machining cost via the reach derate', () => {
    const shallow = calculateMilledCosts(input(baseProfile), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    const deep = calculateMilledCosts(input({ ...baseProfile, deepPocketCount: 1 }), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    expect(deep.machineCost).toBeGreaterThan(shallow.machineCost);
    expect(deep.deepPocketCount).toBe(1);
  });

  it('more removed volume (billet − part) raises roughing/machine cost', () => {
    const light = calculateMilledCosts(input({ ...baseProfile, partVolumeCm3: 45, removedVolumeCm3: 3 }), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    const heavy = calculateMilledCosts(input({ ...baseProfile, partVolumeCm3: 20, removedVolumeCm3: 28 }), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    expect(heavy.machineCost).toBeGreaterThan(light.machineCost);
  });
});

describe('soft-jaw / fixture amortisation', () => {
  // 3 setups → soft jaws are needed. They are made ONCE for the job, so their
  // per-part share must fall with batch size (this used to be charged per part).
  const p: MilledProfile = { ...baseProfile, setupCount: 3 };

  it('charges fixturing per job, not per part', () => {
    const one = calculateMilledCosts(input(p), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    const many = calculateMilledCosts(input(p), 100, false, 0.25, DEFAULT_SHOP_SETTINGS);
    const fixtureOf = (c: typeof one) => c.lineItems.find((li) => li.key === 'fixture')?.value ?? 0;
    expect(fixtureOf(one)).toBeGreaterThan(0);
    expect(fixtureOf(many)).toBeCloseTo(fixtureOf(one) / 100, 6);
  });

  it('the batch curve keeps falling toward the per-part cost', () => {
    const c = calculateMilledCosts(input(p), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    const prices = c.batchCurve.map((b) => b.unitPrice);
    for (let i = 1; i < prices.length; i++) expect(prices[i]).toBeLessThan(prices[i - 1]);
  });
});

describe('milling uses milling physics, not turning physics', () => {
  it('roughing time scales with the volume hogged out', () => {
    const light = calculateMilledCosts(input(baseProfile), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    const heavy = calculateMilledCosts(
      input({ ...baseProfile, partVolumeCm3: 10, removedVolumeCm3: 38 }), 1, false, 0.25, DEFAULT_SHOP_SETTINGS
    );
    const roughOf = (c: typeof light) => c.lineItems.find((li) => li.key === 'rough')?.value ?? 0;
    // 6 → 38 cm³ is ~6.3× the material, so roughing should scale in step. The
    // TOTAL cycle moves far less: on a small part with a lot of surface, finishing
    // and tool changes dominate — which is itself the realistic behaviour.
    expect(roughOf(heavy) / roughOf(light)).toBeGreaterThan(5);
    expect(heavy.cycleTimeSec).toBeGreaterThan(light.cycleTimeSec);
  });

  it('counts real cutters so tool changes are not trivial', () => {
    const c = calculateMilledCosts(input({ ...baseProfile, setupCount: 3, holeCount: 4 }), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    const air = c.lineItems.find((li) => li.key === 'noncut');
    expect(air).toBeDefined();
    expect(air!.value).toBeGreaterThan(0);
  });
});
