import { describe, it, expect } from 'vitest';
import { cameraBracketFor, zoomLimitsFor, isModelWithinBracket } from './viewerCamera';

// Real parts the viewer has to handle, smallest to largest.
const PARTS: Array<[string, number]> = [
  ['insert', 12],
  ['putter', 112],
  ['bracket', 300],
  ['NIST CTC-01 plate', 800],
  ['weldment frame', 1800],
  ['long beam', 3000],
];

describe('cameraBracketFor', () => {
  it.each(PARTS)('keeps a %s (%i mm) entirely inside the view frustum', (_name, span) => {
    for (const frame of [1, 1.12]) {
      expect(isModelWithinBracket(span, cameraBracketFor(span, frame))).toBe(true);
    }
  });

  it('regression: a fixed 2000 mm far plane clipped anything large', () => {
    // What the viewer used to do — an 800 mm plate rendered as a sliver and a
    // 1800 mm frame disappeared entirely, while the dimension readout still
    // looked right, so it read as "the file failed to load".
    const fixed = (span: number) => ({ near: 0.1, far: 2000, distance: cameraBracketFor(span, 1.12).distance });
    expect(isModelWithinBracket(800, fixed(800))).toBe(false);
    expect(isModelWithinBracket(1800, fixed(1800))).toBe(false);
    // …and the same parts are fine once near/far scale with the model.
    expect(isModelWithinBracket(800, cameraBracketFor(800, 1.12))).toBe(true);
    expect(isModelWithinBracket(1800, cameraBracketFor(1800, 1.12))).toBe(true);
  });

  it('scales near and far with the model rather than fixing them', () => {
    const small = cameraBracketFor(10);
    const big = cameraBracketFor(1000);
    expect(big.far).toBeGreaterThan(small.far);
    expect(big.near).toBeGreaterThan(small.near);
    expect(small.near).toBeGreaterThan(0); // never zero — that breaks depth precision
  });

  it('falls back to a sane span for a degenerate model', () => {
    const b = cameraBracketFor(0);
    expect(b.far).toBeGreaterThan(0);
    expect(Number.isFinite(b.distance)).toBe(true);
  });
});

describe('zoomLimitsFor', () => {
  it.each(PARTS)('brackets the default camera distance for a %s (%i mm)', (_name, span) => {
    const { min, max } = zoomLimitsFor(span);
    const z = span * 1.8; // the camera's initial z offset
    expect(z).toBeGreaterThanOrEqual(min);
    expect(z).toBeLessThanOrEqual(max);
  });

  it('regression: fixed 100–1200 limits snapped large parts to a hard stop', () => {
    // An 800 mm part starts at z ≈ 1440, outside the old clamp, so the first
    // scroll jumped it to 1200.
    const z = 800 * 1.8;
    expect(z).toBeGreaterThan(1200);
    expect(z).toBeLessThanOrEqual(zoomLimitsFor(800).max);
  });
});
