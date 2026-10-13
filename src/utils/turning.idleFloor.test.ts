import { describe, it, expect } from 'vitest';
import { estimateTurningTimes, DEFAULT_TURNING_CONFIG, type TurningProfile } from './turning';
import { calculateMachiningCosts } from './cncEstimator';
import { DEFAULT_TURNING_TOOLS, DEFAULT_SHOP_SETTINGS, DEFAULT_CNC_SETTINGS } from '../constants';
import { materialPropsFor } from './materials';

/**
 * NO OPERATION IS ALL MOVES AND NO WAIT.
 *
 * Every operation on both of Lance's cycle sheets carries at least 10 s of idle
 * (10 on the NTX, 12 on the Mori) where the model's counted moves came to 2-6 s.
 * The floor is the shop's setting; an operation whose counted idle is above it
 * keeps its own figure. Relations only.
 */
const brass = materialPropsFor('Brass CZ121');
const base = { ...DEFAULT_TURNING_CONFIG, toolLibrary: DEFAULT_TURNING_TOOLS, facingAllowanceMm: 2 };
const housing: TurningProfile = {
  odMm: 29.33, lengthMm: 70, boreDiaMm: 11.8, boreDepthMm: 14, grooveCount: 0,
  threadCount: 0, faceCount: 2, crossFeatures: false,
  threads: [{ callout: 'G1/4', pitchMm: 1.337, tapDrillMm: 11.8, depthMm: 12, count: 1 }],
};
const run = (floor?: number) => estimateTurningTimes(housing, brass, 55, { ...base, opIdleFloorSec: floor });

describe('the per-operation idle floor', () => {
  it('is off unless the shop sets it', () => {
    expect(run(undefined).idleSec).toBeCloseTo(run(0).idleSec, 9);
  });

  it('lifts every operation to the floor and leaves cutting alone', () => {
    const t = run(10);
    for (const o of t.opTimes) expect(o.idleSec, o.op).toBeGreaterThanOrEqual(10);
    expect(t.cuttingSec).toBeCloseTo(run(0).cuttingSec, 9);
  });

  it('an operation already above the floor keeps its own idle', () => {
    const none = run(0);
    const high = none.opTimes.reduce((a, o) => Math.max(a, o.idleSec), 0);
    const t = run(high / 2);
    expect(t.opTimes.find((o) => o.idleSec === high)!.idleSec).toBe(high);
  });

  it('the shop default is Lance\'s per-operation average idle, 15 s', () => {
    expect(DEFAULT_CNC_SETTINGS.opIdleFloorSec).toBe(15);
  });

  it('the plan still adds up to the cycle', () => {
    const c = calculateMachiningCosts(
      { isTurned: true, materialName: 'Brass CZ121', volumeCm3: 21, profile: housing, setups: 1, materialPricePerKg: 12 },
      1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    const planSec = c.plan!.setups.reduce((a, s) => a + s.seconds, 0);
    expect(planSec).toBeCloseTo(c.cycleTimeSec, 0);
  });
});
