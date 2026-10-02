import { describe, it, expect } from 'vitest';
import {
  realisation, normaliseRealisation, partNeedsInterruptedDerate,
  DEFAULT_REALISATION, type RealisationFactors,
} from './realisation';
import { calculateMachiningCosts } from './cncEstimator';
import { DEFAULT_SHOP_SETTINGS } from '../constants';
import type { TurningProfile } from './turning';

/**
 * The realisation stack: what handbook cutting data actually delivers.
 *
 * The assertions are about SHAPE and about the stack staying honest — that it
 * only ever slows a cut, that it touches cutting and not idle, that the
 * conditional factor is genuinely conditional, and that every factor is
 * separately visible. There is deliberately no assertion that the product equals
 * any particular number: a test that pinned 0.409 would turn a defensible
 * default into a constant nobody may question.
 */
const profile: TurningProfile = {
  odMm: 29.3, lengthMm: 70, boreDiaMm: 11.8, boreDepthMm: 14, grooveCount: 4,
  threadCount: 1, faceCount: 2, crossFeatures: false,
};
const price = (r?: Partial<RealisationFactors>) => calculateMachiningCosts(
  { isTurned: true, materialName: 'Brass CZ121', volumeCm3: 21, profile, setups: 1, materialPricePerKg: 12 },
  1, false, 0.25,
  { ...DEFAULT_SHOP_SETTINGS, cnc: { ...DEFAULT_SHOP_SETTINGS.cnc!, realisation: r } },
);

describe('the stack only ever slows a cut', () => {
  it('every default factor is between 0 and 1', () => {
    for (const [name, v] of Object.entries(DEFAULT_REALISATION)) {
      expect(v, name).toBeGreaterThan(0);
      expect(v, name).toBeLessThanOrEqual(1);
    }
  });

  it('the multiplier on cutting time is never below 1', () => {
    expect(realisation().multiplier).toBeGreaterThanOrEqual(1);
    expect(realisation({}, true).multiplier).toBeGreaterThanOrEqual(1);
    // All factors at 1 is "book conditions" — the derate switches itself off.
    const none = realisation({ toolLife: 1, rigidity: 1, oneOffProgram: 1, materialCondition: 1, interruptedCut: 1 }, true);
    expect(none.factor).toBeCloseTo(1, 9);
    expect(none.multiplier).toBeCloseTo(1, 9);
  });

  it('a factor outside the sane range falls back rather than corrupting a price', () => {
    // Settings are persisted and hand-editable; a 0 or a 5 here would otherwise
    // produce an infinite or negative cycle.
    const bad = normaliseRealisation({ toolLife: 0, rigidity: 5, oneOffProgram: NaN } as never);
    expect(bad.toolLife).toBe(DEFAULT_REALISATION.toolLife);
    expect(bad.rigidity).toBe(DEFAULT_REALISATION.rigidity);
    expect(bad.oneOffProgram).toBe(DEFAULT_REALISATION.oneOffProgram);
    expect(Number.isFinite(realisation({ toolLife: 0 } as never).multiplier)).toBe(true);
  });
});

describe('the interrupted-cut factor is genuinely conditional', () => {
  it('a plain solid bar part does not pay it', () => {
    expect(partNeedsInterruptedDerate({ odMm: 29.3, boreDiaMm: 11.8, crossFeatureCount: 0 })).toBe(false);
    expect(realisation(undefined, false).interruptedApplied).toBe(false);
    // ...and the product is correspondingly lighter.
    expect(realisation(undefined, false).factor).toBeGreaterThan(realisation(undefined, true).factor);
  });

  it('a hole through a turned surface makes the cut interrupted', () => {
    expect(partNeedsInterruptedDerate({ odMm: 29.3, boreDiaMm: 11.8, crossFeatureCount: 2 })).toBe(true);
  });

  it('a thin wall cannot be held rigid', () => {
    // Bore wider than 70% of the OD: a wall under 15% of the diameter.
    expect(partNeedsInterruptedDerate({ odMm: 30, boreDiaMm: 25 })).toBe(true);
    expect(partNeedsInterruptedDerate({ odMm: 30, boreDiaMm: 10 })).toBe(false);
  });

  it('grooves are NOT a signal, because nearly every turned part has one', () => {
    // If they were, the factor would apply to everything, which is the same as
    // folding it into the other four and calling it conditional.
    expect(partNeedsInterruptedDerate({ odMm: 29.3, boreDiaMm: 0, crossFeatureCount: 0 })).toBe(false);
  });
});

describe('it reaches the price, on cutting only', () => {
  it('a heavier derate makes the part cost more', () => {
    const light = price({ toolLife: 1, rigidity: 1, oneOffProgram: 1, materialCondition: 1 });
    const heavy = price({ toolLife: 0.5, rigidity: 0.7, oneOffProgram: 0.7, materialCondition: 0.8 });
    expect(heavy.cycleTimeSec).toBeGreaterThan(light.cycleTimeSec);
    expect(heavy.machineCost).toBeGreaterThan(light.machineCost);
  });

  it('it moves CUTTING seconds and leaves IDLE alone', () => {
    const light = price({ toolLife: 1, rigidity: 1, oneOffProgram: 1, materialCondition: 1 });
    const heavy = price({ toolLife: 0.5, rigidity: 0.7, oneOffProgram: 0.7, materialCondition: 0.8 });
    const sum = (c: typeof light, k: 'cuttingSeconds' | 'idleSeconds') =>
      c.plan!.setups.flatMap((s) => s.operations).reduce((a, o) => a + (o[k] ?? 0), 0);
    expect(sum(heavy, 'cuttingSeconds')).toBeGreaterThan(sum(light, 'cuttingSeconds') * 1.5);
    // A rapid, a turret index and a spindle settling are the machine's, and are
    // already counted move by move. Derating them here would charge twice.
    expect(sum(heavy, 'idleSeconds')).toBeCloseTo(sum(light, 'idleSeconds'), 6);
  });

  it('the breakdown still sums to the subtotal with the derate in', () => {
    const c = price();
    expect(c.lineItems.reduce((a, li) => a + li.value, 0)).toBeCloseTo(c.subtotal, 6);
  });

  it('the quote states both numbers, and names every factor it applied', () => {
    const note = price().lineItems.find((li) => li.key === 'realisation')!;
    expect(note.value).toBe(0); // explanatory: the derate is inside the rows above
    expect(note.driver).toMatch(/theoretical .* → .* realised/);
    for (const f of realisation(undefined, false).applied) {
      expect(note.driver).toContain(f.name);
    }
    // This part is not an interrupted cut, so the quote says the factor was held back.
    expect(note.driver).toMatch(/not applied/);
  });

  it('plan rows still reconcile: cutting + idle = the row, rows = the cycle', () => {
    const c = price();
    const ops = c.plan!.setups.flatMap((s) => s.operations);
    for (const o of ops) {
      expect((o.cuttingSeconds ?? 0) + (o.idleSeconds ?? 0)).toBeCloseTo(o.seconds, 6);
    }
    expect(c.plan!.totalCost).toBeCloseTo(c.machineCost, 6);
  });
});
