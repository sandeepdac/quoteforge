import { describe, it, expect } from 'vitest';
import { nextStandardPlate, milledBilletMm, nextStandardBar } from './materials';

describe('nextStandardPlate', () => {
  it('rounds up to a purchasable thickness', () => {
    expect(nextStandardPlate(27.9)).toBe(31.75); // 1.1" part → 1¼" plate
    expect(nextStandardPlate(12.7)).toBe(12.7);  // already standard
    expect(nextStandardPlate(0.5)).toBe(3.175);
  });

  it('falls back to 1-inch steps above the biggest listed plate', () => {
    expect(nextStandardPlate(150)).toBeCloseTo(152.4, 3);
  });
});

describe('milledBilletMm', () => {
  // The demo putter: a 112.5 × 27.9 × 23.1 mm part. A reference CAM quote for the
  // same model bought 4.50 × 1.00 × 1.50 in stock — i.e. real purchasable sizes,
  // not the bounding box.
  const bbox = { x: 112.468, y: 27.94, z: 23.107 };

  it('never returns stock smaller than the part', () => {
    const b = milledBilletMm(bbox);
    expect(b.x).toBeGreaterThan(bbox.x);
    expect(b.y).toBeGreaterThan(bbox.y);
    expect(b.z).toBeGreaterThan(bbox.z);
  });

  it('saws the longest dimension to length but buys standard plate for the rest', () => {
    const b = milledBilletMm(bbox, 1.5);
    expect(b.x).toBeCloseTo(112.468 + 3, 3);   // sawn: allowance only
    // 27.94 + 3 = 30.94 and 23.11 + 3 = 26.11; there is no 1⅛" plate, so both
    // land on 1¼" (31.75 mm) — the next size a supplier actually stocks.
    expect(b.y).toBe(31.75);
    expect(b.z).toBe(31.75);
  });

  it('lands within ~10% of the volume a real shop bought for this part', () => {
    const b = milledBilletMm(bbox);
    const vol = (b.x * b.y * b.z) / 1000;       // cm³
    const refVol = (4.5 * 1.0 * 1.5) * 16.387;  // in³ → cm³ ≈ 110.6
    expect(Math.abs(vol - refVol) / refVol).toBeLessThan(0.1);
  });

  it('is always bigger than the raw bounding box', () => {
    const b = milledBilletMm(bbox);
    const billetVol = (b.x * b.y * b.z) / 1000;
    const bboxVol = (bbox.x * bbox.y * bbox.z) / 1000;
    expect(billetVol).toBeGreaterThan(bboxVol);
  });
});

describe('nextStandardBar still works (turning path unaffected)', () => {
  it('picks the next bar up', () => {
    expect(nextStandardBar(21)).toBe(25);
    expect(nextStandardBar(25)).toBe(25);
  });
});
