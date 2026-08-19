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

describe('bar eligibility must not swallow prismatic blocks', () => {
  // Regression: a 61x52x47 block (TCL0893 spoiler) was routed to round bar
  // because "fits inside a cylinder" was treated as evidence of roundness. It
  // fills only ~34% of that cylinder, and the bar would have held MORE material
  // than the billet — while the mill-turn route then flattened its 8 measured
  // setups (including 2 compound-angle ones) to a fixed 2.
  const spoiler = {
    isTurned: false as const, setupCount: 8, angledSetups: 2, bossCount: 10,
    partDimsMm: { x: 61.487, y: 51.95, z: 47.4 }, partVolumeCm3: 45.088,
  };

  it('a sparse prismatic block stays on the mill, not round bar', () => {
    const r = selectMachine(spoiler);
    expect(r.route).toBe('mill');
    expect(r.stockForm).toBe('billet');
    expect(r.recommended).not.toBe('turn-mill');
  });

  it('explains the rejection in material terms', () => {
    const r = selectMachine(spoiler);
    const tm = r.candidates.find((c) => c.id === 'turn-mill')!;
    expect(tm.capable).toBe(false);
    expect(tm.reason).toMatch(/block|prismatic|fills only/i);
  });

  it('a genuine cylinder still routes to round bar', () => {
    const r = selectMachine({
      isTurned: false, setupCount: 4,
      partDimsMm: { x: 90, y: 30, z: 30 }, partVolumeCm3: 63.6, // ~a full cylinder
    });
    expect(r.route).toBe('mill-turn');
    expect(r.stockForm).toBe('bar');
  });

  it('the mill-turn route never collapses compound-angle setups away', () => {
    const plain = selectMachine({
      isTurned: false, setupCount: 4,
      partDimsMm: { x: 60, y: 30, z: 30 }, partVolumeCm3: 30,
    });
    const angled = selectMachine({
      isTurned: false, setupCount: 4, angledSetups: 2,
      partDimsMm: { x: 60, y: 30, z: 30 }, partVolumeCm3: 30,
    });
    expect(angled.route).toBe('mill-turn');
    // Angled axes still need indexing/tilting even in a one-clamp bar job.
    expect(angled.effectiveSetups!).toBe(plain.effectiveSetups! + 2);
  });
});

describe('bar stock is for parts longer than they are wide', () => {
  // Regression: part 031167-A, a 40x40x22 flange, was routed to ⌀45 bar. Volume
  // fill could not catch it — a bored, counterbored flange fills its cylinder
  // about as well as a real shaft — but the proportions give it away: you do not
  // bar-feed a disc, you chuck it from plate or a sawn billet. The wrong route
  // then collapsed its two measured setups to one.
  it('a disc / flange is not bar work', () => {
    const r = selectMachine({
      isTurned: false, setupCount: 2,
      partDimsMm: { x: 40, y: 40, z: 22 }, partVolumeCm3: 25,
    });
    expect(r.route).toBe('mill');
    expect(r.stockForm).toBe('billet');
    const tm = r.candidates.find((c) => c.id === 'turn-mill')!;
    expect(tm.capable).toBe(false);
    expect(tm.reason).toMatch(/disc|flange|along its length/i);
  });

  it('and the disc keeps the setup count the geometry measured', () => {
    const r = selectMachine({
      isTurned: false, setupCount: 2,
      partDimsMm: { x: 40, y: 40, z: 22 }, partVolumeCm3: 25,
    });
    // The bar route would have flattened this to 1.
    expect(r.effectiveSetups).toBeGreaterThanOrEqual(2);
  });

  it('an elongated shaft-like part is still bar work', () => {
    const r = selectMachine({
      isTurned: false, setupCount: 4,
      partDimsMm: { x: 90, y: 30, z: 30 }, partVolumeCm3: 63.6,
    });
    expect(r.route).toBe('mill-turn');
  });
});
