import { describe, it, expect } from 'vitest';
import { rpm, roughingMrrCm3PerMin, estimateTurningTimes, TurningProfile } from './turning';
import { materialPropsFor } from './materials';

describe('rpm', () => {
  it('follows Vc·1000/(π·D)', () => {
    expect(rpm(100, 50, 100000)).toBeCloseTo((100 * 1000) / (Math.PI * 50), 3);
  });
  it('clamps to the machine ceiling on small diameters', () => {
    expect(rpm(300, 1, 6000)).toBe(6000);
  });
});

describe('roughingMrrCm3PerMin', () => {
  it('is Vc·fn·ap and brass beats stainless', () => {
    const brass = materialPropsFor('Brass CZ121');
    const ss = materialPropsFor('Stainless 316');
    expect(roughingMrrCm3PerMin(brass)).toBeCloseTo(brass.cuttingSpeedRough * brass.feedRough * brass.depthOfCutRough, 5);
    expect(roughingMrrCm3PerMin(brass)).toBeGreaterThan(roughingMrrCm3PerMin(ss));
  });
});

describe('estimateTurningTimes', () => {
  const profile: TurningProfile = {
    odMm: 20, lengthMm: 100, boreDiaMm: 8, boreDepthMm: 60,
    grooveCount: 1, threadCount: 1, faceCount: 2, crossFeatures: false,
  };
  const m = materialPropsFor('Medium-carbon Steel');

  it('returns positive cutting time and counts the engaged tools', () => {
    const t = estimateTurningTimes(profile, m, 25);
    expect(t.cuttingSec).toBeGreaterThan(0);
    // facing, rough, finish, drill, bore, groove, thread, part-off = 8
    expect(t.toolCount).toBe(8);
    expect(t.airSec).toBeGreaterThan(0);
  });

  it('drilling grows FASTER than depth, because a deep hole is pecked', () => {
    // The property that matters is superlinearity: past a few diameters the
    // drill has to keep coming out to clear its flutes, and each retreat is
    // longer than the last. Four times the depth costs MORE than four times the
    // time. (This used to be asserted as a flat 20% uplift on the per-mm rate,
    // which was really just restating the old constant 1.4x peck multiplier —
    // and per-mm now carries a fixed cost per hole that a shallow hole cannot
    // amortise, so that phrasing no longer measures pecking at all.)
    const shallow = estimateTurningTimes({ ...profile, boreDepthMm: 16 }, m, 25); // L/D 2 — one plunge
    const deep = estimateTurningTimes({ ...profile, boreDepthMm: 64 }, m, 25);    // L/D 8 — pecked
    expect(deep.drillSec).toBeGreaterThan(shallow.drillSec * 4);
  });

  it('a very deep small hole costs far more than the same hole made shallow', () => {
    // ⌀8 x 160 is an L/D of 20: half-diameter bites and a full retract each time.
    const veryDeep = estimateTurningTimes({ ...profile, boreDepthMm: 160 }, m, 25);
    const shallow = estimateTurningTimes({ ...profile, boreDepthMm: 16 }, m, 25);
    expect(veryDeep.drillSec / shallow.drillSec).toBeGreaterThan(10);
  });

  it('a solid part (no bore) skips drilling and boring', () => {
    const t = estimateTurningTimes({ ...profile, boreDiaMm: 0, boreDepthMm: 0 }, m, 25);
    expect(t.drillSec).toBe(0);
    expect(t.boreSec).toBe(0);
  });

  it('a wide bore is drilled to a pilot then bored out — much more boring time', () => {
    // 45 mm bore (> 20 mm max drill) in a 60 mm part vs an 18 mm drillable bore,
    // same depth. The wide bore needs many boring passes, so boreSec is far larger.
    const wide = estimateTurningTimes(
      { ...profile, odMm: 60, boreDiaMm: 45, boreDepthMm: 40 }, m, 200
    );
    const drillable = estimateTurningTimes(
      { ...profile, odMm: 60, boreDiaMm: 18, boreDepthMm: 40 }, m, 200
    );
    // 18 mm bore is a single finish pass; 45 mm bore adds ~20 mm of radius in steps.
    expect(wide.boreSec).toBeGreaterThan(drillable.boreSec * 4);
    // Drill time is bounded by the pilot (≤ max drill), not the 45 mm final size.
    expect(wide.drillSec).toBeLessThan(wide.boreSec);
  });
});
