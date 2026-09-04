import { describe, it, expect } from 'vitest';
import {
  QUOTED_PARTS, totalSetupMin, cycleMinPerPart, machiningOps,
  impliedRatePerHour, solveSetupAndCycle,
} from './quotes';
import { scoreParts } from './score';

// The shipped engine, measured against Lance's quotes at his own quantities.
// This is the incumbent. A new model has to beat it on SPREAD to be worth having.
const V0 = [
  { drawing: '031169-A', qty: 1, modelSetupMin: 56, modelCycleMin: 1.13, modelPrice: 108.81 },
  { drawing: '029068', qty: 6, modelSetupMin: 73, modelCycleMin: 0.60, modelPrice: 28.50 },
  { drawing: 'OLY014_01921-A', qty: 15, modelSetupMin: 123, modelCycleMin: 3.02, modelPrice: 22.43 },
  { drawing: 'NAUT_01695-C', qty: 100, modelSetupMin: 50, modelCycleMin: 0.70, modelPrice: 5.97 },
  { drawing: 'OLY014_01297-A', qty: 68, modelSetupMin: 72, modelCycleMin: 1.42, modelPrice: 6.99 },
  { drawing: 'OLY014_01297-A', qty: 102, modelSetupMin: 72, modelCycleMin: 1.42, modelPrice: 6.45 },
  { drawing: '032736-01', qty: 10, modelSetupMin: 219, modelCycleMin: 4.18, modelPrice: 51.42 },
  { drawing: '035838-A', qty: 15, modelSetupMin: 123, modelCycleMin: 2.58, modelPrice: 22.03 },
];

describe('the evidence is transcribed correctly', () => {
  it('every part has a router and at least one quoted quantity', () => {
    expect(QUOTED_PARTS.length).toBe(7);
    for (const p of QUOTED_PARTS) {
      expect(p.router.length).toBeGreaterThan(0);
      expect(p.pricing.length).toBeGreaterThan(0);
    }
  });

  it("each part's cost lines add up to the total cost he states", () => {
    for (const p of QUOTED_PARTS) {
      for (const q of p.pricing) {
        const sum = q.processCost + q.materialCost + q.subconCost + q.miscCost;
        expect(Math.abs(sum - q.totalCost)).toBeLessThan(0.02);
      }
    }
  });

  it('quoted price is total cost plus the stated margin, on selling price', () => {
    for (const p of QUOTED_PARTS) {
      for (const q of p.pricing) {
        const impliedMargin = ((q.quotedPrice - q.totalCost) / q.quotedPrice) * 100;
        expect(Math.abs(impliedMargin - q.marginPercent)).toBeLessThan(0.6);
      }
    }
  });
});

describe('the flat-rate observation', () => {
  // Not a fit. Four single-machining-op parts land on the same rate to the penny,
  // and the two-op parts land on a different, higher one. If a future quote
  // breaks this, the rate model is what changes — and this test says so first.
  it('single-machining-op parts price at £30/hr', () => {
    const single = QUOTED_PARTS.filter((p) => machiningOps(p).length === 1);
    expect(single.length).toBeGreaterThanOrEqual(3);
    for (const p of single) {
      for (let i = 0; i < p.pricing.length; i++) {
        expect(impliedRatePerHour(p, i)).toBeCloseTo(30.0, 1);
      }
    }
  });

  it('two-machining-op parts price higher, and consistently so', () => {
    const two = QUOTED_PARTS.filter((p) => machiningOps(p).length === 2);
    const rates = two.map((p) => impliedRatePerHour(p, 0));
    expect(rates.length).toBe(4);
    for (const r of rates) {
      expect(r).toBeGreaterThan(35);
      expect(r).toBeLessThan(41);
    }
  });

  it('the two-quantity part SOLVES to the same rate, rather than being fitted to it', () => {
    const dog = QUOTED_PARTS.find((p) => p.drawing === 'OLY014_01297-A')!;
    const solved = solveSetupAndCycle(dog)!;
    // Setup and cycle come out independently; both land on £30/hr.
    expect((solved.setupPerBatch * 60) / totalSetupMin(dog)).toBeCloseTo(30, 0);
    expect((solved.cyclePerPart * 60) / cycleMinPerPart(dog)).toBeCloseTo(30, 0);
  });
});

describe('the incumbent model, so a replacement has something to beat', () => {
  const s = scoreParts(V0, 'v0-current');

  it('quotes about a third of what the shop charges', () => {
    expect(s.centralRatio).toBeGreaterThan(0.30);
    expect(s.centralRatio).toBeLessThan(0.40);
  });

  it('errs the same way on every part, so a term is missing rather than noisy', () => {
    expect(s.systematic).toBe(true);
  });

  it('SPREAD is the number to beat, and a multiplier cannot touch it', () => {
    // ~7.8x between the worst and best part. Scaling every output by any
    // constant leaves this untouched: it is a ratio of ratios. So "multiply
    // setup by 3.5" would fix the average and change nothing that matters.
    expect(s.spread).toBeGreaterThan(7);
    const scaled = scoreParts(V0.map((r) => ({ ...r, modelPrice: (r.modelPrice ?? 0) * 2.9 })), 'v0 x2.9');
    expect(scaled.centralRatio).toBeCloseTo(1.0, 1);   // average now looks right...
    expect(scaled.spread).toBeCloseTo(s.spread, 5);    // ...and nothing improved
  });
});
