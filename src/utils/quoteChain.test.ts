import { describe, it, expect } from 'vitest';
import { resolveQuoteCosts, type ResolveParams } from './quoteCosts';
import { DEFAULT_SHOP_SETTINGS, DEFAULT_SECONDARY_OPS } from '../constants';
import type { PartFeatures } from '../types';
import type { TurningProfile } from './turning';
import type { ExtractedCadAnalysis } from './cadAnalyzer';

/**
 * THE CHAIN: quote -> estimate -> saved quote -> PDF.
 *
 * Four surfaces show a customer a price, and they are only trustworthy if they
 * are the same number. Two of them have diverged before in this codebase: the
 * wizard once previewed a price the save path recomputed differently, and the
 * quantity step once priced at the shop's default margin while Review used the
 * quoter's own. Both were found by hand. This is the check that finds them.
 *
 * The PDF is not rendered here — it reads the SAVED quote's fields
 * (totalUnitPrice, grandTotal, costs.*, machiningCosts.lineItems), so asserting
 * those fields are internally consistent is what makes the PDF correct.
 */
const profile: TurningProfile = {
  odMm: 29.3, lengthMm: 70, boreDiaMm: 11.8, boreDepthMm: 14, grooveCount: 4,
  threadCount: 0, faceCount: 2, crossFeatures: false,
};
const features = {
  perimeterMm: 0, pierceCount: 0, bendCount: 0, isSimpleBending: false, weldLengthMm: 0,
  weldCount: 0, holeCount: 1, surfaceAreaM2: 0.01, weightKg: 0.18,
  lengthMm: 70, widthMm: 29.3, heightMm: 29.3,
} as PartFeatures;
const cadAnalysis = { isTurned: true, turningProfile: profile, setups: 1, volumeCm3: 21 } as unknown as ExtractedCadAnalysis;

const base: ResolveParams = {
  cadAnalysis, features, materialName: 'Brass CZ121', materialPricePerKg: 12,
  quantity: 1, isRush: false, margin: 0.25, settings: DEFAULT_SHOP_SETTINGS,
};

describe('the same inputs give the same price, every time', () => {
  it('resolving twice is identical — nothing depends on call order or clocks', () => {
    const a = resolveQuoteCosts(base);
    const b = resolveQuoteCosts(base);
    expect(b.unitPrice).toBe(a.unitPrice);
    expect(b.grandTotal).toBe(a.grandTotal);
    expect(b.costs.subtotal).toBe(a.costs.subtotal);
  });

  it('a price a quoter is shown is the sum of the parts they are shown', () => {
    const r = resolveQuoteCosts(base);
    expect(r.unitPrice).toBeCloseTo(r.costs.subtotal + r.costs.overhead + r.costs.marginAmount, 9);
  });

  it('the grand total is the unit price times the batch, plus any rush', () => {
    for (const quantity of [1, 5, 50]) {
      const r = resolveQuoteCosts({ ...base, quantity });
      expect(r.grandTotal, `qty ${quantity}`)
        .toBeCloseTo(r.unitPrice * quantity + r.costs.rushPremium, 9);
    }
  });

  it('the itemised breakdown accounts for the subtotal it sits under', () => {
    // The PDF prints these lines beneath the subtotal. If they do not add up,
    // the customer is looking at a document that contradicts itself.
    const r = resolveQuoteCosts(base);
    const sum = r.lineItems.reduce((a, li) => a + li.value, 0);
    expect(sum).toBeCloseTo(r.costs.subtotal, 6);
  });

  it('the QuoteCosts shape that gets persisted preserves every total exactly', () => {
    // Saving maps MachiningCosts onto the QuoteCosts shape. That mapping must be
    // lossless for the four totals, because the PDF reads them back out.
    const r = resolveQuoteCosts(base);
    const mc = r.machiningCosts!;
    expect(r.costs.subtotal).toBe(mc.subtotal);
    expect(r.costs.overhead).toBe(mc.overhead);
    expect(r.costs.marginAmount).toBe(mc.marginAmount);
    expect(r.costs.rushPremium).toBe(mc.rushPremium);
    const parts = r.costs.materialCost + r.costs.laserCost + r.costs.bendCost
      + r.costs.weldCost + r.costs.assemblyCost + r.costs.finishCost;
    expect(parts).toBeCloseTo(r.costs.subtotal, 6);
  });
});

describe('every input a quoter can change reaches the price', () => {
  it('margin moves it — the quantity step must not price at a different one', () => {
    // The defect: StepQuantity hardcoded settings.defaultMargin while Review and
    // the save path used the quoter's markup, so the two screens showed
    // different prices for the same quote.
    const low = resolveQuoteCosts({ ...base, margin: 0.25 });
    const high = resolveQuoteCosts({ ...base, margin: 0.45 });
    expect(high.unitPrice).toBeGreaterThan(low.unitPrice);
  });

  it('secondary operations move it — and are not silently dropped', () => {
    const plating = DEFAULT_SECONDARY_OPS.filter((o) => /plate|anodis/i.test(o.name)).slice(0, 1);
    expect(plating.length, 'no plating op in the catalogue to test with').toBe(1);
    const without = resolveQuoteCosts(base);
    const withOps = resolveQuoteCosts({ ...base, secondaryOps: plating });
    expect(withOps.unitPrice).toBeGreaterThan(without.unitPrice);
    expect(withOps.lineItems.some((li) => li.key === 'secondary')).toBe(true);
    // ...and still add up, which is what stops them being priced but unexplained.
    const sum = withOps.lineItems.reduce((a, li) => a + li.value, 0);
    expect(sum).toBeCloseTo(withOps.costs.subtotal, 6);
  });

  it('quantity moves it, and setup amortises the right way', () => {
    const one = resolveQuoteCosts({ ...base, quantity: 1 });
    const many = resolveQuoteCosts({ ...base, quantity: 100 });
    expect(many.unitPrice).toBeLessThan(one.unitPrice);
  });

  it('rush is charged once on the batch, not folded into the unit price', () => {
    const calm = resolveQuoteCosts({ ...base, quantity: 10 });
    const rush = resolveQuoteCosts({ ...base, quantity: 10, isRush: true });
    expect(rush.costs.rushPremium).toBeGreaterThan(0);
    expect(rush.grandTotal).toBeCloseTo(rush.unitPrice * 10 + rush.costs.rushPremium, 9);
    expect(rush.grandTotal).toBeGreaterThan(calm.grandTotal);
  });
});

describe('what the PDF prints exists in the saved quote', () => {
  it('every cost line carries a driver a customer can be shown', () => {
    const r = resolveQuoteCosts(base);
    for (const li of r.lineItems) {
      expect(li.name, 'a cost line with no name').toBeTruthy();
      expect(li.driver, `"${li.name}" has no driver`).toBeTruthy();
      expect(Number.isFinite(li.value), `"${li.name}" = ${li.value}`).toBe(true);
    }
  });

  it('no total is NaN, at any quantity', () => {
    for (const quantity of [1, 3, 25, 500]) {
      const r = resolveQuoteCosts({ ...base, quantity });
      for (const [k, v] of Object.entries(r.costs)) {
        expect(Number.isFinite(v as number), `qty ${quantity}: costs.${k} = ${v}`).toBe(true);
      }
      expect(Number.isFinite(r.unitPrice)).toBe(true);
      expect(Number.isFinite(r.grandTotal)).toBe(true);
    }
  });
});
