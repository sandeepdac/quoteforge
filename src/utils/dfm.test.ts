import { describe, it, expect } from 'vitest';
import { analyzeDfm, DfmInput } from './dfm';
import type { DetectedHole, DetectedBend } from './holeDetector';

const base: DfmInput = {
  thicknessMm: 3,
  boundingBoxMm: { lengthMm: 300, widthMm: 200, heightMm: 3 },
  holeDetails: [{ diameterMm: 6, count: 4 }],
  holes: [],
  bends: [],
  hasGeometry: true,
};

const find = (r: ReturnType<typeof analyzeDfm>, id: string) => r.findings.find((f) => f.id === id);

describe('analyzeDfm — min hole size', () => {
  it('fails when a hole is smaller than material thickness', () => {
    const r = analyzeDfm({ ...base, holeDetails: [{ diameterMm: 2, count: 1 }] });
    expect(find(r, 'min-hole-size')?.severity).toBe('fail');
  });

  it('warns when a hole is between 1x and 1.5x thickness', () => {
    const r = analyzeDfm({ ...base, holeDetails: [{ diameterMm: 4, count: 1 }] }); // 4 < 4.5
    expect(find(r, 'min-hole-size')?.severity).toBe('warn');
  });

  it('passes when holes are comfortably larger than thickness', () => {
    const r = analyzeDfm({ ...base, holeDetails: [{ diameterMm: 6, count: 1 }] });
    expect(find(r, 'min-hole-size')?.severity).toBe('pass');
  });
});

describe('analyzeDfm — bend radius', () => {
  it('warns on an inside bend radius below thickness', () => {
    const bends: DetectedBend[] = [{ radiusMm: 1.0, lengthMm: 100, axisPoint: [0, 0, 0], axisDir: [0, 1, 0] }];
    const r = analyzeDfm({ ...base, bends });
    expect(find(r, 'min-bend-radius')?.severity).toBe('warn');
  });

  it('passes when bend radius meets thickness', () => {
    const bends: DetectedBend[] = [{ radiusMm: 3.5, lengthMm: 100, axisPoint: [0, 0, 0], axisDir: [0, 1, 0] }];
    const r = analyzeDfm({ ...base, bends });
    expect(find(r, 'min-bend-radius')?.severity).toBe('pass');
  });

  it('skips the bend-radius check when no geometry is available', () => {
    const r = analyzeDfm({ ...base, hasGeometry: false, bends: [] });
    expect(find(r, 'min-bend-radius')).toBeUndefined();
  });
});

describe('analyzeDfm — hole-to-bend clearance', () => {
  // Bend line runs along +Y through the origin; holes are offset in X.
  const bends: DetectedBend[] = [{ radiusMm: 3, lengthMm: 100, axisPoint: [0, 0, 0], axisDir: [0, 1, 0] }];
  const holeAt = (x: number): DetectedHole => ({ diameterMm: 5, center: [x, 50, 0], axis: [0, 0, 1] });

  it('fails when a hole edge is within 1x thickness of the bend', () => {
    // x=4 → center-to-line 4, edge = 4 - 2.5 = 1.5 < 3 (=1x t)
    const r = analyzeDfm({ ...base, holeDetails: [{ diameterMm: 5, count: 1 }], holes: [holeAt(4)], bends });
    expect(find(r, 'hole-to-bend')?.severity).toBe('fail');
  });

  it('warns when a hole edge is within 2x thickness of the bend', () => {
    // x=8 → edge = 8 - 2.5 = 5.5, between 3 (1x t) and 6 (2x t)
    const r = analyzeDfm({ ...base, holeDetails: [{ diameterMm: 5, count: 1 }], holes: [holeAt(8)], bends });
    expect(find(r, 'hole-to-bend')?.severity).toBe('warn');
  });

  it('passes when holes are well clear of the bend', () => {
    // x=20 → edge = 17.5 >> 6
    const r = analyzeDfm({ ...base, holeDetails: [{ diameterMm: 5, count: 1 }], holes: [holeAt(20)], bends });
    expect(find(r, 'hole-to-bend')?.severity).toBe('pass');
  });
});

describe('analyzeDfm — part-level checks', () => {
  it('warns on a large, thin part', () => {
    const r = analyzeDfm({ ...base, thicknessMm: 1, boundingBoxMm: { lengthMm: 1000, widthMm: 400, heightMm: 1 } });
    expect(find(r, 'thin-part')?.severity).toBe('warn');
  });

  it('warns when the part exceeds a standard sheet', () => {
    const r = analyzeDfm({ ...base, boundingBoxMm: { lengthMm: 3200, widthMm: 500, heightMm: 3 } });
    expect(find(r, 'sheet-size')?.severity).toBe('warn');
  });

  it('marks a normal footprint as fitting standard stock', () => {
    const r = analyzeDfm(base);
    expect(find(r, 'sheet-size')?.severity).toBe('info');
  });
});

describe('analyzeDfm — scoring', () => {
  it('scores 100 when nothing is flagged', () => {
    const r = analyzeDfm(base); // pass + info only
    expect(r.counts.fail).toBe(0);
    expect(r.counts.warn).toBe(0);
    expect(r.score).toBe(100);
  });

  it('deducts for failures and warnings and orders failures first', () => {
    const bends: DetectedBend[] = [{ radiusMm: 1, lengthMm: 100, axisPoint: [0, 0, 0], axisDir: [0, 1, 0] }];
    const holes: DetectedHole[] = [{ diameterMm: 2, center: [1, 50, 0], axis: [0, 0, 1] }];
    const r = analyzeDfm({ ...base, holeDetails: [{ diameterMm: 2, count: 1 }], holes, bends });
    expect(r.counts.fail).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(100);
    expect(r.findings[0].severity).toBe('fail');
  });
});
