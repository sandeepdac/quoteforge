import { describe, it, expect } from 'vitest';
import { resolveQuoteCosts } from './quoteCosts';
import { calculateMachiningCosts } from './cncEstimator';
import { DEFAULT_SHOP_SETTINGS } from '../constants';
import type { PartFeatures } from '../types';
import type { ExtractedCadAnalysis } from './cadAnalyzer';

const features: PartFeatures = {
  perimeterMm: 0, pierceCount: 0, bendCount: 0, isSimpleBending: true,
  weldLengthMm: 0, weldCount: 0, holeCount: 1, surfaceAreaM2: 0.02,
  weightKg: 0, lengthMm: 100, widthMm: 20, heightMm: 20,
};

const turnedAnalysis = {
  isTurned: true,
  volumeCm3: 25,
  setups: 1,
  turningProfile: { odMm: 20, lengthMm: 100, boreDiaMm: 8, boreDepthMm: 60, grooveCount: 0, threadCount: 0, faceCount: 2, crossFeatures: false },
  machineRecommendation: { recommended: 'sliding-head', recommendedName: 'Sliding-Head', rateMultiplier: 1, reasons: [], candidates: [] },
} as unknown as ExtractedCadAnalysis;

describe('resolveQuoteCosts (save/preview parity)', () => {
  it('routes a turned part through the turning model and matches it exactly', () => {
    const r = resolveQuoteCosts({
      cadAnalysis: turnedAnalysis, features, materialName: 'Brass CZ121',
      materialPricePerKg: 9, quantity: 25, isRush: false, margin: 0.25, settings: DEFAULT_SHOP_SETTINGS,
    });
    const mc = calculateMachiningCosts(
      { isTurned: true, materialName: 'Brass CZ121', volumeCm3: 25, profile: turnedAnalysis.turningProfile!, setups: 1, materialPricePerKg: 9 },
      25, false, 0.25, DEFAULT_SHOP_SETTINGS, 1
    );
    expect(r.machineClass).toBe('turn');
    expect(r.machiningCosts).toBeDefined();
    // Persisted QuoteCosts totals equal the machining model's totals.
    expect(r.costs.subtotal).toBeCloseTo(mc.subtotal, 6);
    expect(r.costs.overhead).toBeCloseTo(mc.overhead, 6);
    const expectedUnit = mc.subtotal + mc.overhead + mc.marginAmount;
    expect(r.unitPrice).toBeCloseTo(expectedUnit, 6);
    expect(r.grandTotal).toBeCloseTo(expectedUnit * 25 + mc.rushPremium, 6);
  });

  it('maps machining line costs so QuoteCosts still sums to the subtotal', () => {
    const r = resolveQuoteCosts({
      cadAnalysis: turnedAnalysis, features, materialName: 'Brass CZ121',
      materialPricePerKg: 9, quantity: 1, isRush: false, margin: 0.25, settings: DEFAULT_SHOP_SETTINGS,
    });
    const c = r.costs;
    const sum = c.materialCost + c.laserCost + c.bendCost + c.weldCost + c.assemblyCost + c.finishCost;
    expect(sum).toBeCloseTo(c.subtotal, 4);
  });

  it('falls back to the fabrication model when there is no machining analysis', () => {
    const r = resolveQuoteCosts({
      cadAnalysis: undefined, features: { ...features, weightKg: 2, perimeterMm: 400, pierceCount: 4 },
      materialName: 'Mild Steel', materialPricePerKg: 2, quantity: 10, isRush: false, margin: 0.25, settings: DEFAULT_SHOP_SETTINGS,
    });
    expect(r.machineClass).toBeUndefined();
    expect(r.machiningCosts).toBeUndefined();
    expect(r.grandTotal).toBeGreaterThan(0);
  });
});
