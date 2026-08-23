import { describe, it, expect } from 'vitest';
import { selectMachine, setupsOnMachine, MACHINE_CATALOG, REFERENCE_HOURLY_RATE, MachineId } from './machineSelection';

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
    expect(r.recommended).toBe('nl-2000'); // £88/hr against the NTX's £135
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

  it('a prismatic block is not TURNING work — but the 5-axis mill-turn is still the right MILL', () => {
    // TCL0893 spoiler: fills ~34% of the cylinder around it, so nothing here is
    // turned. It has compound-angle holes, though, and a 5-axis mill-turn holds
    // a block in soft jaws and mills it done-complete. Routing it to a VMC
    // because "it isn't round" quoted the shop's fallback machine instead of the
    // one it bought to win this work.
    const r = selectMachine({
      isTurned: false, setupCount: 8, angledSetups: 2, axisAlignedSetups: 6, bossCount: 10,
      partDimsMm: { x: 61.487, y: 51.95, z: 47.4 }, partVolumeCm3: 45.088,
    });
    expect(r.route).toBe('mill'); // milled from billet — not a turning route
    expect(r.stockForm).toBe('billet');
    expect(r.recommended).toBe('ntx-1000');
    // Six directions plus two compound angles: eight clamps on a 3-axis, two here.
    expect(r.effectiveSetups).toBe(2);
    const vf2 = r.bakeOff!.find((b) => b.id === 'haas-vf2')!;
    expect(vf2.setups).toBeGreaterThan(r.effectiveSetups!);
    expect(vf2.hourlyRate).toBeLessThan(MACHINE_CATALOG['ntx-1000'].hourlyRate);
    // ...and the premium machine still wins, because the setups it deletes cost
    // more than the hours it adds.
    expect(r.bakeOff![0].id).toBe('ntx-1000');
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

  it('compound angles cost setups on 3 and 4 axes, and nothing on 5', () => {
    // A hole can only be cut along its own axis. Reaching one tilted in two
    // planes takes two rotations: a 3-axis needs a fixture per angle, a single
    // rotary still cannot get there, and a 5-axis head simply points at it.
    // This is the whole economic case for the machine, so it must not be a
    // blanket "+1 per angle" applied regardless of what is making the part.
    const demand = { faces: 4, angled: 2 };
    const on = (id: MachineId) =>
      setupsOnMachine(MACHINE_CATALOG[id], demand.faces, demand.angled).setups;
    const without = (id: MachineId) =>
      setupsOnMachine(MACHINE_CATALOG[id], demand.faces, 0).setups;

    expect(on('sabre') - without('sabre')).toBe(2);       // 3-axis: a fixture each
    expect(on('haas-vf2') - without('haas-vf2')).toBe(2); // 4-axis: one rotary is not enough
    expect(on('ntx-1000') - without('ntx-1000')).toBe(0); // 5-axis: free
  });

  it('a part with compound angles is not silently under-costed when no 5-axis can hold it', () => {
    // The protection that mattered — angles adding setups — now lives where it
    // belongs: it applies whenever the machine that gets the job cannot reach
    // them, rather than being charged even to the machine that can.
    const big = {
      isTurned: false as const, setupCount: 6, axisAlignedSetups: 4, angledSetups: 2,
      partDimsMm: { x: 600, y: 400, z: 300 }, partVolumeCm3: 40000,
    };
    const r = selectMachine(big);
    expect(MACHINE_CATALOG[r.recommended].kind).toBe('mill'); // too big for any chuck
    expect(r.effectiveSetups!).toBeGreaterThanOrEqual(4);
    expect(r.reasons.join(' ')).toMatch(/compound angle|tilted fixture/i);
  });
});

