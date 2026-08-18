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
    expect(r.route).toBe('mill');
    expect(r.stockForm).toBe('billet');
  });

  it('many access directions → 5-axis (fewer re-fixtures)', () => {
    const r = selectMachine({ isTurned: false, setupCount: 5, pocketCount: 3 });
    expect(r.recommended).toBe('mill-5axis');
    expect(r.reasons.join(' ')).toMatch(/setup|clamp|re-?fixture/i);
  });
});

describe('selectMachine — mill-turn from round bar (points 1 & 2)', () => {
  it('round-ish prismatic part that fits bar → turn-mill from round bar, one clamp', () => {
    const r = selectMachine({
      isTurned: false, setupCount: 4, pocketCount: 1, bossCount: 2,
      partDimsMm: { x: 60, y: 30, z: 30 }, partVolumeCm3: 30,
    });
    expect(r.recommended).toBe('turn-mill');
    expect(r.route).toBe('mill-turn');
    expect(r.stockForm).toBe('bar');
    expect(r.barDiameterMm).toBeGreaterThan(0);
    expect(r.effectiveSetups).toBeLessThan(4); // collapses the 4 access dirs
    expect(r.reasons.join(' ')).toMatch(/round bar|one operation|driven tools/i);
  });

  it('a flat slab is NOT round-bar work → stays on a machining centre', () => {
    const r = selectMachine({
      isTurned: false, setupCount: 2, pocketCount: 1,
      partDimsMm: { x: 120, y: 90, z: 6 }, partVolumeCm3: 60,
    });
    expect(r.recommended).not.toBe('turn-mill');
    expect(r.route).toBe('mill');
    const tm = r.candidates.find((c) => c.id === 'turn-mill');
    expect(tm?.capable).toBe(false);
  });

  it('a bar-shaped part too big for turn-mill capacity stays on the mill', () => {
    const r = selectMachine({
      isTurned: false, setupCount: 3,
      partDimsMm: { x: 200, y: 120, z: 120 }, partVolumeCm3: 800,
    });
    expect(r.recommended).not.toBe('turn-mill');
    expect(r.route).toBe('mill');
  });

  it('bar-eligible but the shop does NOT own a turn-mill → machining centre', () => {
    const r = selectMachine({
      isTurned: false, setupCount: 4,
      partDimsMm: { x: 60, y: 30, z: 30 }, partVolumeCm3: 30,
      ownedMachines: ['mill-3axis', 'mill-5axis'],
    });
    expect(r.recommended).toBe('mill-5axis');
    expect(r.route).toBe('mill');
  });
});

describe('selectMachine — shop machine inventory (point 4)', () => {
  it('only a 5-axis mill on the floor → it wins even for a low-setup part', () => {
    const r = selectMachine({ isTurned: false, setupCount: 2, ownedMachines: ['mill-5axis'] });
    expect(r.recommended).toBe('mill-5axis');
    expect(r.candidates.every((c) => c.id === 'mill-5axis')).toBe(true);
  });

  it('a 5-axis mill vs a 5-axis turn-mill: the bar-fit part goes to the turn-mill', () => {
    const r = selectMachine({
      isTurned: false, setupCount: 4,
      partDimsMm: { x: 55, y: 28, z: 28 }, partVolumeCm3: 22,
      ownedMachines: ['mill-5axis', 'turn-mill'],
    });
    expect(r.recommended).toBe('turn-mill');
    expect(r.candidates.map((c) => c.id).sort()).toEqual(['mill-5axis', 'turn-mill']);
  });

  it('turned part honours the inventory (no sliding-head → turn-mill)', () => {
    const r = selectMachine({
      isTurned: true, odMm: 16, barDiameterMm: 16, lengthMm: 40, crossFeatures: true,
      ownedMachines: ['turn-mill', 'mill-3axis'],
    });
    expect(r.recommended).toBe('turn-mill');
  });
});
