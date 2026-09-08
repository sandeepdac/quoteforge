import { describe, it, expect } from 'vitest';
import {
  buildJobRouter,
  plannedJobMinutes,
  actualJobMinutes,
  jobProgress,
  deriveJobStatus,
} from './jobRouter';
import { nextDocNumber } from './idGenerator';
import type { Job, MachiningCosts, SecondaryOperation } from '../types';

/** A machining quote with a 2-setup plan, as the estimator produces. */
const mc = {
  machineClass: 'mill',
  setups: 2,
  setupTimeMin: 90,
  cycleTimeSec: 600,
  plan: {
    setups: [
      {
        index: 1,
        name: 'Setup 1',
        orientation: 'Top',
        seconds: 360,
        cost: 12,
        toolChanges: 3,
        operations: [
          { name: 'Face', tool: '50 mm face mill', seconds: 60, cost: 2, driver: 'footprint', color: '#f59e0b' },
          { name: 'Rough', tool: '12 mm 3F end mill', seconds: 300, cost: 10, driver: 'volume', color: '#2563eb' },
        ],
      },
      {
        index: 2,
        name: 'Setup 2',
        orientation: 'Back',
        seconds: 240,
        cost: 8,
        toolChanges: 2,
        operations: [
          { name: 'Drill', tool: '6 mm drill', seconds: 240, cost: 8, driver: '6 holes', color: '#8b5cf6' },
        ],
      },
    ],
    tools: [],
    totalSeconds: 600,
    totalCost: 20,
  },
} as unknown as MachiningCosts;

const secondary: SecondaryOperation[] = [
  { id: 'anodize-2', name: 'Anodise Type II (colour)', category: 'anodize', lotCharge: 120, perPartCost: 3, leadTimeDays: 7 },
  { id: 'fai', name: 'First-article inspection (FAI)', category: 'inspection', lotCharge: 85, perPartCost: 0.75, leadTimeDays: 2 },
];

describe('buildJobRouter', () => {
  const router = buildJobRouter({
    machiningCosts: mc,
    machineName: 'Multi-Axis Turn-Mill Centre',
    secondaryOps: secondary,
    stockDescription: '⌀45 round bar',
    materialName: 'Aluminium 6082',
    quantity: 10,
  });

  it('brackets the machining plan with material issue, inspection and despatch', () => {
    expect(router[0].name).toBe('Material issue');
    expect(router[0].kind).toBe('material');
    expect(router[router.length - 1].name).toBe('Pack & ship');
    expect(router[router.length - 1].kind).toBe('shipping');
    expect(router.some((o) => o.name === 'Deburr & final inspection')).toBe(true);
  });

  it('creates one machining operation per setup, at the chosen machine', () => {
    const machining = router.filter((o) => o.kind === 'machining');
    expect(machining).toHaveLength(2);
    expect(machining.every((o) => o.workCentre === 'Multi-Axis Turn-Mill Centre')).toBe(true);
    expect(machining[0].name).toBe('Setup 1');
    // 360 s of cutting → 6 min run per part.
    expect(machining[0].runMinPerPart).toBeCloseTo(6, 5);
    expect(machining[1].runMinPerPart).toBeCloseTo(4, 5);
  });

  it('splits the quoted setup time across the setups', () => {
    const machining = router.filter((o) => o.kind === 'machining');
    const totalSetup = machining.reduce((s, o) => s + o.setupMin, 0);
    expect(totalSetup).toBeCloseTo(90, 5); // the quote's setupTimeMin
  });

  it('carries tools and orientation into operator notes', () => {
    const s1 = router.find((o) => o.name === 'Setup 1')!;
    expect(s1.notes).toMatch(/Top/);
    expect(s1.notes).toMatch(/50 mm face mill/);
    expect(s1.notes).toMatch(/12 mm 3F end mill/);
  });

  it('adds secondary ops, routing inspection to the inspection work centre', () => {
    const anodise = router.find((o) => o.name.startsWith('Anodise'))!;
    expect(anodise.kind).toBe('secondary');
    expect(anodise.workCentre).toBe('Subcontract');
    expect(anodise.notes).toMatch(/7 days/);
    const fai = router.find((o) => o.name.startsWith('First-article'))!;
    expect(fai.kind).toBe('inspection');
  });

  it('numbers operations 10, 20, 30 … the way a route sheet does', () => {
    expect(router.map((o) => o.opNumber)).toEqual(router.map((_, i) => (i + 1) * 10));
  });

  it('starts every operation pending', () => {
    expect(router.every((o) => o.status === 'pending')).toBe(true);
  });

  it('still builds a sensible route for a non-machining quote', () => {
    const plain = buildJobRouter({ quantity: 5 });
    expect(plain.length).toBeGreaterThanOrEqual(3);
    expect(plain[0].name).toBe('Material issue');
    expect(plain.some((o) => o.kind === 'machining')).toBe(false);
  });

  it('uses a single machining line when the quote has no per-setup plan', () => {
    const noPlan = buildJobRouter({
      machiningCosts: { ...mc, plan: undefined } as MachiningCosts,
      machineName: 'Sliding-Head (Swiss) Lathe',
      quantity: 100,
    });
    const machining = noPlan.filter((o) => o.kind === 'machining');
    expect(machining).toHaveLength(1);
    expect(machining[0].runMinPerPart).toBeCloseTo(10, 5); // 600 s cycle
    expect(machining[0].setupMin).toBeCloseTo(90, 5);
  });
});

