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

  it('saws a large block dimension instead of ordering oversize plate', () => {
    // NIST FTC-07: a 352 × 136 × 263 mm block. The 263 mm dim is too big to buy as
    // plate — it must be SAWN (~265 mm), not rounded up to 11" (279 mm). The 136 mm
    // dim is within flat-bar sizes and rounds to 5½" (139.7 mm).
    const b = milledBilletMm({ x: 352.2, y: 136.3, z: 263.3 });
    expect(b.x).toBeCloseTo(354.2, 1);   // longest → sawn
    expect(b.y).toBe(139.7);             // 5½" flat bar
    expect(b.z).toBeCloseTo(265.3, 1);   // sawn, NOT 279.4 (11")
    expect(b.z).toBeLessThan(279);
  });

  it('buys plate by THICKNESS for a thin plate, sawing the face to size', () => {
    // NIST FTC-11: a 68.2 × 68.2 × 3.0 mm coupon. You buy 1/4" (6.35 mm) plate and
    // saw a ~70 mm square from it — you do NOT round the 68 mm face up to a
    // "76 mm plate thickness" (the old bug), which more than doubled the material.
    const b = milledBilletMm({ x: 68.219, y: 68.219, z: 3.028 });
    expect(b.z).toBe(6.35);                 // thinnest dim → next standard plate
    expect(b.x).toBeCloseTo(68.219 + 2, 3); // face sawn to size, not rounded up
    expect(b.y).toBeCloseTo(68.219 + 2, 3);
    // Sanity: never smaller than the part.
    expect(b.x).toBeGreaterThan(68.219);
    expect(b.z).toBeGreaterThan(3.028);
  });
});

describe('nextStandardBar still works (turning path unaffected)', () => {
  it('picks the next bar up', () => {
    expect(nextStandardBar(21)).toBe(25);
    expect(nextStandardBar(25)).toBe(25);
  });
});
