import { describe, it, expect } from 'vitest';
import { deriveSetup, deriveRouteSetup, routeRateMultiplier, DIAL_IN_MIN, PER_EXTRA_AXIS_MIN } from './setupModel';
import { MACHINE_CATALOG } from './machineSelection';

const ntx = MACHINE_CATALOG['ntx-1000'];       // turn-mill, 5 axes, £135/hr
const mini = MACHINE_CATALOG['h-mini-mill-300']; // mill, 3 axes, £40/hr
const drivers = { toolCount: 6, featureCount: 8, cycleMin: 4 };

describe('a route is more than one machine, and each is dialled in', () => {
  it('a second machine is not free', () => {
    // The defect this fixes: `machineRoute` named the Mini Mill, the price only
    // ever saw the NTX, and the Mini Mill's dial-in was charged at zero.
    const oneMachine = deriveRouteSetup([{ machine: ntx, setups: 2 }], drivers);
    const twoMachines = deriveRouteSetup(
      [{ machine: ntx, setups: 1 }, { machine: mini, setups: 1 }], drivers);
    expect(twoMachines.totalMin).toBeGreaterThan(oneMachine.totalMin);
  });

  it('the extra is exactly the second machine\'s dial-in — no more, no less', () => {
    // Everything else about the part is unchanged: same tools to fetch, same
    // features to program, same three proving parts. Only the machine is new.
    const oneMachine = deriveRouteSetup([{ machine: ntx, setups: 2 }], drivers);
    const twoMachines = deriveRouteSetup(
      [{ machine: ntx, setups: 1 }, { machine: mini, setups: 1 }], drivers);
    const miniDialIn = DIAL_IN_MIN[mini.kind] + Math.max(0, mini.axes - 3) * PER_EXTRA_AXIS_MIN;
    expect(twoMachines.totalMin - oneMachine.totalMin).toBe(miniDialIn);
  });

  it('the part is not programmed twice, nor proved twice', () => {
    // Part-driven work is owed ONCE and shared between the ops that do it.
    // Charging each machine the whole part's tool list and all three proving
    // parts would invent work nobody does.
    const split = deriveRouteSetup(
      [{ machine: ntx, setups: 1 }, { machine: ntx, setups: 1 }], drivers);
    const together = deriveRouteSetup([{ machine: ntx, setups: 2 }], drivers);
    // Same machine twice: the ONLY difference is a second dial-in of that machine.
    const ntxDialIn = DIAL_IN_MIN[ntx.kind] + Math.max(0, ntx.axes - 3) * PER_EXTRA_AXIS_MIN;
    expect(split.totalMin - together.totalMin).toBe(ntxDialIn);
  });

  it('one op is exactly the single-machine model — nothing about those parts moves', () => {
    const route = deriveRouteSetup([{ machine: ntx, setups: 3 }], drivers);
    const plain = deriveSetup(ntx, { ...drivers, fixturings: 3 });
    expect(route.totalMin).toBe(plain.totalMin);
    expect(route.explanation).toBe(plain.explanation);
  });

  it('every holding is counted, not just every machine', () => {
    // `ops.length` was the old count, and it caps at two however many clamps a
    // 3-axis part really needs. The ops carry the real number.
    const two = deriveRouteSetup([{ machine: ntx, setups: 1 }, { machine: mini, setups: 1 }], drivers);
    const five = deriveRouteSetup([{ machine: ntx, setups: 1 }, { machine: mini, setups: 4 }], drivers);
    expect(five.totalMin).toBeGreaterThan(two.totalMin);
  });

  it('names both machines, so a quoter can read the answer out loud', () => {
    const r = deriveRouteSetup([{ machine: ntx, setups: 1 }, { machine: mini, setups: 1 }], drivers);
    expect(r.explanation).toContain(ntx.name);
    expect(r.explanation).toContain(mini.name);
    expect(r.perOp).toHaveLength(2);
  });

  it('refuses an empty route rather than pricing one at nothing', () => {
    expect(() => deriveRouteSetup([], drivers)).toThrow();
  });
});

describe('the route rate is weighted, and is NOT what we bill today', () => {
  it('sits between the two machines it names', () => {
    const blended = routeRateMultiplier([{ machine: ntx, setups: 1 }, { machine: mini, setups: 1 }])!;
    expect(blended).toBeLessThan(ntx.rateMultiplier);
    expect(blended).toBeGreaterThan(mini.rateMultiplier);
  });

  it('is the machine\'s own rate when the route names one machine', () => {
    expect(routeRateMultiplier([{ machine: ntx, setups: 4 }])).toBeCloseTo(ntx.rateMultiplier, 9);
  });

  it('has nothing to say about an empty route', () => {
    expect(routeRateMultiplier([])).toBeNull();
  });
});