describe('job time roll-ups', () => {
  const router = buildJobRouter({
    machiningCosts: mc,
    machineName: 'Mill',
    stockDescription: 'billet',
    quantity: 10,
  });

  it('planned minutes = setup once + run per part × qty', () => {
    const setup = router.reduce((s, o) => s + o.setupMin, 0);
    const run = router.reduce((s, o) => s + o.runMinPerPart, 0);
    expect(plannedJobMinutes(router, 10)).toBeCloseTo(setup + run * 10, 1);
  });

  it('planned minutes rise with batch size', () => {
    expect(plannedJobMinutes(router, 100)).toBeGreaterThan(plannedJobMinutes(router, 10));
  });

  it('sums logged actual minutes', () => {
    const logged = router.map((o, i) => (i === 0 ? { ...o, actualMin: 12 } : i === 1 ? { ...o, actualMin: 30 } : o));
    expect(actualJobMinutes(logged)).toBeCloseTo(42, 5);
  });

  it('reports progress as the fraction of operations done', () => {
    expect(jobProgress(router)).toBe(0);
    const twoDone = router.map((o, i) => (i < 2 ? { ...o, status: 'done' as const } : o));
    expect(jobProgress(twoDone)).toBeCloseTo(2 / router.length, 6);
    const allDone = router.map((o) => ({ ...o, status: 'done' as const }));
    expect(jobProgress(allDone)).toBe(1);
  });
});

describe('deriveJobStatus', () => {
  const base = (router: Job['router'], status: Job['status']): Job =>
    ({ status, router } as Job);
  const router = buildJobRouter({ quantity: 1 });
  const allDone = router.map((o) => ({ ...o, status: 'done' as const }));
  const someDone = router.map((o, i) => (i === 0 ? { ...o, status: 'done' as const } : o));

  it('stays planned while nothing has started', () => {
    expect(deriveJobStatus(base(router, 'planned'))).toBe('planned');
  });

  it('moves to in-progress once an operation is done', () => {
    expect(deriveJobStatus(base(someDone, 'released'))).toBe('in-progress');
  });

  it('moves to complete when every operation is done', () => {
    expect(deriveJobStatus(base(allDone, 'in-progress'))).toBe('complete');
  });

  it('never overrides a deliberate human state', () => {
    for (const s of ['shipped', 'invoiced', 'closed', 'on-hold', 'cancelled'] as const) {
      expect(deriveJobStatus(base(someDone, s))).toBe(s);
    }
  });
});

