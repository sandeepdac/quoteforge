import { describe, it, expect } from 'vitest';
import { generateTurningToolpath, toGcode } from './toolpath';
import { materialPropsFor } from './materials';
import type { TurningProfile } from './turning';

const profile: TurningProfile = {
  odMm: 20, lengthMm: 100, boreDiaMm: 8, boreDepthMm: 40,
  grooveCount: 0, threadCount: 0, faceCount: 2, crossFeatures: false,
};
const brass = materialPropsFor('Brass CZ121');

describe('generateTurningToolpath', () => {
  const tp = generateTurningToolpath(profile, 25, brass);

  it('produces the expected ordered operations', () => {
    expect(tp.passes.map((p) => p.op)).toEqual(['face', 'rough', 'drill', 'finish', 'partoff']);
  });

  it('roughing steps the diameter down from stock toward the part OD', () => {
    const rough = tp.passes.find((p) => p.op === 'rough')!;
    const feedXs = rough.moves.filter((m) => !m.rapid).map((m) => m.x);
    // Every roughing feed cut is below the stock and at/above the finished OD.
    expect(Math.max(...feedXs)).toBeLessThanOrEqual(25);
    expect(Math.min(...feedXs)).toBeGreaterThanOrEqual(profile.odMm - 0.01);
  });

  it('omits the drill pass when there is no bore', () => {
    const solid = generateTurningToolpath({ ...profile, boreDiaMm: 0, boreDepthMm: 0 }, 25, brass);
    expect(solid.passes.some((p) => p.op === 'drill')).toBe(false);
  });

  it('every pass carries a positive rpm and feed', () => {
    expect(tp.passes.every((p) => p.rpm > 0 && p.feed > 0)).toBe(true);
  });
});

describe('toGcode', () => {
  const tp = generateTurningToolpath(profile, 25, brass);
  const g = toGcode(tp, { partName: 'shaft', materialName: 'Brass' });

  it('is stamped REFERENCE and well-formed', () => {
    expect(g).toContain('REFERENCE');
    expect(g.startsWith('%')).toBe(true);
    expect(g.trimEnd().endsWith('%')).toBe(true);
    expect(g).toContain('M30');
  });

  it('contains real motion + spindle codes', () => {
    expect(g).toMatch(/G0?1 X/);
    expect(g).toMatch(/G97 S\d+ M03/);
    expect(g).toContain('G21');
  });
});
