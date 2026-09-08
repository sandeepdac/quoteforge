import { describe, it, expect } from 'vitest';
import { calculateMachiningCosts } from './cncEstimator';
import { calculateMilledCosts, MilledProfile } from './milledEstimator';
import { DEFAULT_SHOP_SETTINGS } from '../constants';

/**
 * THE BREAKDOWN MUST EXPLAIN THE SUBTOTAL.
 *
 * Every estimator returns a subtotal and a list of line items that is supposed
 * to account for it. Nothing enforced that, so each new cost term added to the
 * total without a matching row made the two drift further apart — off-axis
 * features were the most recent, billed inside machineCost and shown nowhere.
 *
 * A customer asking "why is this £120?" gets the line items. If they do not add
 * up, the answer is wrong.
 */
const turned = {
  isTurned: true as const,
  materialName: 'Brass CZ121',
  volumeCm3: 25,
  materialPricePerKg: 9,
  setups: 1,
  profile: {
    odMm: 20, lengthMm: 100, boreDiaMm: 8, boreDepthMm: 60,
    grooveCount: 2, threadCount: 1, faceCount: 2, crossFeatures: true,
    crossFeatureList: [
      { diameterMm: 4, lengthMm: 10 },
      { diameterMm: 6, lengthMm: 12 },
      { diameterMm: 30, lengthMm: 8 },
    ],
  },
};

const milled: MilledProfile = {
  stockMm: { x: 60, y: 40, z: 25 }, stockVolumeCm3: 60, partVolumeCm3: 30,
  removedVolumeCm3: 30, surfaceAreaCm2: 120, setupCount: 2, pocketCount: 1,
  bossCount: 1, deepPocketCount: 0, holeCount: 3,
  holeDiametersMm: [8, 5, 2], holeDepthsMm: [20, 12, 6],
  crossFeatureList: [{ diameterMm: 6, lengthMm: 14 }, { diameterMm: 26, lengthMm: 9 }],
};

const sum = (items: { value: number }[]) => items.reduce((a, li) => a + li.value, 0);

describe('line items account for the subtotal', () => {
  it('turned part, with off-axis features', () => {
    const c = calculateMachiningCosts(turned as never, 10, false, 0.25, DEFAULT_SHOP_SETTINGS, 1, 240);
    expect(sum(c.lineItems)).toBeCloseTo(c.subtotal, 2);
  });

  it('turned part at qty 1, where one-time costs are largest', () => {
    const c = calculateMachiningCosts(turned as never, 1, false, 0.25, DEFAULT_SHOP_SETTINGS, 1, 900);
    expect(sum(c.lineItems)).toBeCloseTo(c.subtotal, 2);
  });

  it('turned part with no off-axis work at all', () => {
    const plain = { ...turned, profile: { ...turned.profile, crossFeatures: false, crossFeatureList: [] } };
    const c = calculateMachiningCosts(plain as never, 5, false, 0.25, DEFAULT_SHOP_SETTINGS);
    expect(sum(c.lineItems)).toBeCloseTo(c.subtotal, 2);
  });

  it('milled part, with off-axis features', () => {
    const c = calculateMilledCosts(
      { materialName: 'Aluminium 6082', profile: milled, materialPricePerKg: 16.5 },
      10, false, 0.25, DEFAULT_SHOP_SETTINGS, 1, 330);
    expect(sum(c.lineItems)).toBeCloseTo(c.subtotal, 2);
  });

  it('milled part carrying secondary operations', () => {
    const c = calculateMilledCosts(
      { materialName: 'Aluminium 6082', profile: milled, materialPricePerKg: 16.5,
        secondaryOps: [{ id: 'p', name: 'Gold plate', category: 'plating', lotCharge: 200, perPartCost: 2.5, leadTimeDays: 10 }] as never },
      10, false, 0.25, DEFAULT_SHOP_SETTINGS, 1, 330);
    expect(sum(c.lineItems)).toBeCloseTo(c.subtotal, 2);
  });

  it('off-axis features actually move the price', () => {
    const withCross = calculateMachiningCosts(turned as never, 10, false, 0.25, DEFAULT_SHOP_SETTINGS, 1, 240);
    const without = calculateMachiningCosts(
      { ...turned, profile: { ...turned.profile, crossFeatureList: [] } } as never,
      10, false, 0.25, DEFAULT_SHOP_SETTINGS, 1, 240);
    expect(withCross.subtotal).toBeGreaterThan(without.subtotal);
  });
});

