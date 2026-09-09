import { describe, it, expect } from 'vitest';
import { estimateTurningTimes, opOverheadSec, DEFAULT_TURNING_CONFIG, TurningProfile } from './turning';
import { materialPropsFor } from './materials';

const brass = materialPropsFor('Brass CZ121');

const base: TurningProfile = {
  odMm: 29.3, lengthMm: 70, boreDiaMm: 11.8, boreDepthMm: 14,
  grooveCount: 0, threadCount: 0, faceCount: 2, crossFeatures: false,
  barDiameterMm: 36,
};

describe('no turning operation costs one second', () => {
  // THE COMPLAINT THIS PINS. Facing a ⌀36 bar came out at 2.9 s, boring at 1.4 s,
  // drilling at 1.7 s — because every lathe op was timed as a single ideal pass
  // with the tool already at the cut. Drilling and off-axis work already carried
  // positioning, clearance and settle; the lathe ops carried nothing at all.
  const t = estimateTurningTimes(base, brass, 55, DEFAULT_TURNING_CONFIG);

  it('facing two ends takes longer than the four seconds it used to', () => {
    expect(t.facingSec).toBeGreaterThan(10);
  });

  it('boring a hole to size is not a one-second job', () => {
    expect(t.boreSec).toBeGreaterThan(5);
  });

  it('parting off carries its own approach', () => {
    expect(t.partingSec).toBeGreaterThan(4);
  });

  it('every operation pays index, rapid, settle and a clearance feed', () => {
    // ~5 s on a normal lathe. The exact figure is a shop number that can be
    // argued with; what cannot be argued with is that it is not zero.
    expect(opOverheadSec(200)).toBeGreaterThan(3);
    expect(opOverheadSec(200)).toBeLessThan(10);
  });

  it('a slower feed makes the clearance approach longer, not shorter', () => {
    expect(opOverheadSec(20)).toBeGreaterThan(opOverheadSec(2000));
  });
});

describe('features cost per feature, not per part', () => {
  it('four grooves cost about four times one groove', () => {
    const one = estimateTurningTimes({ ...base, grooveCount: 1 }, brass, 55, DEFAULT_TURNING_CONFIG);
    const four = estimateTurningTimes({ ...base, grooveCount: 4 }, brass, 55, DEFAULT_TURNING_CONFIG);
    const perGroove = (four.grooveSec - one.grooveSec) / 3;
    expect(perGroove).toBeCloseTo(one.grooveSec, 1);
    expect(one.grooveSec).toBeGreaterThan(4); // each is its own approach and plunge
  });

  it('a stepped part finishes slower than a plain shaft of the same length', () => {
    // Each diameter is its own pass, shoulder and chamfer. Timing the whole
    // profile as one pass charged a three-diameter register as a plain bar.
    const plain = estimateTurningTimes({ ...base, turnedStepCount: 1 }, brass, 55, DEFAULT_TURNING_CONFIG);
    const stepped = estimateTurningTimes({ ...base, turnedStepCount: 3 }, brass, 55, DEFAULT_TURNING_CONFIG);
    expect(stepped.finishSec).toBeGreaterThan(plain.finishSec * 1.5);
  });

  it('facing removes the allowance in passes, so more stock costs more time', () => {
    const light = estimateTurningTimes(base, brass, 55, { ...DEFAULT_TURNING_CONFIG, facingAllowanceMm: 1 });
    const heavy = estimateTurningTimes(base, brass, 55, { ...DEFAULT_TURNING_CONFIG, facingAllowanceMm: 6 });
    expect(heavy.facingSec).toBeGreaterThan(light.facingSec);
  });

  it('roughing more stock off means more passes AND more return strokes', () => {
    const thin = estimateTurningTimes({ ...base, barDiameterMm: 32 }, brass, 20, DEFAULT_TURNING_CONFIG);
    const thick = estimateTurningTimes({ ...base, barDiameterMm: 60 }, brass, 20, DEFAULT_TURNING_CONFIG);
    // Same volume removed, but from a bigger bar — more passes to get there.
    expect(thick.roughSec).toBeGreaterThan(thin.roughSec);
  });
});

describe('the model still degrades sensibly', () => {
  it('a part with nothing on it still costs something', () => {
    const bare = estimateTurningTimes(
      { odMm: 10, lengthMm: 20, boreDiaMm: 0, boreDepthMm: 0, grooveCount: 0,
        threadCount: 0, faceCount: 1, crossFeatures: false }, brass, 1, DEFAULT_TURNING_CONFIG);
    expect(bare.cuttingSec).toBeGreaterThan(0);
    expect(Number.isFinite(bare.cuttingSec)).toBe(true);
  });

  it('no bore means no boring time at all', () => {
    const solid = estimateTurningTimes({ ...base, boreDiaMm: 0, boreDepthMm: 0 }, brass, 55, DEFAULT_TURNING_CONFIG);
    expect(solid.boreSec).toBe(0);
    expect(solid.drillSec).toBe(0);
  });
});

describe('a stale settings blob cannot produce a NaN price', () => {
  it('survives a config missing the fields it divides by', () => {
    // Settings are persisted. A blob saved before a field existed comes back
    // without it, and the failure mode is not a slightly wrong number — it is
    // NaN propagating silently through cycle time into a quoted price.
    const stale = { maxRpm: 6000, toolChangeSec: 3, roughFraction: 0.9, maxDrillDiaMm: 20 } as never;
    const t = estimateTurningTimes(base, brass, 55, stale);
    for (const [name, v] of Object.entries(t)) {
      expect(Number.isFinite(v as number), `${name} = ${v}`).toBe(true);
    }
    expect(t.cuttingSec).toBeGreaterThan(0);
  });

  it('survives a profile with no bar diameter', () => {
    const t = estimateTurningTimes({ ...base, barDiameterMm: undefined }, brass, 55, DEFAULT_TURNING_CONFIG);
    expect(Number.isFinite(t.roughSec)).toBe(true);
    expect(t.roughSec).toBeGreaterThan(0);
  });
});