// --- The bake-off ---------------------------------------------------------
// Machine choice moves two things in OPPOSITE directions: a mill-turn needs far
// fewer setups, and costs far more an hour. Ranking on rate alone can only ever
// see one of them, which is how the shop's fallback machine came to be quoted
// for the work its best machine exists to win.
describe('total-cost bake-off', () => {
  const spoiler = {
    isTurned: false as const,
    setupCount: 8, axisAlignedSetups: 6, angledSetups: 2, bossCount: 10,
    partDimsMm: { x: 61.487, y: 51.95, z: 47.4 }, partVolumeCm3: 45.088,
  };

  it('rates span the real gap between a VMC and a 5-axis mill-turn', () => {
    const vmc = MACHINE_CATALOG['haas-vf2'].hourlyRate;
    const fiveAxis = MACHINE_CATALOG['ntx-1000'].hourlyRate;
    // Not "110% vs 100%" — a different class of asset, with a rate to match.
    expect(fiveAxis / vmc).toBeGreaterThan(2);
    expect(fiveAxis / vmc).toBeLessThan(3.5);
  });

  it('the multiplier is derived from the hourly rate, never hand-set', () => {
    for (const spec of Object.values(MACHINE_CATALOG)) {
      expect(spec.rateMultiplier).toBeCloseTo(spec.hourlyRate / REFERENCE_HOURLY_RATE, 3);
    }
  });

  it('ranks every capable machine and shows what each would cost', () => {
    const r = selectMachine(spoiler);
    expect(r.bakeOff!.length).toBeGreaterThan(1);
    const totals = r.bakeOff!.map((b) => b.totalPerPart);
    expect([...totals].sort((a, b) => a - b)).toEqual(totals); // cheapest first
    for (const b of r.bakeOff!) {
      expect(b.setups).toBeGreaterThan(0);
      expect(b.setupReason.length).toBeGreaterThan(0);
      expect(b.totalPerPart).toBeGreaterThan(0);
    }
  });

  it('at qty 1 the setups decide, so the premium machine wins', () => {
    const r = selectMachine({ ...spoiler, quantity: 1 });
    expect(r.recommended).toBe('ntx-1000');
    expect(r.reasons.join(' ')).toMatch(/cheaper per hour|done-complete|B-axis/i);
  });

  it('at high quantity the setups amortise away and the cheap machine takes over', () => {
    // This flip is the whole point of costing the decision rather than asserting
    // it: the right machine for one part is not the right machine for 500.
    const one = selectMachine({ ...spoiler, quantity: 1 });
    const many = selectMachine({ ...spoiler, quantity: 500 });
    const rateOf = (id: MachineId) => MACHINE_CATALOG[id].hourlyRate;
    expect(rateOf(many.recommended)).toBeLessThan(rateOf(one.recommended));
  });

  it('a shop without the 5-axis gets an honest, more expensive answer', () => {
    // Selection must never quote a machine the shop does not own — and when the
    // capable machine is missing, the price should rise, not quietly stay put.
    const withNtx = selectMachine(spoiler);
    const without = selectMachine({
      ...spoiler,
      ownedMachines: ['haas-vf2', 'sabre', 'h-mini-mill-300', 'hi-turner'],
    });
    expect(without.recommended).not.toBe('ntx-1000');
    expect(without.effectiveSetups!).toBeGreaterThan(withNtx.effectiveSetups!);
  });
});

