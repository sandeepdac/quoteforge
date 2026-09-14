import { describe, it, expect } from 'vitest';
import { estimateTurningTimes, opApproachSec, DEFAULT_TURNING_CONFIG, type TurningProfile } from './turning';
import { DEFAULT_TURNING_TOOLS } from '../constants';
import { materialPropsFor } from './materials';

const cfg = { ...DEFAULT_TURNING_CONFIG, toolLibrary: DEFAULT_TURNING_TOOLS, facingAllowanceMm: 2 };

/**
 * THE RULE, stated once so it can be checked rather than eyeballed.
 *
 * Nothing happens on a lathe in under a couple of seconds. Whatever an
 * operation removes — a 2 mm facing skim, a 0.8 mm groove, a finish bore — the
 * slide still travels to the start point, the spindle still reaches and holds
 * speed, the tool still feeds through a clearance gap, and it still retracts.
 * An operation timed at 0.7 s is not a fast operation, it is an unmodelled one.
 */
const FLOOR_SEC = 2;

const cases: Array<[string, TurningProfile, string]> = [
  ['VOC housing (⌀29 x 70 brass, ⌀11.8 bore, 4 grooves)', {
    odMm: 29.3, lengthMm: 70, boreDiaMm: 11.8, boreDepthMm: 14, grooveCount: 4,
    threadCount: 0, faceCount: 2, crossFeatures: false, barDiameterMm: 36,
  }, 'Brass CZ121'],
  ['collet block (⌀8 x 6 bronze, ⌀5 bore)', {
    odMm: 8.086, lengthMm: 6.095, boreDiaMm: 5, boreDepthMm: 5, grooveCount: 0,
    threadCount: 0, faceCount: 2, crossFeatures: false, barDiameterMm: 14,
  }, 'Bronze'],
  ['plain stainless shaft, nothing on it', {
    odMm: 12, lengthMm: 40, boreDiaMm: 0, boreDepthMm: 0, grooveCount: 0,
    threadCount: 0, faceCount: 1, crossFeatures: false, barDiameterMm: 16,
  }, 'Stainless 316'],
];

describe('no operation costs less than a real operation', () => {
  for (const [name, profile, material] of cases) {
    it(`${name}: every non-zero operation clears ${FLOOR_SEC}s`, () => {
      const t = estimateTurningTimes(profile, materialPropsFor(material), 30, cfg);
      const ops: Array<[string, number]> = [
        ['facing', t.facingSec], ['roughing', t.roughSec], ['finishing', t.finishSec],
        ['boring', t.boreSec], ['grooving', t.grooveSec], ['parting', t.partingSec],
      ];
      for (const [op, sec] of ops) {
        if (sec > 0) expect(sec, `${op} = ${sec.toFixed(2)}s`).toBeGreaterThanOrEqual(FLOOR_SEC);
      }
    });
  }

  it('the floor comes from the approach, not from a clamp on the output', () => {
    // A minimum time bolted onto the answer would satisfy the tests above and
    // teach the model nothing. This asserts the seconds are BUILT from a
    // physical move: 120 mm of rapid, a spindle settling, 2 mm at feed.
    expect(opApproachSec(1000)).toBeGreaterThan(FLOOR_SEC);
    // A finer feed spends longer in the clearance gap — a clamp could not do this.
    expect(opApproachSec(50)).toBeGreaterThan(opApproachSec(5000));
  });

  it('a part with four grooves pays four approaches, not one', () => {
    const [, base, mat] = cases[0];
    const m = materialPropsFor(mat);
    const one = estimateTurningTimes({ ...base, grooveCount: 1 }, m, 30, cfg);
    const four = estimateTurningTimes({ ...base, grooveCount: 4 }, m, 30, cfg);
    expect(four.grooveSec).toBeCloseTo(one.grooveSec * 4, 1);
  });

  it('facing two ends costs about twice facing one', () => {
    const [, base, mat] = cases[0];
    const m = materialPropsFor(mat);
    const one = estimateTurningTimes({ ...base, faceCount: 1 }, m, 30, cfg);
    const two = estimateTurningTimes({ ...base, faceCount: 2 }, m, 30, cfg);
    expect(two.facingSec).toBeCloseTo(one.facingSec * 2, 1);
  });

  it('roughing more stock off takes more passes and more return strokes', () => {
    const [, base, mat] = cases[0];
    const m = materialPropsFor(mat);
    const thin = estimateTurningTimes({ ...base, barDiameterMm: 32 }, m, 30, cfg);
    const thick = estimateTurningTimes({ ...base, barDiameterMm: 60 }, m, 30, cfg);
    expect(thick.roughSec).toBeGreaterThan(thin.roughSec);
  });
});
