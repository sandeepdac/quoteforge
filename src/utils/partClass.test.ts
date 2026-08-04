import { describe, it, expect } from 'vitest';
import { classifyPart } from './partClass';

describe('classifyPart', () => {
  it('classifies a slender round shaft as turned', () => {
    // ⌀20 × 120 bar: two equal cross dims, volume = a solid cylinder.
    const vol = (Math.PI / 4) * 20 * 20 * 120 / 1000; // cm³
    const r = classifyPart({ lengthMm: 120, widthMm: 20, heightMm: 20, volumeCm3: vol });
    expect(r.partClass).toBe('turned');
    expect(r.diameterMm).toBeCloseTo(20, 0);
    expect(r.axisLengthMm).toBeCloseTo(120, 0);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('classifies a round flange/disc as turned', () => {
    // ⌀60 × 8 disc.
    const vol = (Math.PI / 4) * 60 * 60 * 8 / 1000;
    const r = classifyPart({ lengthMm: 60, widthMm: 60, heightMm: 8, volumeCm3: vol });
    expect(r.partClass).toBe('turned');
    expect(r.diameterMm).toBeCloseTo(60, 0);
  });

  it('classifies a rectangular block as milled', () => {
    // 100 × 60 × 40 solid block fills its whole bounding box.
    const vol = (100 * 60 * 40) / 1000;
    const r = classifyPart({ lengthMm: 100, widthMm: 60, heightMm: 40, volumeCm3: vol });
    expect(r.partClass).toBe('milled');
  });

  it('classifies a square-section bar with corners filled as milled, not turned', () => {
    // Square cross-section but a FULL box (not revolved) → prismatic.
    const vol = (20 * 20 * 120) / 1000;
    const r = classifyPart({ lengthMm: 120, widthMm: 20, heightMm: 20, volumeCm3: vol });
    expect(r.partClass).toBe('milled');
  });

  it('defaults to milled with zero confidence when geometry is missing', () => {
    const r = classifyPart({ lengthMm: 0, widthMm: 0, heightMm: 0, volumeCm3: 0 });
    expect(r.partClass).toBe('milled');
    expect(r.confidence).toBe(0);
  });
});
