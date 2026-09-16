import { describe, it, expect } from 'vitest';
import { calculateMilledCosts } from './milledEstimator';
import { MACHINE_CATALOG, TOOL_CHANGE_SEC } from './machineSelection';
import { DEFAULT_SHOP_SETTINGS } from '../constants';

/**
 * MILLING AT PARITY WITH TURNING.
 *
 * Four of the seven calibration parts are milled, and none of the turning cycle
 * work had reached them: a flat 10 s tool change for every machine on the floor,
 * a "rapid allowance" of 8% of cutting time, and no spot drilling at all. The
 * two halves of the same app disagreed about physics.
 */
const profile = {
  stockMm: { x: 60, y: 40, z: 25 }, stockVolumeCm3: 60, partVolumeCm3: 34,
  removedVolumeCm3: 26, surfaceAreaCm2: 120, setupCount: 2, pocketCount: 2,
  bossCount: 1, deepPocketCount: 0, holeCount: 6,
  holeDiametersMm: [6, 6, 6, 10, 10, 3], holeDepthsMm: [25, 25, 25, 12, 12, 8],
} as never;

const run = (id?: keyof typeof MACHINE_CATALOG) => calculateMilledCosts(
  { materialName: 'Aluminium 6082', profile, materialPricePerKg: 6.5 },
  1, false, 0.25, DEFAULT_SHOP_SETTINGS, 1, 0,
  id ? [{ machine: MACHINE_CATALOG[id], setups: 2 }] : undefined);

describe('a milled part is timed by the machine that makes it', () => {
  it('a faster-rapid machine cycles the same part quicker', () => {
    // H Mini Mill rapids at 20 m/min, the VF-2 at 10.2. Identical geometry and
    // cutting; the difference is entirely non-cutting travel.
    expect(run('h-mini-mill-300').cycleTimeSec).toBeLessThan(run('haas-vf2').cycleTimeSec);
  });

  it('a turn-mill changing tools in 3s beats a machining centre at 5s', () => {
    expect(run('ntx-1000').cycleTimeSec).toBeLessThan(run('sabre').cycleTimeSec);
  });

  it('choosing any machine beats the 10s / 10 m/min placeholder', () => {
    const placeholder = run().cycleTimeSec;
    for (const id of ['h-mini-mill-300', 'haas-vf2', 'sabre', 'ntx-1000'] as const) {
      expect(run(id).cycleTimeSec, id).toBeLessThan(placeholder);
    }
  });

  it('the non-cutting line quotes the machine\'s figures, not the shop default', () => {
    const row = run('ntx-1000').lineItems.find((li) => li.key === 'noncut')!;
    expect(row.driver).toMatch(new RegExp(`\\u00d7 ${TOOL_CHANGE_SEC['turn-mill']}s`));
    expect(row.driver).toMatch(/approaches/);
    expect(row.driver).toMatch(/40 m\/min/);
  });
});

describe('milling charges the moves it actually makes', () => {
  it('holes are spotted before they are drilled', () => {
    // Same rule as turning: a twist drill wanders until its margins engage.
    const withHoles = run('haas-vf2');
    const noHoles = calculateMilledCosts(
      { materialName: 'Aluminium 6082',
        profile: { ...(profile as object), holeCount: 0, holeDiametersMm: [], holeDepthsMm: [] } as never,
        materialPricePerKg: 6.5 },
      1, false, 0.25, DEFAULT_SHOP_SETTINGS, 1, 0,
      [{ machine: MACHINE_CATALOG['haas-vf2'], setups: 2 }]);
    expect(withHoles.cycleTimeSec).toBeGreaterThan(noHoles.cycleTimeSec);
  });

  it('approach scales with the NUMBER of operations, not with cutting time', () => {
    // The 8% allowance could not tell a part with many short operations from one
    // with a few long ones — and it shrank when the cutter got faster, which is
    // backwards. More features must mean more approaches.
    const few = calculateMilledCosts(
      { materialName: 'Aluminium 6082',
        profile: { ...(profile as object), holeCount: 1, holeDiametersMm: [6], holeDepthsMm: [25] } as never,
        materialPricePerKg: 6.5 },
      1, false, 0.25, DEFAULT_SHOP_SETTINGS, 1, 0, [{ machine: MACHINE_CATALOG['haas-vf2'], setups: 2 }]);
    const many = run('haas-vf2');
    expect(many.cycleTimeSec).toBeGreaterThan(few.cycleTimeSec);
  });

  it('the plan and the price still agree after all of it', () => {
    const c = run('haas-vf2');
    const sum = c.lineItems.reduce((a, li) => a + li.value, 0);
    expect(sum).toBeCloseTo(c.subtotal, 6);
    expect(Number.isFinite(c.cycleTimeSec)).toBe(true);
  });

  it('a part with no route still prices, on the shop settings', () => {
    const c = run();
    expect(Number.isFinite(c.cycleTimeSec)).toBe(true);
    expect(c.cycleTimeSec).toBeGreaterThan(0);
    const sum = c.lineItems.reduce((a, li) => a + li.value, 0);
    expect(sum).toBeCloseTo(c.subtotal, 6);
  });
});
