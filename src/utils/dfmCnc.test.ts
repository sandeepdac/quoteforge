import { describe, it, expect } from 'vitest';
import { analyzeCncDfm, CncDfmInput } from './dfmCnc';

const base: CncDfmInput = {
  partClass: 'turned',
  thicknessMm: 5,
  boundingBoxMm: { lengthMm: 100, widthMm: 20, heightMm: 20 },
  diameterMm: 20,
  axisLengthMm: 100,
  holeDetails: [{ diameterMm: 6, count: 2 }],
  buyToFlyRatio: 0.6,
  setups: 1,
  hasGeometry: true,
};

describe('analyzeCncDfm', () => {
  it('flags heavy stock removal (low buy-to-fly) as a finding', () => {
    const r = analyzeCncDfm({ ...base, buyToFlyRatio: 0.05 });
    const f = r.findings.find((x) => x.id === 'buy-to-fly');
    expect(f?.severity).toBe('fail');
  });

  it('passes buy-to-fly when yield is healthy', () => {
    const r = analyzeCncDfm({ ...base, buyToFlyRatio: 0.6 });
    expect(r.findings.find((x) => x.id === 'buy-to-fly')?.severity).toBe('pass');
  });

  it('flags a very slender turned part on L/D', () => {
    const r = analyzeCncDfm({ ...base, diameterMm: 6, axisLengthMm: 200 }); // L/D ≈ 33
    expect(r.findings.find((x) => x.id === 'slenderness')?.severity).toBe('fail');
  });

  it('notes when bar ⌀ exceeds sliding-head capacity', () => {
    const r = analyzeCncDfm({ ...base, diameterMm: 40, axisLengthMm: 40 });
    expect(r.findings.some((x) => x.id === 'bar-capacity')).toBe(true);
  });

  it('flags a wide bore that must be drilled + bored out', () => {
    const r = analyzeCncDfm({ ...base, diameterMm: 60, boreDiaMm: 45, boreDepthMm: 40, maxDrillDiaMm: 20 });
    const f = r.findings.find((x) => x.id === 'wide-bore');
    expect(f).toBeDefined();
    expect(f?.detail).toMatch(/bored out|boring bar/i);
  });

  it('does not flag a bore that is within the drillable range', () => {
    const r = analyzeCncDfm({ ...base, diameterMm: 60, boreDiaMm: 16, boreDepthMm: 30, maxDrillDiaMm: 20 });
    expect(r.findings.some((x) => x.id === 'wide-bore')).toBe(false);
  });

  it('fails when the bore is as large as the OD (no wall)', () => {
    const r = analyzeCncDfm({ ...base, diameterMm: 40, boreDiaMm: 40, boreDepthMm: 20 });
    expect(r.findings.find((x) => x.id === 'bore-vs-od')?.severity).toBe('fail');
  });

  it('flags micro-drilled small holes', () => {
    const r = analyzeCncDfm({ ...base, holeDetails: [{ diameterMm: 0.4, count: 1 }] });
    expect(r.findings.find((x) => x.id === 'small-holes')?.severity).toBe('fail');
  });

  it('warns on thin walls', () => {
    const r = analyzeCncDfm({ ...base, thicknessMm: 0.5 });
    expect(r.findings.some((x) => x.id === 'thin-wall')).toBe(true);
  });

  it('recognises a tight tolerance callout', () => {
    const r = analyzeCncDfm({ ...base, tolerances: '±0.005mm on the bore' });
    expect(r.findings.some((x) => x.id === 'tolerance')).toBe(true);
  });

  it('scores a clean part higher than a problem part', () => {
    const good = analyzeCncDfm(base);
    const bad = analyzeCncDfm({
      ...base,
      buyToFlyRatio: 0.05,
      diameterMm: 6,
      axisLengthMm: 200,
      holeDetails: [{ diameterMm: 0.4, count: 1 }],
    });
    expect(good.score).toBeGreaterThan(bad.score);
  });
});