describe('the feedrate override moves the rows, not just the total', () => {
  const slow = {
    ...DEFAULT_SHOP_SETTINGS,
    cnc: { ...DEFAULT_SHOP_SETTINGS.cnc!, feedrateRatioPercent: 50 },
  };

  it('turned: line items still account for the subtotal at 50% feed', () => {
    const c = calculateMachiningCosts(turned as never, 10, false, 0.25, slow, 1, 240);
    expect(sum(c.lineItems)).toBeCloseTo(c.subtotal, 2);
  });

  it('turned: halving the feed makes the cutting rows more expensive', () => {
    const fast = calculateMachiningCosts(turned as never, 10, false, 0.25, DEFAULT_SHOP_SETTINGS, 1, 240);
    const half = calculateMachiningCosts(turned as never, 10, false, 0.25, slow, 1, 240);
    const rough = (c: typeof fast) => c.lineItems.find((li) => li.key === 'rough')!.value;
    expect(half.cycleTimeSec).toBeGreaterThan(fast.cycleTimeSec);
    expect(rough(half)).toBeGreaterThan(rough(fast));
  });

  it('milled: line items still account for the subtotal at 50% feed', () => {
    const c = calculateMilledCosts(
      { materialName: 'Aluminium 6082', profile: milled, materialPricePerKg: 16.5 },
      10, false, 0.25, slow, 1, 330);
    expect(sum(c.lineItems)).toBeCloseTo(c.subtotal, 2);
  });
});

describe('the plan accounts for the cycle time it is billed for', () => {
  // The traveller and the cost table are built from the plan. When a cost term
  // is billed but has no operation, the shop is handed run minutes that do not
  // match the price — which is how off-axis work came to be invisible.
  const planSec = (c: { plan?: { setups: { operations: { seconds: number }[] }[] } }) =>
    (c.plan?.setups ?? []).reduce(
      (a, s) => a + s.operations.reduce((b, o) => b + o.seconds, 0), 0);

  it('milled: off-axis seconds appear as an operation', () => {
    const c = calculateMilledCosts(
      { materialName: 'Aluminium 6082', profile: milled, materialPricePerKg: 16.5 },
      10, false, 0.25, DEFAULT_SHOP_SETTINGS, 1, 330);
    const names = (c.plan?.setups ?? []).flatMap((s) => s.operations.map((o) => o.name));
    expect(names.some((n) => /off-axis/i.test(n))).toBe(true);
  });

  it('milled: the plan covers the cutting time, not a fraction of it', () => {
    const c = calculateMilledCosts(
      { materialName: 'Aluminium 6082', profile: milled, materialPricePerKg: 16.5 },
      10, false, 0.25, DEFAULT_SHOP_SETTINGS, 1, 330);
    // The plan excludes tool changes/rapids, so it should be a large share of
    // the billed cycle — never a small one, which is what a missing op looks like.
    expect(planSec(c)).toBeGreaterThan(c.cycleTimeSec * 0.6);
    expect(planSec(c)).toBeLessThanOrEqual(c.cycleTimeSec + 0.5);
  });

  it('milled: drilling minutes follow the holes that are slow, not the count', () => {
    // One deep small hole and several shallow big ones. The deep one is the
    // expensive operation; a count-based split would hand it the smallest share.
    const lopsided: MilledProfile = {
      ...milled,
      holeCount: 4,
      holeDiametersMm: [10, 10, 10, 1],
      holeDepthsMm: [2, 2, 2, 30],
    };
    const c = calculateMilledCosts(
      { materialName: 'Aluminium 6082', profile: lopsided, materialPricePerKg: 16.5 },
      10, false, 0.25, DEFAULT_SHOP_SETTINGS, 1, 330);
    const ops = (c.plan?.setups ?? []).flatMap((s) => s.operations);
    const small = ops.find((o) => /⌀1\b/.test(o.name));
    const big = ops.find((o) => /⌀10\b/.test(o.name));
    expect(small).toBeDefined();
    expect(big).toBeDefined();
    expect(small!.seconds).toBeGreaterThan(big!.seconds);
  });
});
