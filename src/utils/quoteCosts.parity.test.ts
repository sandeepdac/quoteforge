import { describe, it, expect } from 'vitest';
import { resolveQuoteCosts } from './quoteCosts';
import { calculateMachiningCosts } from './cncEstimator';
import { DEFAULT_SHOP_SETTINGS } from '../constants';
import type { PartFeatures } from '../types';
import type { ExtractedCadAnalysis } from './cadAnalyzer';

/**
 * THE PRICE SHOWN MUST BE THE PRICE SAVED.
 *
 * The wizard used to carry its own copy of the estimator dispatch, and the copy
 * drifted: it never passed the route's setup minutes, so a customer approved a
 * price on the Review screen and a different one — between 1.3x and 2.7x higher
 * across Lance's seven parts — was written to storage when they pressed Send.
 *
 * Both screens now call resolveQuoteCosts, so the only way to reintroduce that
 * bug is to add a pricing input the resolver does not read. These tests pin the
 * inputs that have caused it: the machine route, and the secondary operations.
 */
const features = {
  perimeterMm: 0, pierceCount: 0, bendCount: 0, isSimpleBending: true,
  weldLengthMm: 0, weldCount: 0, holeCount: 1, surfaceAreaM2: 0.02,
  weightKg: 0, lengthMm: 100, widthMm: 20, heightMm: 20,
} as PartFeatures;

const profile = {
  odMm: 20, lengthMm: 100, boreDiaMm: 8, boreDepthMm: 60,
  grooveCount: 0, threadCount: 0, faceCount: 2, crossFeatures: false,
};

const withRoute = (totalSetupMin: number) => ({
  isTurned: true, volumeCm3: 25, setups: 1, turningProfile: profile,
  machineRecommendation: {
    recommended: 'star-sr32', recommendedName: 'Star SR-32', rateMultiplier: 1,
    reasons: [], candidates: [],
    machineRoute: { ops: [], machines: ['star-sr32'], totalSetupMin },
  },
} as unknown as ExtractedCadAnalysis);

const price = (cadAnalysis: ExtractedCadAnalysis, secondaryOps?: never[]) =>
  resolveQuoteCosts({
    cadAnalysis, features, materialName: 'Brass CZ121', materialPricePerKg: 9,
    quantity: 10, isRush: false, margin: 0.25, settings: DEFAULT_SHOP_SETTINGS,
    secondaryOps,
  });

describe('the resolver is the only way to price a quote', () => {
  it('the route setup reaches the price', () => {
    // If a screen forgets to route through here, this is the gap it opens.
    expect(price(withRoute(900)).unitPrice).toBeGreaterThan(price(withRoute(60)).unitPrice);
  });

  it('bills exactly the route minutes, not the fallback formula', () => {
    expect(price(withRoute(900)).machiningCosts!.setupTimeMin).toBe(900);
  });

  it('a screen that skips the resolver under-prices the quote', () => {
    // This is the bug, reproduced: the estimator called WITHOUT routeSetupMin —
    // exactly what the wizard used to do — is cheaper than the saved quote.
    const naive = calculateMachiningCosts(
      { isTurned: true, materialName: 'Brass CZ121', volumeCm3: 25, profile, setups: 1, materialPricePerKg: 9 },
      10, false, 0.25, DEFAULT_SHOP_SETTINGS, 1,
    );
    const naivePrice = naive.subtotal + naive.overhead + naive.marginAmount;
    expect(naivePrice).toBeLessThan(price(withRoute(900)).unitPrice);
  });

  it('secondary operations survive the trip to storage', () => {
    const plating = [{ id: 'p', name: 'Gold plate', category: 'plating', lotCharge: 200, perPartCost: 2.5, leadTimeDays: 10 }];
    const withOps = resolveQuoteCosts({
      cadAnalysis: withRoute(240), features, materialName: 'Brass CZ121', materialPricePerKg: 9,
      quantity: 10, isRush: false, margin: 0.25, settings: DEFAULT_SHOP_SETTINGS,
      secondaryOps: plating as never,
    });
    expect(withOps.unitPrice).toBeGreaterThan(price(withRoute(240)).unitPrice);
    // And they must be visible as a line, or the traveller cannot route the part out.
    expect(withOps.lineItems.some((li) => /plate|secondary/i.test(li.name + li.key))).toBe(true);
  });
});
