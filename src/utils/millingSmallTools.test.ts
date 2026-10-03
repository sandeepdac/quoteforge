import { describe, it, expect } from 'vitest';
import {
  millingMrrCm3PerMin, finishingRateCm2PerMin, chipLoadMm, chipLoadDiameterFactor,
  CHIP_LOAD_REF_DIA_MM, DEFAULT_MILLING_TOOL,
} from './milling';
import {
  millingToolsFor, roughingTool, wallFinisher, floorFinisher, toolChipLoadMm,
} from './millingTools';
import { calculateMilledCosts, type MilledProfile } from './milledEstimator';
import { materialPropsFor } from './materials';
import { DEFAULT_SHOP_SETTINGS } from '../constants';

/**
 * A SMALL CUTTER TAKES A SMALL CHIP — and the clock times the cutter the
 * traveller names.
 *
 * Every milling cutter used to be fed at the material table's single chip load,
 * a figure for a ~10 mm tool, and roughing was timed with a formula cutter of at
 * least 6 mm while the plan named 3 mm and 1.5 mm ones. Turncircuit's sheet for
 * OLY014_01921-A spends 702 s milling with 1.0-2.5 mm end mills.
 *
 * The assertions are relations taken from the tool library's own catalogue
 * entries, not seconds from the shop's sheet.
 */
const s316 = materialPropsFor('Stainless 316');
const alu = materialPropsFor('Aluminium 6082');

describe('chip load falls with diameter', () => {
  it('with no tool known, the table value is scaled below the reference size', () => {
    expect(chipLoadDiameterFactor(CHIP_LOAD_REF_DIA_MM)).toBe(1);
    expect(chipLoadDiameterFactor(3)).toBeCloseTo(0.3, 9);
    // Never grown above the table for a big cutter.
    expect(chipLoadDiameterFactor(20)).toBe(1);
  });

  it('a library cutter uses its own catalogue entry, at the table level', () => {
    const tools = millingToolsFor(s316);
    const ten = tools.find((t) => t.type === 'flat' && t.diaMm === 10)!;
    const three = tools.find((t) => t.type === 'flat' && t.diaMm === 3)!;
    // The ~10 mm flat IS the table value: big-cutter timing is unchanged.
    expect(toolChipLoadMm(ten, s316, tools)).toBeCloseTo(s316.feedPerToothMm, 9);
    // The 3 mm flat takes the fraction of it the catalogue says.
    expect(toolChipLoadMm(three, s316, tools)).toBeCloseTo(s316.feedPerToothMm * three.fz / ten.fz, 9);
    expect(toolChipLoadMm(three, s316, tools)).toBeLessThan(0.4 * s316.feedPerToothMm);
  });

  it('the material still sets the level: 316 takes a lighter chip than aluminium', () => {
    const steelTools = millingToolsFor(s316);
    const aluTools = millingToolsFor(alu);
    const t316 = steelTools.find((t) => t.type === 'flat' && t.diaMm === 3)!;
    const tAlu = aluTools.find((t) => t.type === 'flat' && t.diaMm === 3)!;
    expect(toolChipLoadMm(t316, s316, steelTools)).toBeLessThan(toolChipLoadMm(tAlu, alu, aluTools));
  });

  it('a small cutter removes metal far more slowly than its diameter alone implies', () => {
    const at = (d: number) => millingMrrCm3PerMin(s316, { ...DEFAULT_MILLING_TOOL, toolDiaMm: d });
    // ae and ap scale with D, so geometry alone gives D^2 / (rpm-limited) D.
    // With the chip load falling too, a 3 mm cutter is well under a tenth of a 10.
    expect(at(3) / at(10)).toBeLessThan(0.1);
    expect(chipLoadMm(s316, { ...DEFAULT_MILLING_TOOL, toolDiaMm: 3 })).toBeLessThan(s316.feedPerToothMm);
    expect(finishingRateCm2PerMin(s316, { ...DEFAULT_MILLING_TOOL, toolDiaMm: 1.5 }))
      .toBeLessThan(finishingRateCm2PerMin(s316, { ...DEFAULT_MILLING_TOOL, toolDiaMm: 10 }));
  });
});

describe('the finishers fit the part', () => {
  it('the floor finisher is never bigger than the rougher', () => {
    const tools = millingToolsFor(s316);
    const rough = roughingTool(tools, 6.9)!;     // a 6 mm-class part
    const floor = floorFinisher(tools, rough)!;
    expect(floor.diaMm).toBeLessThanOrEqual(rough.diaMm);
    expect(wallFinisher(tools, rough)!.diaMm).toBeLessThan(rough.diaMm);
  });
});

describe('the clock times the cutter the traveller names', () => {
  const small = {
    stockMm: { x: 8, y: 9, z: 10 }, stockVolumeCm3: 0.7, partVolumeCm3: 0.4, removedVolumeCm3: 0.3,
    surfaceAreaCm2: 4, setupCount: 1, pocketCount: 1, bossCount: 0, deepPocketCount: 0, holeCount: 0,
  } as MilledProfile;
  const big = {
    stockMm: { x: 120, y: 90, z: 40 }, stockVolumeCm3: 432, partVolumeCm3: 300, removedVolumeCm3: 132,
    surfaceAreaCm2: 300, setupCount: 1, pocketCount: 2, bossCount: 0, deepPocketCount: 0, holeCount: 0,
  } as MilledProfile;
  const run = (profile: MilledProfile) => calculateMilledCosts(
    { materialName: 'Stainless 316', profile, materialPricePerKg: 8.5 }, 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
  const row = (c: ReturnType<typeof run>, name: string) =>
    c.plan!.setups.flatMap((s) => s.operations).find((o) => o.name === name)!;

  it('a small part is roughed with a small cutter, named on the plan', () => {
    const r = row(run(small), 'Adaptive roughing');
    expect(r.tool).toMatch(/\b3mm\b/);
  });

  it('removing the same volume takes longer with the small part\'s cutter', () => {
    // Per cm³ removed, the small part's 3 mm rougher is far slower than the big
    // part's 10-12 mm one — which a single formula cutter could not express.
    const perCm3 = (p: MilledProfile) => row(run(p), 'Adaptive roughing').cuttingSeconds! / p.removedVolumeCm3;
    expect(perCm3(small)).toBeGreaterThan(5 * perCm3(big));
  });
});
