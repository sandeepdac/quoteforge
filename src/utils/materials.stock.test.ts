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
    const b = milledBilletMm(bbox);
    expect(b.x).toBeCloseTo(112.468 + 2, 3);   // sawn: allowance only
    expect(b.y).toBe(31.75);                    // 1¼" plate
    expect(b.z).toBe(25.4);                     // 1" plate — matches the reference
  });

  it('does not jump a whole size for a fraction of a millimetre', () => {
    // The NIST CTC-01 benchmark is 150 mm thick and a real shop bought 6" (152.4)
    // plate — 1.2 mm/face of clean-up. An over-generous allowance would push it to
    // 7" plate and add ~16% to the material bill for the sake of 0.6 mm.
    const b = milledBilletMm({ x: 800, y: 450, z: 150 });
    expect(b.z).toBeCloseTo(152.4, 3);
    const vol = (b.x * b.y * b.z) / 1000;
    const refVol = (806.45 * 457.2 * 152.4) / 1000;
    expect(Math.abs(vol - refVol) / refVol).toBeLessThan(0.05);
  });

  it('stays in the right ballpark on the putter (stock choice is shop-dependent)', () => {
    // The reference shop bought 1½" plate where we pick 1¼"; both are legitimate
    // choices, so this only guards against being wildly off.
    const b = milledBilletMm(bbox);
    const vol = (b.x * b.y * b.z) / 1000;
    const refVol = 4.5 * 1.0 * 1.5 * 16.387;   // ≈ 110.6 cm³
    expect(Math.abs(vol - refVol) / refVol).toBeLessThan(0.25);
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
