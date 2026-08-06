import { describe, it, expect } from 'vitest';
import { selectMachine } from './machineSelection';

describe('selectMachine — turning', () => {
  it('small plain bar part → sliding-head', () => {
    const r = selectMachine({ isTurned: true, odMm: 12, barDiameterMm: 12, lengthMm: 40, crossFeatures: false });
    expect(r.recommended).toBe('sliding-head');
    expect(r.rateMultiplier).toBe(1.0);
  });

  it('small part with cross-features → still sliding-head (has live tooling)', () => {
    const r = selectMachine({ isTurned: true, odMm: 16, barDiameterMm: 16, lengthMm: 50, crossFeatures: true });
    expect(r.recommended).toBe('sliding-head');
    expect(r.reasons.join(' ')).toMatch(/driven tools|in-cycle|cross/i);
  });

  it('slender small part cites the guide bush', () => {
    const r = selectMachine({ isTurned: true, odMm: 6, barDiameterMm: 6, lengthMm: 120, crossFeatures: false });
    expect(r.recommended).toBe('sliding-head');
    expect(r.reasons.join(' ')).toMatch(/guide bush|slender/i);
  });

  it('large plain-turned part → 2-axis lathe (cheapest capable)', () => {
    const r = selectMachine({ isTurned: true, odMm: 80, barDiameterMm: 85, lengthMm: 60, crossFeatures: false });
    expect(r.recommended).toBe('cnc-lathe-2axis');
    expect(r.rateMultiplier).toBeLessThan(1.0);
  });

  it('large part with cross-features → turn-mill (live tooling, one setup)', () => {
    const r = selectMachine({ isTurned: true, odMm: 50, barDiameterMm: 50, lengthMm: 40, crossFeatures: true });
    expect(r.recommended).toBe('turn-mill');
    expect(r.rateMultiplier).toBeGreaterThan(1.0);
  });

  it('oversize part with cross-features flags a second op on the 2-axis route', () => {
    const r = selectMachine({ isTurned: true, odMm: 120, barDiameterMm: 120, lengthMm: 80, crossFeatures: true });
    expect(r.recommended).toBe('cnc-lathe-2axis');
    expect(r.secondOpNote).toBeTruthy();
  });

  it('marks the 2-axis lathe not-capable of cross-features in-cycle', () => {
    const r = selectMachine({ isTurned: true, odMm: 16, lengthMm: 40, crossFeatures: true });
    const lathe = r.candidates.find((c) => c.id === 'cnc-lathe-2axis');
    expect(lathe?.reason).toMatch(/no live tooling|second-op/i);
  });
});

describe('selectMachine — milling', () => {
  it('few setups → 3-axis machining centre', () => {
    const r = selectMachine({ isTurned: false, setupCount: 2, pocketCount: 1 });
    expect(r.recommended).toBe('mill-3axis');
  });

  it('many access directions → 5-axis (fewer re-fixtures)', () => {
    const r = selectMachine({ isTurned: false, setupCount: 5, pocketCount: 3 });
    expect(r.recommended).toBe('mill-5axis');
    expect(r.reasons.join(' ')).toMatch(/setup|clamp|re-?fixture/i);
  });
});
