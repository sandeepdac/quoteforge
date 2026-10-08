import { describe, it, expect } from 'vitest';
import { calculateMilledCosts, type MilledProfile } from './milledEstimator';
import { MACHINE_CATALOG } from './machineSelection';
import { DEFAULT_SHOP_SETTINGS } from '../constants';

/**
 * Deburring and part-off on the MILLED path.
 *
 * Turning had both; milling had neither — a time-conserving "(estimated)" edge
 * break that charged nothing, and no part-off at all on a bar-fed part whose bar
 * length already paid for the parting width. Turncircuit's sheet for
 * OLY014_01921-A spends 150 s deburring and 55 s cutting off.
 *
 * Assertions are about structure — which operations exist, what drives them,
 * and that the money still adds up. None pins a second from the shop's sheet.
 */
const billet = {
  stockMm: { x: 30, y: 20, z: 10 }, stockVolumeCm3: 6, partVolumeCm3: 4,
  removedVolumeCm3: 2, surfaceAreaCm2: 30, setupCount: 1, pocketCount: 1,
  bossCount: 0, deepPocketCount: 0, holeCount: 2,
  holeDiametersMm: [4, 4], holeDepthsMm: [4, 4],
} as MilledProfile;
const bar = {
  ...billet, stockMm: { x: 12, y: 12, z: 20 }, fromBarStock: true, barDiameterMm: 12,
} as MilledProfile;

const run = (profile: MilledProfile, machine: keyof typeof MACHINE_CATALOG = 'ntx-1000') => calculateMilledCosts(
  { materialName: 'Stainless 316', profile, materialPricePerKg: 8.5 },
  10, false, 0.25, DEFAULT_SHOP_SETTINGS, 1, 0, [{ machine: MACHINE_CATALOG[machine], setups: 1 }]);
const ops = (c: ReturnType<typeof run>) => c.plan!.setups.flatMap((s) => s.operations);
const op = (c: ReturnType<typeof run>, name: string) => ops(c).find((o) => o.name === name);

describe('every edge a cutter leaves is deburred', () => {
  it('is a real operation with cutting time, not an allowance', () => {
    const d = op(run(billet), 'Deburr / edge break');
    expect(d).toBeDefined();
    expect(d!.cuttingSeconds!).toBeGreaterThan(0);
    expect(ops(run(billet)).some((o) => o.name === 'Chamfer / edge break (estimated)')).toBe(false);
  });

  it('a through hole has two edges to break, a blind one has one', () => {
    // Same two ⌀4 holes; drilled right through the 10 mm plate they break out
    // and raise a burr on the far side too.
    const blind = op(run(billet), 'Deburr / edge break')!;
    const through = op(run({ ...billet, holeDepthsMm: [10, 10] }), 'Deburr / edge break')!;
    expect(through.cuttingSeconds!).toBeGreaterThan(blind.cuttingSeconds!);
    expect(through.driver).toMatch(/4 hole and feature edges/);
    expect(blind.driver).toMatch(/2 hole and feature edges/);
  });

  it('edges a measured chamfer already broke are not deburred twice', () => {
    const plain = op(run(billet), 'Deburr / edge break')!;
    const chamfered = op(run({ ...billet, chamfers: [{ diameterMm: 4, includedDeg: 90, depthMm: 0.3, count: 2 }] }),
      'Deburr / edge break')!;
    expect(chamfered.driver).toMatch(/0 hole and feature edges/);
    expect(chamfered.cuttingSeconds!).toBeLessThan(plain.cuttingSeconds!);
  });

  it('moving between edges is a hop, charged as idle', () => {
    expect(op(run(billet), 'Deburr / edge break')!.idleSeconds!).toBeGreaterThan(0);
  });
});

describe('a bar-fed part is cut off the bar', () => {
  it('a part from bar gets a part-off, on the bar-fed holding', () => {
    const c = run(bar);
    const p = op(c, 'Part-off');
    expect(p).toBeDefined();
    expect(p!.cuttingSeconds!).toBeGreaterThan(0);
    expect(c.plan!.setups[0].operations.some((o) => o.name === 'Part-off')).toBe(true);
  });

  it('a billet part is not — it was sawn before it reached the machine', () => {
    expect(op(run(billet), 'Part-off')).toBeUndefined();
  });

  it('a bigger bar takes longer to part off', () => {
    const small = op(run(bar), 'Part-off')!.cuttingSeconds!;
    const big = op(run({ ...bar, barDiameterMm: 30, stockMm: { x: 30, y: 30, z: 20 } }), 'Part-off')!.cuttingSeconds!;
    expect(big).toBeGreaterThan(small);
  });
});

describe('the money still adds up', () => {
  for (const [name, profile] of [['billet', billet], ['bar', bar]] as const) {
    it(`${name}: line items sum to the subtotal, and the plan to the machine cost`, () => {
      const c = run(profile);
      expect(c.lineItems.reduce((a, li) => a + li.value, 0)).toBeCloseTo(c.subtotal, 6);
      expect(c.plan!.totalCost).toBeCloseTo(c.machineCost, 6);
    });
  }
});

describe('a bar-fed part starts with the bar stop', () => {
  it('has a no-cutting handling row of the shop bar-handling time, only on bar', () => {
    const b = op(run(bar), 'Bar stop / feed')!;
    expect(b).toBeDefined();
    expect(b.cuttingSeconds).toBe(0);
    expect(b.idleSeconds).toBe(DEFAULT_SHOP_SETTINGS.cnc!.barLoadSec);
    expect(op(run(billet), 'Bar stop / feed')).toBeUndefined();
  });

  it('is not charged a tool change or an approach, and is not counted as a tool', () => {
    const c = run(bar);
    const b = op(c, 'Bar stop / feed')!;
    expect(b.seconds).toBeCloseTo(DEFAULT_SHOP_SETTINGS.cnc!.barLoadSec, 9);
    expect(c.plan!.tools.some((t) => t.name === 'Bar stop')).toBe(false);
  });

  it('is the first thing in the cycle', () => {
    expect(ops(run(bar))[0].name).toBe('Bar stop / feed');
  });

  it('the default is the 30 s both of Lance\'s sheets give', () => {
    expect(DEFAULT_SHOP_SETTINGS.cnc!.barLoadSec).toBe(30);
  });
});