describe('nextDocNumber', () => {
  it('starts a fresh series', () => {
    expect(nextDocNumber([], 'JOB')).toBe('JOB-1001');
    expect(nextDocNumber([], 'INV')).toBe('INV-1001');
  });

  it('continues from the highest existing number', () => {
    expect(nextDocNumber(['JOB-1001', 'JOB-1007', 'JOB-1003'], 'JOB')).toBe('JOB-1008');
  });

  it('ignores other series and malformed entries', () => {
    expect(nextDocNumber(['INV-1200', 'JOB-x', '', 'JOB-1002'], 'JOB')).toBe('JOB-1003');
  });
});

describe('a two-machine route reaches the traveller', () => {
  // THE DEFECT THIS PINS. The price has derived setup on each machine the route
  // names since the route work went in; the traveller took a single machine name
  // and stamped it on every machining line. A part routed NTX 1000 -> Mini Mill
  // printed a route sheet telling the floor to do both ops on the NTX, and the
  // second work centre appeared nowhere on the document the shop works from.
  const routed = {
    ...mc,
    setupTimeMin: 640,
    setupByMachine: [
      { machineName: 'DMG Mori NTX 1000 (5-axis Mill-Turn)', setups: 1, setupMin: 365 },
      { machineName: 'H Mini Mill 300', setups: 1, setupMin: 275 },
    ],
  } as unknown as MachiningCosts;

  const router = buildJobRouter({
    machiningCosts: routed,
    machineName: 'DMG Mori NTX 1000 (5-axis Mill-Turn)',
    stockDescription: '⌀32 round bar',
    quantity: 10,
  });
  const machining = router.filter((o) => o.kind === 'machining');

  it('names BOTH machines, not just the primary', () => {
    const centres = machining.map((o) => o.workCentre);
    expect(centres).toContain('DMG Mori NTX 1000 (5-axis Mill-Turn)');
    expect(centres).toContain('H Mini Mill 300');
  });

  it('puts them in route order — the primary first', () => {
    expect(machining[0].workCentre).toBe('DMG Mori NTX 1000 (5-axis Mill-Turn)');
    expect(machining[1].workCentre).toBe('H Mini Mill 300');
  });

  it('charges each machine its OWN setup, not an even split of the total', () => {
    // An even split would put 320 on both lines and tell the mini mill it needs
    // as long to set as the 5-axis mill-turn.
    expect(machining[0].setupMin).toBe(365);
    expect(machining[1].setupMin).toBe(275);
    expect(machining[0].setupMin + machining[1].setupMin).toBe(routed.setupTimeMin);
  });

  it('still travels when a quote carries no route at all', () => {
    // Older saved quotes have no setupByMachine. They must behave exactly as
    // before rather than losing their machining lines.
    const old = buildJobRouter({ machiningCosts: mc, machineName: 'Haas VF-2', quantity: 5 });
    const m = old.filter((o) => o.kind === 'machining');
    expect(m).toHaveLength(2);
    expect(m.every((o) => o.workCentre === 'Haas VF-2')).toBe(true);
    expect(m[0].setupMin + m[1].setupMin).toBeCloseTo(mc.setupTimeMin, 1);
  });

  it('a turned part with no per-setup plan still gets a line per machine', () => {
    const turned = {
      cycleTimeSec: 600, setups: 2, setupTimeMin: 640,
      setupByMachine: [
        { machineName: 'Mori NL 2000 Mill-Turn', setups: 1, setupMin: 303 },
        { machineName: 'Haas VF-2 (4-axis VMC)', setups: 1, setupMin: 228 },
      ],
    } as unknown as MachiningCosts;
    const r = buildJobRouter({ machiningCosts: turned, machineName: 'Mori NL 2000 Mill-Turn', quantity: 1 });
    const m = r.filter((o) => o.kind === 'machining');
    expect(m).toHaveLength(2);
    expect(m.map((o) => o.workCentre)).toEqual(['Mori NL 2000 Mill-Turn', 'Haas VF-2 (4-axis VMC)']);
    expect(m[0].setupMin).toBe(303);
    // The whole part's cycle is accounted for, not counted twice.
    expect(m[0].runMinPerPart + m[1].runMinPerPart).toBeCloseTo(10, 1);
  });
});
