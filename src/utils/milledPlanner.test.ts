import { describe, it, expect } from 'vitest';
import { calculateMilledCosts, MilledProfile } from './milledEstimator';
import { DEFAULT_SHOP_SETTINGS } from '../constants';
import {
  millingToolsFor,
  nearestDrill,
  groupHoles,
  roughingTool,
  ALU_MILL_TOOLS,
  STEEL_MILL_TOOLS,
} from './millingTools';
import { materialPropsFor } from './materials';
import { buildMilledPlan } from './milledPlanner';

describe('milling tool library selection', () => {
  it('picks the aluminium set for aluminium, the steel set for ferrous', () => {
    expect(millingToolsFor(materialPropsFor('Aluminium 6082'))).toBe(ALU_MILL_TOOLS);
    expect(millingToolsFor(materialPropsFor('Stainless 316'))).toBe(STEEL_MILL_TOOLS);
    expect(millingToolsFor(materialPropsFor('Mild Steel'))).toBe(STEEL_MILL_TOOLS);
  });

  it('sizes the rougher to the part, not a fixed cutter', () => {
    const big = roughingTool(ALU_MILL_TOOLS, 200); // large plate → biggest rougher
    const small = roughingTool(ALU_MILL_TOOLS, 12); // 3 mm cap → small cutter
    expect(big!.diaMm).toBeGreaterThan(small!.diaMm);
    expect(small!.diaMm).toBeLessThanOrEqual(3.0001);
  });

  it('nearestDrill rounds up to a stocked drill', () => {
    expect(nearestDrill(6.35)).toBe(6.5);
    expect(nearestDrill(3.969)).toBe(4);
    expect(nearestDrill(8.001)).toBe(8.5);
  });
});

describe('groupHoles — one drilling op per size', () => {
  it('buckets holes by nearest drill and preserves the count', () => {
    const groups = groupHoles([6.35, 6.35, 6.35, 3.969, 3.969, 8.001], 6, 20);
    const total = groups.reduce((a, g) => a + g.count, 0);
    expect(total).toBe(6);
    expect(groups.length).toBe(3); // ⌀4, ⌀6.5, ⌀8.5
    expect(groups.every((g) => !g.interpolate)).toBe(true);
  });

  it('flags oversize holes to be bored/interpolated, not drilled', () => {
    const groups = groupHoles([25, 25, 6], 3, 20);
    const big = groups.find((g) => g.interpolate);
    expect(big).toBeDefined();
    expect(big!.count).toBe(2);
  });

  it('falls back to a single generic group when diameters are unknown', () => {
    expect(groupHoles(undefined, 4, 20)).toEqual([{ drillMm: 6, count: 4, interpolate: false }]);
    expect(groupHoles(undefined, 0, 20)).toEqual([]);
  });
});

describe('milled plan reads like a CAM operation sheet', () => {
  const profile: MilledProfile = {
    stockMm: { x: 190, y: 6.35, z: 280 },
    stockVolumeCm3: 338,
    partVolumeCm3: 136,
    removedVolumeCm3: 202,
    surfaceAreaCm2: 400,
    setupCount: 2,
    pocketCount: 1,
    bossCount: 4,
    deepPocketCount: 0,
    holeCount: 6,
    holeDiametersMm: [6.35, 6.35, 8.001, 8.001, 3.969, 25], // ⌀25 > maxDrill → bored
  };
  const c = calculateMilledCosts(
    { materialName: 'Aluminium 6082', profile, materialPricePerKg: 16.5 },
    1, false, 0.25, DEFAULT_SHOP_SETTINGS
  );
  const ops = c.plan!.setups.flatMap((s) => s.operations);
  const names = ops.map((o) => o.name);

  it('assigns real tools from the shop library', () => {
    expect(ops.find((o) => o.name === 'Facing')!.tool).toMatch(/Face/);
    // Every op carries a concrete tool string.
    expect(ops.every((o) => o.tool.length > 0)).toBe(true);
    // The face mill is the 40 mm Dodeka from the aluminium library.
    expect(ops.some((o) => /40mm/.test(o.tool))).toBe(true);
  });

  it('emits one drilling operation per hole size', () => {
    const drills = names.filter((n) => n.startsWith('Drilling'));
    // ⌀6.5, ⌀8.5, ⌀4 → three distinct drill ops; ⌀19.05 is bored/interpolated.
    expect(drills.length).toBe(3);
    expect(names.some((n) => n.startsWith('Bore / interpolate'))).toBe(true);
  });

  it('breaks roughing into adaptive + rest, and finishing into walls/floors + chamfer', () => {
    expect(names).toContain('Adaptive roughing');
    expect(names).toContain('Rest roughing');
    expect(names).toContain('Wall finishing');
    expect(names).toContain('Floor finishing');
    // No chamfer GEOMETRY in this profile, so the plan reserves an allowance and
    // says so. Conical faces were invisible to the analyser until recently, and
    // "there are holes, someone breaks the edges" was all it could honestly say.
    expect(names).toContain('Chamfer / edge break (estimated)');
  });

  it('groups work into the measured number of setups', () => {
    expect(c.plan!.setups.length).toBe(2);
    expect(c.plan!.setups.every((s) => s.operations.length > 0)).toBe(true);
  });
});

