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
    expect(names).toContain('Chamfer / edge break'); // holes present → edge break
  });

  it('groups work into the measured number of setups', () => {
    expect(c.plan!.setups.length).toBe(2);
    expect(c.plan!.setups.every((s) => s.operations.length > 0)).toBe(true);
  });
});
