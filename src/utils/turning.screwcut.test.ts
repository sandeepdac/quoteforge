import { describe, it, expect } from 'vitest';
import {
  estimateTurningTimes, DEFAULT_TURNING_CONFIG, isScrewcutOnLathe, hostHoleFor,
  SCREWCUT_MIN_MAJOR_MM, type TurningProfile,
} from './turning';
import { threadFromCallout } from './drilling';
import { DEFAULT_TURNING_TOOLS } from '../constants';
import { materialPropsFor } from './materials';

/**
 * A coaxial pipe thread on a lathe is screwcut, not tapped.
 *
 * The evidence is Turncircuit's own sheet for the VOC housing: "screw cut
 * internal G1/4 — SNVRC10U-5LK 5LKIR 19 BSPT", then "deburr thread" with the
 * same tool. The assertions are about WHICH operation a thread becomes and
 * that the bookkeeping follows it — not about matching the sheet's seconds,
 * which no derivable speed reproduces (see the commit for this change).
 */
const brass = materialPropsFor('Brass CZ121');
const cfg = { ...DEFAULT_TURNING_CONFIG, toolLibrary: DEFAULT_TURNING_TOOLS, facingAllowanceMm: 2 };
const bore = [{ diameterMm: 11.8, depthMm: 14 }];
const g14 = threadFromCallout('G1/4', 23.6)!; // the app's unknown-depth default: 2 x tap drill

const housing: TurningProfile = {
  odMm: 29.3, lengthMm: 70, boreDiaMm: 11.8, boreDepthMm: 14, grooveCount: 4,
  threadCount: 0, faceCount: 2, crossFeatures: false, barDiameterMm: 36,
  additionalBores: [{ diameterMm: 10, depthMm: 40.9 }],
};

describe('which threads a lathe screwcuts', () => {
  it('a G1/4 in a coaxial bore is screwcut', () => {
    expect(isScrewcutOnLathe(g14, bore)).toBe(true);
  });

  it('a small metric thread in a coaxial bore is tapped', () => {
    const m6 = threadFromCallout('M6', 10)!;
    expect(isScrewcutOnLathe(m6, [{ diameterMm: m6.tapDrillMm, depthMm: 12 }])).toBe(false);
  });

  it('a large metric thread in a coaxial bore is screwcut', () => {
    const m12 = threadFromCallout('M12', 15)!;
    // Exactly at the changeover counts as screwcut.
    expect(SCREWCUT_MIN_MAJOR_MM).toBeLessThanOrEqual(12);
    expect(isScrewcutOnLathe(m12, [{ diameterMm: m12.tapDrillMm, depthMm: 20 }])).toBe(true);
  });

  it('a thread NOT on the turning axis is tapped, whatever its family', () => {
    // No coaxial hole of its tap drill: it is in an off-axis hole, which a
    // driven tool cuts, and a driven tool taps.
    expect(hostHoleFor(g14, [{ diameterMm: 6, depthMm: 10 }])).toBeUndefined();
    expect(isScrewcutOnLathe(g14, [{ diameterMm: 6, depthMm: 10 }])).toBe(false);
  });
});

describe('the bookkeeping follows the operation', () => {
  const tapped = estimateTurningTimes({ ...housing, threads: [threadFromCallout('M6', 10)!] }, brass, 55, cfg);
  const screwcut = estimateTurningTimes({ ...housing, threads: [g14] }, brass, 55, cfg);
  const op = (t: typeof tapped, name: string) => t.opTimes.find((o) => o.op === name);

  it('a screwcut thread is timed as threading, and is not tapped as well', () => {
    expect(op(screwcut, 'thread')?.cuttingSec ?? 0).toBeGreaterThan(0);
    expect(op(screwcut, 'tap')).toBeUndefined();
    expect(screwcut.screwcutCallouts).toEqual(['G1/4']);
  });

  it('a tapped thread is still tapped', () => {
    expect(op(tapped, 'tap')?.cuttingSec ?? 0).toBeGreaterThan(0);
    expect(op(tapped, 'thread')).toBeUndefined();
    expect(tapped.screwcutCallouts).toEqual([]);
  });

  it('an internal thread is no longer than the hole it is in', () => {
    // The app's unknown-depth default is twice the tap drill — 23.6 mm for a
    // G1/4 — in a bore 14 mm deep. Cut at the full 23.6 the thread would run
    // out of the bottom of its own hole.
    const short = estimateTurningTimes({ ...housing, threads: [{ ...g14, depthMm: 14 }] }, brass, 55, cfg);
    expect(op(screwcut, 'thread')!.cuttingSec).toBeCloseTo(op(short, 'thread')!.cuttingSec, 9);
  });

  it('a screwcut thread is deburred along its helix, not with a chamfer at the mouth', () => {
    // The deburr row's cutting time includes a pass the length of the thread
    // at threading feed, which is far more than a 0.3 mm chamfer.
    const bare = estimateTurningTimes(housing, brass, 55, cfg);
    const extra = op(screwcut, 'deburr')!.cuttingSec - op(bare, 'deburr')!.cuttingSec;
    const onePass = op(screwcut, 'thread')!.cuttingSec / 10; // G1/4: 9 infeeds + spring pass
    expect(extra).toBeCloseTo(onePass, 6);
  });
});