describe('no phantom setups — work is distributed, not piled into setup 1', () => {
  // Part 12630: geometry measured 5 access directions on a small feature-dense
  // part. The plan must fill all 5 with real cutting, not leave 4 facing-only.
  const dense12630: MilledProfile = {
    stockMm: { x: 33.4, y: 10.1, z: 25.4 }, stockVolumeCm3: 8.57, partVolumeCm3: 3.44,
    removedVolumeCm3: 5.13, surfaceAreaCm2: 38, setupCount: 5,
    pocketCount: 0, bossCount: 10, deepPocketCount: 0, holeCount: 15,
    holeDiametersMm: [1.5, 1.6, 2.2, 2.4, 2.4, 4, 4, 4, 4.5, 4.5, 5, 5, 6, 6, 1.4],
  };
  const run = (p: MilledProfile) =>
    calculateMilledCosts({ materialName: 'Aluminium 6082', profile: p, materialPricePerKg: 16.5 }, 1, false, 0.25, DEFAULT_SHOP_SETTINGS);

  it('fills every one of the 5 setups with a substantive operation', () => {
    const c = run(dense12630);
    expect(c.plan!.setups.length).toBe(5);
    const facingOnly = c.plan!.setups.filter((s) => s.operations.every((o) => o.name === 'Facing'));
    expect(facingOnly.length).toBe(0);
    // and the estimator BILLS on the same 5 (setup line reflects the real count)
    expect(c.setups).toBe(5);
  });

  it('never claims more setups than there is distinct work to fill', () => {
    // Ask for 8 setups on a part with only a couple of real operations.
    const sparse: MilledProfile = {
      ...dense12630, setupCount: 8, holeCount: 1, holeDiametersMm: [4],
      surfaceAreaCm2: 12, bossCount: 0,
    };
    const c = run(sparse);
    expect(c.plan!.setups.length).toBeLessThan(8);
    expect(c.plan!.setups.every((s) => s.operations.length > 0)).toBe(true);
    expect(c.setups).toBe(c.plan!.setups.length); // billing matches the shown plan
  });
});

// --- Conical work: measured, not assumed ----------------------------------
// The analyser read only planes and cylinders, so every countersink and chamfer
// on every part quoted cost nothing. Now they are measured — which also means
// the plan can distinguish a real chamfer from an allowance for one.
describe('countersinks and chamfers come off the solid', () => {
  const base = {
    m: materialPropsFor('Aluminium 6082'),
    minPlaneDimMm: 40,
    facingSec: 20, roughBaseSec: 60, finishBaseSec: 80,
    roughComplexSec: 0, finishComplexSec: 0, drillSec: 30,
    removedVolCm3: 20, millMrr: 60, finishAreaCm2: 50, finishRate: 40,
    holeCount: 4, holeDiametersMm: [6, 6, 6, 6], maxDrillMm: 20,
    bossCount: 0, setups: 1, eff: 0.8,
    opCost: (sec: number) => sec / 60,
    toolChangeSec: 10,
    colors: { rough: '#1', finish: '#2', drill: '#3', deep: '#4', facing: '#5', turn: '#6' },
  };

  it('names a measured countersink with the tool a programmer would pick', () => {
    const plan = buildMilledPlan({
      ...base,
      countersinkSec: 12,
      countersinks: [{ diameterMm: 9.34, includedDeg: 90, depthMm: 1.9, count: 4 }],
    });
    const ops = plan.setups.flatMap((s) => s.operations);
    const cs = ops.find((o) => o.name.startsWith('Countersink'))!;
    expect(cs).toBeTruthy();
    expect(cs.tool).toMatch(/90° countersink/);
    expect(cs.driver).toMatch(/4 countersinks/);
  });

  it('a measured chamfer is additive work, not a slice of the finish budget', () => {
    const withOut = buildMilledPlan(base);
    const withCham = buildMilledPlan({
      ...base,
      chamferSec: 15,
      chamfers: [{ diameterMm: 6, includedDeg: 90, depthMm: 0.5, count: 4 }],
    });
    const nameOf = (p: typeof withOut) => p.setups.flatMap((s) => s.operations).map((o) => o.name);
    // Measured → named plainly; unmeasured → labelled as the allowance it is.
    expect(nameOf(withCham)).toContain('Chamfer / edge break');
    expect(nameOf(withOut)).toContain('Chamfer / edge break (estimated)');
    // The allowance is carved out of wall finishing; the measured one is not.
    const wall = (p: typeof withOut) =>
      p.setups.flatMap((s) => s.operations).find((o) => o.name === 'Wall finishing')!.seconds;
    expect(wall(withCham)).toBeGreaterThan(wall(withOut));
  });

  it('does not invent a countersink when the solid has none', () => {
    const plan = buildMilledPlan(base);
    expect(plan.setups.flatMap((s) => s.operations).some((o) => /Countersink/.test(o.name))).toBe(false);
  });
});
