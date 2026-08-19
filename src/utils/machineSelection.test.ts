import { describe, it, expect } from 'vitest';
import { selectMachine, MACHINE_CATALOG } from './machineSelection';

// These tests are written against Turncircuit's REAL plant list, so a failure
// means "the shop could not actually make it that way", not "a heuristic moved".

describe('the catalog reflects the real plant', () => {
  it('separates bar capacity from chuck capacity on the mill-turns', () => {
    // The distinction the old single-number catalog lost: a ⌀65 bar limit does
    // not stop the machine chucking a much larger part.
    expect(MACHINE_CATALOG['ntx-1000'].maxBarDiaMm).toBe(65);
    expect(MACHINE_CATALOG['ntx-1000'].maxChuckDiaMm).toBe(125);
    expect(MACHINE_CATALOG['nl-2000'].maxBarDiaMm).toBe(65);
    expect(MACHINE_CATALOG['nl-2000'].maxChuckDiaMm).toBe(430);
  });

  it('has exactly one 5-axis machine, and it is a lathe', () => {
    const fiveAxis = Object.values(MACHINE_CATALOG).filter((m) => m.axes >= 5 && m.kind !== 'sliding-head');
    expect(fiveAxis.map((m) => m.id)).toEqual(['ntx-1000']);
    // There is NO 5-axis machining centre on this floor.
    expect(Object.values(MACHINE_CATALOG).some((m) => m.kind === 'mill' && m.axes >= 5)).toBe(false);
  });

  it('carries a milling envelope for every machining centre', () => {
    for (const m of Object.values(MACHINE_CATALOG).filter((x) => x.kind === 'mill')) {
      expect(m.envelopeMm).toBeTruthy();
    }
  });
});

describe('turned parts route by real capacity', () => {
  it('a ⌀8 bar part goes to the smallest, cheapest sliding-head', () => {
    const r = selectMachine({ isTurned: true, odMm: 8, barDiameterMm: 8, lengthMm: 40 });
    expect(r.recommended).toBe('hanwha');
    expect(r.stockForm).toBe('bar');
  });

  it('a ⌀12 bar part skips the ⌀10 machine for the SR-20', () => {
    const r = selectMachine({ isTurned: true, odMm: 12, barDiameterMm: 12, lengthMm: 40 });
    expect(r.recommended).toBe('star-sr20');
  });

  it('a ⌀28 bar part needs the SR-32', () => {
    const r = selectMachine({ isTurned: true, odMm: 28, barDiameterMm: 28, lengthMm: 200 });
    expect(r.recommended).toBe('star-sr32');
  });

  it('a slender small part cites the guide bush', () => {
    const r = selectMachine({ isTurned: true, odMm: 6, barDiameterMm: 6, lengthMm: 120 });
    expect(r.reasons.join(' ')).toMatch(/guide bush|slender/i);
  });

  it('a ⌀50 part with off-axis features needs live tooling and a chuck', () => {
    const r = selectMachine({ isTurned: true, odMm: 50, barDiameterMm: 50, lengthMm: 40, crossFeatures: true });
    // Hi Turner could hold it but has no driven tools; the NL 2000 is the
    // cheapest that can do both.
    expect(r.recommended).toBe('nl-2000');
    const hi = r.candidates.find((c) => c.id === 'hi-turner')!;
    expect(hi.capable).toBe(false);
    expect(hi.reason).toMatch(/live tooling/i);
  });

  it('a ⌀300 part fits only the NL 2000', () => {
    const r = selectMachine({ isTurned: true, odMm: 300, barDiameterMm: 300, lengthMm: 200 });
    expect(r.recommended).toBe('nl-2000');
  });

  it('a part beyond every lathe says so instead of pretending', () => {
    const r = selectMachine({ isTurned: true, odMm: 600, barDiameterMm: 600, lengthMm: 800 });
    expect(r.reasons.join(' ')).toMatch(/does not fit|confirm the route/i);
  });
});

