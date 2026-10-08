import { describe, it, expect } from 'vitest';
import { estimateTurningTimes, DEFAULT_TURNING_CONFIG, type TurningProfile } from './turning';
import { calculateMachiningCosts } from './cncEstimator';
import { DEFAULT_TURNING_TOOLS, DEFAULT_SHOP_SETTINGS } from '../constants';
import { materialPropsFor } from './materials';

/**
 * A BORE AT EACH END IS TWO BORES.
 *
 * The VOC housing carries a G1/4 bore at each end. Lance's sheet times the front
 * end and stops at the part-off; his router has a second operation, "thread and
 * face", for the back. The model charged one end. Assertions are relations.
 */
const brass = materialPropsFor('Brass CZ121');
const cfg = { ...DEFAULT_TURNING_CONFIG, toolLibrary: DEFAULT_TURNING_TOOLS, facingAllowanceMm: 2 };
const g14 = { callout: 'G1/4', pitchMm: 1.337, tapDrillMm: 11.8, depthMm: 12, count: 1 };
const one: TurningProfile = {
  odMm: 29.33, lengthMm: 70, boreDiaMm: 11.8, boreDepthMm: 14, grooveCount: 0,
  threadCount: 0, faceCount: 2, crossFeatures: false, threads: [g14],
};
const two: TurningProfile = { ...one, boreEndCount: 2, threads: [{ ...g14, count: 2 }] };
const t1 = estimateTurningTimes(one, brass, 55, cfg);
const t2 = estimateTurningTimes(two, brass, 55, cfg);
const op = (t: typeof t1, name: string) => t.opTimes.find((o) => o.op === name)!;

describe('both ends of the bore', () => {
  it('boring is done at each end', () => {
    expect(op(t2, 'bore').cuttingSec).toBeCloseTo(2 * op(t1, 'bore').cuttingSec, 9);
    // The bar's own retracts repeat per end; bringing the tool round is paid once.
    expect(op(t2, 'bore').idleSec).toBeGreaterThan(op(t1, 'bore').idleSec);
    expect(op(t2, 'bore').idleSec).toBeLessThan(2 * op(t1, 'bore').idleSec);
  });

  it('so is the thread, and so is its deburr (the bore chamfer at each mouth)', () => {
    expect(op(t2, 'thread').cuttingSec).toBeCloseTo(2 * op(t1, 'thread').cuttingSec, 9);
    expect(op(t2, 'deburr').cuttingSec).toBeGreaterThan(op(t1, 'deburr').cuttingSec);
  });

  it('the drill is one hole through, not one per end', () => {
    expect(op(t2, 'drill').cuttingSec).toBeCloseTo(op(t1, 'drill').cuttingSec, 9);
  });
});

describe('the plan puts the back end in its own operation', () => {
  const price = (p: TurningProfile) => calculateMachiningCosts(
    { isTurned: true, materialName: 'Brass CZ121', volumeCm3: 21, profile: p, setups: 1, materialPricePerKg: 12 },
    1, false, 0.25, DEFAULT_SHOP_SETTINGS);
  const c1 = price(one);
  const c2 = price(two);
  const rows = (c: typeof c1, i: number) => c.plan!.setups[i]?.operations ?? [];
  const cut = (xs: Array<{ cuttingSeconds?: number }>) => xs.reduce((a, o) => a + (o.cuttingSeconds ?? 0), 0);

  it('Op 1\'s boring and threading are the same work as a one-ended part\'s', () => {
    for (const name of ['Boring', 'Threading']) {
      const a = rows(c2, 0).find((o) => o.name === name)!;
      const b = rows(c1, 0).find((o) => o.name === name)!;
      expect(a.cuttingSeconds, name).toBeCloseTo(b.cuttingSeconds!, 6);
    }
  });

  it('Op 2 carries the back end\'s boring and threading', () => {
    expect(c2.plan!.setups[1].name).toMatch(/back end/i);
    expect(rows(c2, 1).map((o) => o.name)).toEqual(['Boring — back end', 'Threading — back end']);
    expect(cut(rows(c2, 1))).toBeGreaterThan(0);
  });

  it('the plan still adds up to the cycle', () => {
    const planSec = c2.plan!.setups.reduce((a, s) => a + s.seconds, 0);
    expect(planSec).toBeCloseTo(c2.cycleTimeSec, 0);
    expect(c1.plan!.setups.length).toBe(1);
  });
});