// --- A chucked turn-mill must not invent a second holding ------------------
// "One chucking per end" is the normal case for chucked turning, but it was
// applied regardless of what the part demanded. Part OLY014 is a stepped
// ⌀20/17/16 stack presenting a SINGLE access direction: it was charged two
// chuckings against a mill's one, which made the turning route 1.8x the price
// and sent a textbook turned register to a 3-axis mill to be interpolated.
describe('chucked turning is costed against the part, not a convention', () => {
  const oneSided = {
    isTurned: false as const,
    setupCount: 1, axisAlignedSetups: 1, angledSetups: 0, bossCount: 3,
    partDimsMm: { x: 20, y: 20, z: 14.8 }, partVolumeCm3: 2.66,
    onAxisTurnedFeatures: 3, quantity: 1,
  };

  it('a one-sided part chucks once, and the turned register goes to a lathe', () => {
    const r = selectMachine(oneSided);
    expect(MACHINE_CATALOG[r.recommended].kind).toBe('turn-mill');
    expect(r.route).toBe('mill-turn');
    expect(r.effectiveSetups).toBe(1);
  });

  it('a two-sided part still chucks each end', () => {
    // The flange: features reached from both ends, so the second holding is real.
    const r = selectMachine({
      isTurned: false, setupCount: 2, axisAlignedSetups: 2, angledSetups: 0,
      partDimsMm: { x: 40, y: 40, z: 22 }, partVolumeCm3: 25,
      onAxisTurnedFeatures: 2, quantity: 1,
    });
    expect(r.effectiveSetups).toBe(2);
  });

  it('the phantom holding was what lost the bake-off, not the hourly rate', () => {
    const r = selectMachine(oneSided);
    const turnMill = r.bakeOff!.find((b) => MACHINE_CATALOG[b.id].kind === 'turn-mill')!;
    const cheapestMill = r.bakeOff!.find((b) => MACHINE_CATALOG[b.id].kind === 'mill')!;
    // It still costs more per hour — that is real and stays.
    expect(turnMill.hourlyRate).toBeGreaterThan(cheapestMill.hourlyRate);
    // ...but it no longer carries a clamp the part never asked for.
    expect(turnMill.setups).toBe(cheapestMill.setups);
  });
});

// --- The Swiss lathes were not in the room --------------------------------
// A part classified "milled" includes any round bar part carrying a freeform
// face. That path only ever considered turn-mills and machining centres, so a
// ⌀7 revolved bar part could not reach a Star or a Hanwha — the machines this
// shop bought for exactly that work — and was quoted on a machining centre.
describe('bar work can reach the sliding heads', () => {
  const smallBar = {
    isTurned: false as const,
    setupCount: 1, axisAlignedSetups: 1, angledSetups: 0,
    partDimsMm: { x: 8, y: 8, z: 40 }, partVolumeCm3: 1.8,
    onAxisTurnedFeatures: 3, quantity: 1,
  };

  it('a small round bar part is offered to a sliding head at all', () => {
    const r = selectMachine(smallBar);
    const heads = r.candidates.filter((c) => MACHINE_CATALOG[c.id].kind === 'sliding-head');
    expect(heads.length).toBeGreaterThan(0);
    expect(heads.some((c) => c.capable)).toBe(true);
  });

  it('and wins it, rather than a ⌀430-swing mill-turn at twice the rate', () => {
    const r = selectMachine(smallBar);
    expect(MACHINE_CATALOG[r.recommended].kind).toBe('sliding-head');
  });

  it('but a sliding head is a BAR machine — it is never offered chucked work', () => {
    // The 40x40x22 flange chucks from a sawn slug. A Swiss lathe feeds bar
    // through a collet and guide bush; its "max turned ⌀" is not a chuck size.
    const r = selectMachine({
      isTurned: false, setupCount: 2, axisAlignedSetups: 2, angledSetups: 0,
      partDimsMm: { x: 40, y: 40, z: 22 }, partVolumeCm3: 25,
      onAxisTurnedFeatures: 2, quantity: 1,
    });
    expect(MACHINE_CATALOG[r.recommended].kind).toBe('turn-mill');
  });

  it('a machine with no driven tools is not offered work that needs them', () => {
    // This path exists because the part has features a spindle alone cannot cut.
    const r = selectMachine(smallBar);
    const hiTurner = r.candidates.find((c) => c.id === 'hi-turner');
    expect(hiTurner?.capable ?? false).toBe(false);
  });

  it('a lathe is never asked to mill a prismatic block', () => {
    const r = selectMachine({
      isTurned: false, setupCount: 8, angledSetups: 2, axisAlignedSetups: 6, bossCount: 10,
      partDimsMm: { x: 61.487, y: 51.95, z: 47.4 }, partVolumeCm3: 45.088,
    });
    expect(MACHINE_CATALOG[r.recommended].kind).not.toBe('sliding-head');
    expect(MACHINE_CATALOG[r.recommended].kind).not.toBe('lathe');
  });
});
