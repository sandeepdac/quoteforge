import { describe, it, expect } from 'vitest';
import { calculateQuoteCosts, calculateWinProbability } from './estimator';
import { DEFAULT_SHOP_SETTINGS } from '../constants';
import { PartFeatures } from '../types';

// A deliberately round feature set so every cost component can be hand-verified.
const features: PartFeatures = {
  perimeterMm: 3000,
  pierceCount: 4,
  bendCount: 2,
  isSimpleBending: true,
  weldLengthMm: 300,
  weldCount: 1,
  holeCount: 5,
  surfaceAreaM2: 1,
  weightKg: 10,
  lengthMm: 300,
  widthMm: 200,
  heightMm: 40,
};

describe('calculateQuoteCosts', () => {
  const costs = calculateQuoteCosts(features, 2, false, 0.25, 2.0, DEFAULT_SHOP_SETTINGS);

  it('computes each manufacturing cost component from features and shop rates', () => {
    // material = weight * price * (1 + scrapFactor) = 10 * 2 * 1.15
    expect(costs.materialCost).toBeCloseTo(23.0, 5);
    // laser = (3000/3000 + 4*0.5) min * $2.50
    expect(costs.laserCost).toBeCloseTo(7.5, 5);
    // bend = (2*0.4 + 3 setup) min * $1.80
    expect(costs.bendCost).toBeCloseTo(6.84, 5);
    // weld = (300/300 + 1*2) min * $1.50
    expect(costs.weldCost).toBeCloseTo(4.5, 5);
    // assembly = 5 base + (1.2 * 5 holes * $1.20)
    expect(costs.assemblyCost).toBeCloseTo(12.2, 5);
    // finish = 1 m2 * $15
    expect(costs.finishCost).toBeCloseTo(15.0, 5);
  });

  it('rolls components into subtotal, overhead and margin', () => {
    expect(costs.subtotal).toBeCloseTo(69.04, 5);
    expect(costs.overhead).toBeCloseTo(69.04 * 0.12, 5);
    expect(costs.marginAmount).toBeCloseTo((69.04 + 69.04 * 0.12) * 0.25, 5);
  });

  it('does not add a rush premium for standard orders', () => {
    expect(costs.rushPremium).toBe(0);
  });

  it('applies the rush premium to the full quote total when isRush is set', () => {
    const rushed = calculateQuoteCosts(features, 2, true, 0.25, 2.0, DEFAULT_SHOP_SETTINGS);
    const unitPrice = rushed.subtotal + rushed.overhead + rushed.marginAmount;
    const quoteTotal = unitPrice * 2;
    expect(rushed.rushPremium).toBeCloseTo(quoteTotal * DEFAULT_SHOP_SETTINGS.rushPremiumPercent, 5);
  });

  it('charges more time for compound bends than simple bends', () => {
    const simple = calculateQuoteCosts(features, 1, false, 0.25, 2.0, DEFAULT_SHOP_SETTINGS);
    const compound = calculateQuoteCosts(
      { ...features, isSimpleBending: false },
      1,
      false,
      0.25,
      2.0,
      DEFAULT_SHOP_SETTINGS
    );
    expect(compound.bendCost).toBeGreaterThan(simple.bendCost);
  });

  it('scales material cost linearly with material price', () => {
    const cheap = calculateQuoteCosts(features, 1, false, 0.25, 1.0, DEFAULT_SHOP_SETTINGS);
    const pricey = calculateQuoteCosts(features, 1, false, 0.25, 4.0, DEFAULT_SHOP_SETTINGS);
    expect(pricey.materialCost).toBeCloseTo(cheap.materialCost * 4, 5);
  });
});

describe('calculateWinProbability', () => {
  it('drops as margin rises', () => {
    expect(calculateWinProbability(0.1, 10)).toBeGreaterThan(calculateWinProbability(0.4, 10));
  });

  it('rewards short lead times and penalizes long ones', () => {
    const short = calculateWinProbability(0.2, 3);
    const normal = calculateWinProbability(0.2, 10);
    const long = calculateWinProbability(0.2, 20);
    expect(short).toBeGreaterThan(normal);
    expect(long).toBeLessThan(normal);
  });

  it('clamps the result to the [5, 98] range', () => {
    expect(calculateWinProbability(0.95, 20)).toBe(5); // would be negative before clamping
    const result = calculateWinProbability(0.01, 3);
    expect(result).toBeGreaterThanOrEqual(5);
    expect(result).toBeLessThanOrEqual(98);
  });

  it('returns an integer', () => {
    expect(Number.isInteger(calculateWinProbability(0.23, 7))).toBe(true);
  });
});
