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

  it('adds peck penalty on deep bores (more drill time than a shallow one)', () => {
    const deep = estimateTurningTimes({ ...profile, boreDepthMm: 60 }, m, 25); // 60/8 = 7.5 > 3 → peck
    const shallow = estimateTurningTimes({ ...profile, boreDepthMm: 16 }, m, 25); // 16/8 = 2 → no peck
    expect(deep.drillSec / 60).toBeGreaterThan((shallow.drillSec / 16) * 1.2);
  });

  it('a solid part (no bore) skips drilling and boring', () => {
    const t = estimateTurningTimes({ ...profile, boreDiaMm: 0, boreDepthMm: 0 }, m, 25);
    expect(t.drillSec).toBe(0);
    expect(t.boreSec).toBe(0);
  });
});
