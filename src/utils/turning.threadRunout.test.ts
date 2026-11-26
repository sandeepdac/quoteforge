import { describe, it, expect } from 'vitest';
import {
  estimateTurningTimes, DEFAULT_TURNING_CONFIG, threadInShoulder, threadRunoutRpmCap,
  threadServoLagMm, THREAD_RUNOUT_PITCHES, type TurningProfile,
} from './turning';
import { DEFAULT_TURNING_TOOLS } from '../constants';
import { materialPropsFor } from './materials';

/**
 * A SCREWCUT THREAD HAS TO START AND STOP.
 *
 * The Z axis lags the spindle at both ends of every pass (Fanuc: δ2 = n·L/1800
 * at the end, δ1 = 3.605·δ2 at the start). A thread that ends at a shoulder has
 * only its run-out to stop in, which caps the speed. Relations, not seconds.
 */
const brass = materialPropsFor('Brass CZ121');
const cfg = { ...DEFAULT_TURNING_CONFIG, toolLibrary: DEFAULT_TURNING_TOOLS, facingAllowanceMm: 2 };
const g14 = { callout: 'G1/4', pitchMm: 1.337, tapDrillMm: 11.8, depthMm: 14, count: 1 };
const part = (boreDepthMm: number): TurningProfile => ({
  odMm: 29.3, lengthMm: 70, boreDiaMm: 11.8, boreDepthMm, grooveCount: 0,
  threadCount: 0, faceCount: 2, crossFeatures: false, threads: [{ ...g14, depthMm: boreDepthMm }],
});
const thread = (p: TurningProfile) => estimateTurningTimes(p, brass, 55, cfg).opTimes.find((o) => o.op === 'thread')!;

describe('the servo lag at each end of a pass', () => {
  it('the start lag is 3.605 times the end lag, and both grow with speed and lead', () => {
    const a = threadServoLagMm(1.5, 1000);
    expect(a.endMm).toBeCloseTo(1500 / 1800, 9);
    expect(a.startMm).toBeCloseTo(3.605 * a.endMm, 9);
    expect(threadServoLagMm(1.5, 2000).endMm).toBeCloseTo(2 * a.endMm, 9);
  });

  it('the run-out sets the top speed: the axis must stop inside it', () => {
    const cap = threadRunoutRpmCap(1.337, 2);
    expect(threadServoLagMm(1.337, cap).endMm).toBeCloseTo(2, 9);
    expect(threadRunoutRpmCap(1.337, Infinity)).toBe(Infinity);
  });
});

describe('a thread in a hole that ends at a shoulder', () => {
  it('stops a run-out short of the shoulder', () => {
    const r = threadInShoulder(1.337, 14, 14, 70);
    expect(r.runoutMm).toBeCloseTo(THREAD_RUNOUT_PITCHES * 1.337, 9);
    expect(r.lengthMm).toBeCloseTo(14 - THREAD_RUNOUT_PITCHES * 1.337, 9);
  });

  it('a callout already short of the shoulder keeps its own length and the extra room', () => {
    const r = threadInShoulder(1.337, 10, 14, 70);
    expect(r.lengthMm).toBe(10);
    expect(r.runoutMm).toBeCloseTo(4, 9);
  });

  it('a hole through the part runs out into air: full depth, no speed cap', () => {
    const r = threadInShoulder(1.337, 70, 70, 70);
    expect(r.lengthMm).toBe(70);
    expect(r.runoutMm).toBe(Infinity);
  });

  it('a tight run-out costs time even though less thread is cut', () => {
    // Same 14 mm hole; the shoulder version cuts 12 mm but at a capped speed.
    const blind = thread(part(14));
    const open = estimateTurningTimes({ ...part(14), lengthMm: 14.5 }, brass, 55, cfg)
      .opTimes.find((o) => o.op === 'thread')!;
    expect(blind.cuttingSec).toBeGreaterThan(open.cuttingSec * (12 / 14));
  });

  it('every pass pays the start and stop lag as feed travel in air', () => {
    // Doubling the thread length does not double the idle: the lag is per pass.
    const short = thread(part(14));
    const long = thread(part(28));
    expect(long.idleSec).toBeLessThan(short.idleSec * 2);
    expect(short.idleSec).toBeGreaterThan(0);
  });
});
