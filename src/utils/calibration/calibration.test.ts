import { describe, it, expect } from 'vitest';
import {
  QUOTED_PARTS, totalSetupMin, cycleMinPerPart, machiningOps,
  impliedRatePerHour, solveSetupAndCycle,
} from './quotes';
import { scoreParts } from './score';
import { flatRatePerHour, SETUP_CHARACTER_MIN, SECOND_OP_SETUP_FRACTION, MEASURED, MEASURED_V4 } from './candidates';

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

describe('candidate models, compared', () => {
  // Rebuilds every candidate from the evidence so the recorded scores in
  // candidates.ts cannot drift away from what the code actually produces.
  const build = (which: 'v0' | 'v1' | 'v2' | 'v3') => {
    const rows: any[] = [];
    for (const p of QUOTED_PARTS) {
      const ops = machiningOps(p).length;
      const rate = flatRatePerHour(ops);
      for (const q of p.pricing) {
        const v0 = V0.find((r) => r.drawing === p.drawing && r.qty === q.qty)
          ?? V0.find((r) => r.drawing === p.drawing)!;
        const externals = q.materialCost + q.subconCost + q.miscCost;
        const price = (proc: number) => (proc + externals) / (1 - q.marginPercent / 100);
        if (which === 'v0') { rows.push({ ...v0, qty: q.qty }); continue; }
        const setup = which === 'v3' ? totalSetupMin(p)
          : which === 'v2'
            ? machiningOps(p).reduce((a, o, i) => a + (SETUP_CHARACTER_MIN[o.centre] ?? 240)
                * (i === 0 ? 1 : SECOND_OP_SETUP_FRACTION), 0)
            : v0.modelSetupMin;
        const cycle = which === 'v3' ? cycleMinPerPart(p) : v0.modelCycleMin;
        rows.push({
          drawing: p.drawing, qty: q.qty, modelSetupMin: setup, modelCycleMin: cycle,
          modelPrice: price((setup / q.qty + cycle) * rate / 60),
        });
      }
    }
    return rows;
  };

  it('the ORACLE reproduces every quoted price, so the pricing structure is right', () => {
    const s = scoreParts(build('v3'), 'v3');
    expect(s.centralRatio).toBeCloseTo(1.0, 1);
    expect(s.spread).toBeLessThan(1.2);
    // The consequence: every remaining error in the shipped engine is TIME.
    for (const p of s.parts) expect(Math.abs((p.priceRatio ?? 0) - 1)).toBeLessThan(0.05);
  });

  it('the flat rate alone does not fix it — rate and time must move together', () => {
    const s = scoreParts(build('v1'), 'v1');
    expect(s.spread).toBeLessThan(MEASURED.v0.spread);   // helps
    expect(s.spread).toBeGreaterThan(MEASURED.v2.spread); // but nowhere near enough
    expect(s.systematic).toBe(true);                      // still a missing term
  });

  it('machine setup-character beats the incumbent on SPREAD, which is the test', () => {
    const s = scoreParts(build('v2'), 'v2');
    const v0 = scoreParts(build('v0'), 'v0');
    expect(s.spread).toBeLessThan(v0.spread / 2.5);
    // And the errors stop all pointing one way: no single term is missing now.
    expect(s.systematic).toBe(false);
  });
});

/**
 * The bundling trap. Three findings about Lance's pricing are all true, and
 * combining them is worse than adopting the best one alone. This test exists so
 * that the next person to notice "our rate is £75/hr and his is £30" cannot
 * quietly bundle the fix in without re-measuring.
 */
describe('measured on our own machine choice, not Lance\'s', () => {
  const M = MEASURED_V4;

  it('flattening the rate makes the answer WORSE, on its own', () => {
    expect(M.flatRateOnly.spread).toBeGreaterThan(M.shipped.spread);
  });

  it('route setup is the only ingredient that earns its place', () => {
    expect(M.routeSetupOnly.spread).toBeLessThan(M.shipped.spread / 1.8);
    // And it is the one that stops every part erring the same way.
    expect(M.routeSetupOnly.systematic).toBe(false);
  });

  it('all three together score WORSE than route setup alone', () => {
    expect(M.allThree.spread).toBeGreaterThan(M.routeSetupOnly.spread);
    for (const k of ['flatRateOnly', 'rateUpliftOnly', 'allThree'] as const) {
      expect(M[k].spread).toBeGreaterThan(M.routeSetupOnly.spread);
    }
  });
});