describe('milled parts: chucked turning is not the same as bar work', () => {
  // Part 031167-A: a 40x40x22 flange with an on-axis ⌀21 spigot and ⌀10.7 bore.
  const flange = {
    isTurned: false as const, setupCount: 2,
    partDimsMm: { x: 40, y: 40, z: 22 }, partVolumeCm3: 25,
    onAxisTurnedFeatures: 2, // the ⌀21 spigot and the ⌀10.7 bore
  };

  it('a flange is too short to bar-feed but still turning work', () => {
    const r = selectMachine(flange);
    expect(r.route).toBe('mill-turn');
    expect(r.stockForm).toBe('billet'); // chucked from a sawn slug, not bar
    expect(r.barDiameterMm).toBeUndefined();
    expect(MACHINE_CATALOG[r.recommended].kind).toBe('turn-mill');
  });

  it('and says the on-axis features are turned, not interpolated', () => {
    const r = selectMachine(flange);
    expect(r.reasons.join(' ')).toMatch(/turned on the spindle|on-axis/i);
  });

  it('picks the cheaper of the two mill-turns when both can hold it', () => {
    const r = selectMachine(flange);
    expect(r.recommended).toBe('nl-2000'); // 1.35 vs the NTX's 1.6
  });

  it('an elongated round part still bar-feeds', () => {
    const r = selectMachine({
      isTurned: false, setupCount: 4,
      partDimsMm: { x: 90, y: 30, z: 30 }, partVolumeCm3: 63.6,
    });
    expect(r.route).toBe('mill-turn');
    expect(r.stockForm).toBe('bar');
    expect(r.barDiameterMm).toBeGreaterThan(0);
  });

  it('round-ish proportions alone do NOT make it chucking work', () => {
    // A 200x200x100 block with half its material removed fills the cylinder
    // around it as well as a real turned part does. Without coaxial turned
    // features there is nothing for the spindle to cut.
    const r = selectMachine({
      isTurned: false, setupCount: 8,
      partDimsMm: { x: 200, y: 200, z: 100 }, partVolumeCm3: 2000,
    });
    expect(r.route).toBe('mill');
    const tm = r.candidates.find((c) => c.id === 'nl-2000')!;
    expect(tm.reason).toMatch(/no coaxial turned features/i);
  });

  it('a prismatic block is not turning work at all', () => {
    // TCL0893 spoiler: fills ~34% of the cylinder around it.
    const r = selectMachine({
      isTurned: false, setupCount: 8, angledSetups: 2, bossCount: 10,
      partDimsMm: { x: 61.487, y: 51.95, z: 47.4 }, partVolumeCm3: 45.088,
    });
    expect(r.route).toBe('mill');
    expect(MACHINE_CATALOG[r.recommended].kind).toBe('mill');
  });

  it('a flat slab is not turning work either', () => {
    const r = selectMachine({
      isTurned: false, setupCount: 2,
      partDimsMm: { x: 120, y: 90, z: 6 }, partVolumeCm3: 60,
    });
    expect(r.route).toBe('mill');
  });
});

describe('milling centres are gated by envelope', () => {
  it('a high-setup prismatic part goes to the 4-axis VF-2, not an imaginary 5-axis', () => {
    const r = selectMachine({
      isTurned: false, setupCount: 8,
      partDimsMm: { x: 200, y: 200, z: 100 }, partVolumeCm3: 2000,
    });
    expect(r.recommended).toBe('haas-vf2');
    expect(MACHINE_CATALOG[r.recommended].axes).toBe(4);
  });

  it('a 1.5 m part fits only the Sabre', () => {
    const r = selectMachine({
      isTurned: false, setupCount: 2,
      partDimsMm: { x: 1500, y: 400, z: 300 }, partVolumeCm3: 50000,
    });
    expect(r.recommended).toBe('sabre');
    const vf2 = r.candidates.find((c) => c.id === 'haas-vf2')!;
    expect(vf2.capable).toBe(false);
    expect(vf2.reason).toMatch(/exceeds/i);
  });

  it('a part bigger than every machine says so rather than quoting silently', () => {
    const r = selectMachine({
      isTurned: false, setupCount: 2,
      partDimsMm: { x: 3000, y: 800, z: 800 }, partVolumeCm3: 500000,
    });
    expect(r.reasons.join(' ')).toMatch(/exceeds every milling envelope|confirm the route/i);
  });
});

describe('shop inventory still gates everything', () => {
  it('without the mill-turns, a bar part falls to a machining centre', () => {
    const r = selectMachine({
      isTurned: false, setupCount: 4,
      partDimsMm: { x: 90, y: 30, z: 30 }, partVolumeCm3: 63.6,
      ownedMachines: ['haas-vf2', 'sabre'],
    });
    expect(r.route).toBe('mill');
    expect(['haas-vf2', 'sabre']).toContain(r.recommended);
  });

  it('only the candidates the shop owns are shown', () => {
    const r = selectMachine({
      isTurned: false, setupCount: 2,
      partDimsMm: { x: 200, y: 200, z: 100 }, partVolumeCm3: 2000,
      ownedMachines: ['sabre'],
    });
    expect(r.candidates.every((c) => c.id === 'sabre')).toBe(true);
  });

  it('compound-angle setups survive every route', () => {
    const plain = selectMachine({
      isTurned: false, setupCount: 4,
      partDimsMm: { x: 90, y: 30, z: 30 }, partVolumeCm3: 63.6,
    });
    const angled = selectMachine({
      isTurned: false, setupCount: 4, angledSetups: 2,
      partDimsMm: { x: 90, y: 30, z: 30 }, partVolumeCm3: 63.6,
    });
    expect(angled.effectiveSetups!).toBe(plain.effectiveSetups! + 2);
  });
});
