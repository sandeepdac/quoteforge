import { describe, it, expect } from 'vitest';
import { estimateTurningTimes, opApproachSec, repositionSec, DEFAULT_TURNING_CONFIG, type TurningProfile } from './turning';
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

  it('a part with four grooves pays four PLUNGES, and one approach', () => {
    // This assertion used to demand four x the single-groove time, which encoded
    // an over-charge: it made every groove fetch the tool again. The plunges
    // scale; the approach does not.
    const [, base, mat] = cases[0];
    const m = materialPropsFor(mat);
    const one = estimateTurningTimes({ ...base, grooveCount: 1 }, m, 30, cfg);
    const four = estimateTurningTimes({ ...base, grooveCount: 4 }, m, 30, cfg);
    expect(four.grooveSec).toBeGreaterThan(one.grooveSec);
    expect(four.grooveSec).toBeLessThan(one.grooveSec * 4);
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

describe('a hole is spotted before it is drilled', () => {
  it('drilling a bore also spots it', () => {
    const [, base, mat] = cases[0];
    const m = materialPropsFor(mat);
    const t = estimateTurningTimes(base, m, 30, cfg);
    expect(t.drillSec).toBeGreaterThan(0);
    expect(t.spotSec).toBeGreaterThan(0);
  });

  it('a solid part with no bore spots nothing', () => {
    const [, base, mat] = cases[2];
    const t = estimateTurningTimes(base, materialPropsFor(mat), 30, cfg);
    expect(t.spotSec).toBe(0);
    expect(t.drillSec).toBe(0);
  });

  it('the spot is counted in cutting time, not lost', () => {
    const [, base, mat] = cases[0];
    const t = estimateTurningTimes(base, materialPropsFor(mat), 30, cfg);
    const named = t.spotSec + t.facingSec + t.roughSec + t.finishSec + t.drillSec
      + t.boreSec + t.grooveSec + t.threadSec + t.partingSec + t.crossSec + t.tapSec;
    expect(named).toBeCloseTo(t.cuttingSec, 6);
  });

  it('the spot drill is a DIFFERENT tool from the drill, so it costs a change', () => {
    const [, base, mat] = cases[0];
    const t = estimateTurningTimes(base, materialPropsFor(mat), 30, cfg);
    const ids = new Set(t.toolAssignments.map((a) => a.identity));
    expect(t.toolAssignments.some((a) => a.op === 'spot')).toBe(true);
    expect(t.toolAssignments.some((a) => a.op === 'drill')).toBe(true);
    expect(ids.size).toBeGreaterThan(1);
  });
});

describe('the plan finds each row its own tool', () => {
  it('pairs by operation, not by position in a parallel array', async () => {
    // The bug this pins: plan rows were matched to tools by ARRAY INDEX into
    // toolAssignments. Inserting one operation misaligned every row after it and
    // read off the end of the array — a crash, and before that, silently wrong
    // tool names. Adding an operation must not be able to do that again.
    const { calculateMachiningCosts } = await import('./cncEstimator');
    const { DEFAULT_SHOP_SETTINGS } = await import('../constants');
    const [, base] = cases[0];
    const c = calculateMachiningCosts(
      { isTurned: true, materialName: 'Brass CZ121', volumeCm3: 20, profile: base, setups: 1, materialPricePerKg: 12 },
      1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    const rows = c.plan!.setups.flatMap((s) => s.operations);
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) {
      expect(r.op, `row "${r.name}" carries no op`).toBeTruthy();
      expect(r.tool, `row "${r.name}" has no tool`).toBeTruthy();
    }
    // Every row's tool name is a real one, not an off-the-end undefined.
    expect(rows.every((r) => typeof r.tool === 'string' && r.tool.length > 0)).toBe(true);
  });
});

describe('every plan row names the tool that actually runs it', () => {
  it('spot drilling is not attributed to the drill', async () => {
    // Caught in an end-to-end run: the PDF printed
    // "Spot drilling - T0202 - Carbide drill (pilot / through)". The row looked
    // its tool up under 'drill' rather than 'spot', so the quote told the floor
    // to centre a hole with the through drill.
    const { calculateMachiningCosts } = await import('./cncEstimator');
    const { DEFAULT_SHOP_SETTINGS } = await import('../constants');
    const [, base] = cases[0];
    const c = calculateMachiningCosts(
      { isTurned: true, materialName: 'Brass CZ121', volumeCm3: 20, profile: base, setups: 1, materialPricePerKg: 12 },
      1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    const rows = c.plan!.setups.flatMap((s) => s.operations);
    const spot = rows.find((r) => r.op === 'spot');
    const drill = rows.find((r) => r.op === 'drill');
    expect(spot, 'no spot row in the plan').toBeTruthy();
    expect(drill, 'no drill row in the plan').toBeTruthy();
    expect(spot!.tool).not.toBe(drill!.tool);
    expect(spot!.tool.toLowerCase()).toMatch(/spot|centre|center/);
  });
});

describe('a tool already in the cut is not fetched again', () => {
  const [, base, mat] = cases[0];
  const m = () => materialPropsFor(mat);

  it('the FIRST groove pays a full approach and the rest pay a hop', () => {
    // Four grooves used to be four full approaches — 120 mm of rapid and a 1.5 s
    // spindle settle each — when after the first the tool is at the diameter and
    // the spindle is at speed. What happens between grooves is a short index
    // along Z, and charging more than that is inventing work.
    const one = estimateTurningTimes({ ...base, grooveCount: 1 }, m(), 30, cfg);
    const four = estimateTurningTimes({ ...base, grooveCount: 4 }, m(), 30, cfg);
    const perExtra = (four.grooveSec - one.grooveSec) / 3;
    expect(perExtra).toBeLessThan(one.grooveSec);          // cheaper than the first
    expect(four.grooveSec).toBeGreaterThan(one.grooveSec); // but never free
  });

  it('more grooves still cost more, monotonically', () => {
    let prev = 0;
    for (const grooveCount of [1, 2, 4, 8]) {
      const t = estimateTurningTimes({ ...base, grooveCount }, m(), 30, cfg);
      expect(t.grooveSec, `${grooveCount} grooves`).toBeGreaterThan(prev);
      prev = t.grooveSec;
    }
  });

  it('two FACES are not treated as a repeat — they are at opposite ends', () => {
    // The tool cannot hop 25 mm from one end of the part to the other: the
    // second face is reached by re-gripping or by the sub-spindle.
    const one = estimateTurningTimes({ ...base, faceCount: 1 }, m(), 30, cfg);
    const two = estimateTurningTimes({ ...base, faceCount: 2 }, m(), 30, cfg);
    expect(two.facingSec).toBeCloseTo(one.facingSec * 2, 1);
  });

  it('a repeat hop is shorter than an approach but longer than nothing', () => {
    expect(repositionSec(1000)).toBeLessThan(opApproachSec(1000));
    expect(repositionSec(1000)).toBeGreaterThan(0);
  });
});
