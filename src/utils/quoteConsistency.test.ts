import { describe, expect, it } from 'vitest';
import { DEFAULT_SHOP_SETTINGS } from '../constants';
import type { MachiningCosts, Quote } from '../types';
import { calculateMilledCosts, type MilledProfile } from './milledEstimator';
import { calculateMachiningCosts } from './cncEstimator';
import { resolveQuoteCosts } from './quoteCosts';
import type { ExtractedCadAnalysis } from './cadAnalyzer';
import { buildJobRouter } from './jobRouter';
import { restoreReviewState } from './quoteReviewState';
import { MACHINE_CATALOG } from './machineSelection';

const profile: MilledProfile = {
  stockMm: { x: 60, y: 40, z: 25 }, stockVolumeCm3: 60,
  partVolumeCm3: 25, removedVolumeCm3: 35, surfaceAreaCm2: 120,
  setupCount: 2, pocketCount: 1, bossCount: 1, deepPocketCount: 0,
  holeCount: 3, holeDiametersMm: [8, 5, 2], holeDepthsMm: [20, 12, 6],
};
const turningProfile = {
  odMm: 20, lengthMm: 100, boreDiaMm: 8, boreDepthMm: 60,
  grooveCount: 0, threadCount: 0, faceCount: 2, crossFeatures: false,
};
const settings = DEFAULT_SHOP_SETTINGS;
const route = [
  { machine: MACHINE_CATALOG['ntx-1000'], setups: 1 },
  { machine: MACHINE_CATALOG['h-mini-mill-300'], setups: 1 },
];
const runMill = (p = profile, withRoute = false) => calculateMilledCosts(
  { materialName: 'Aluminium 6082', profile: p, materialPricePerKg: 16.5 },
  10, false, .25, settings, 1, 0, withRoute ? route : undefined,
);

describe('quote consistency regressions', () => {
  it.each([true, false])('material changes preserve CAD volume (turned=%s)', (isTurned) => {
    const cadAnalysis = { isTurned, volumeCm3: 25, turningProfile, milledProfile: profile } as ExtractedCadAnalysis;
    for (const materialName of ['Aluminium 6082', 'Stainless 316']) {
      const result = resolveQuoteCosts({ cadAnalysis,
        features: { weightKg: .0675 } as never, materialName, materialPricePerKg: 10,
        quantity: 1, isRush: false, margin: .25, settings });
      expect(result.machiningCosts!.partVolumeCm3).toBe(25);
    }
  });

  it('prices the supplied billet even when yield is very low', () => {
    const c = runMill({ ...profile, partVolumeCm3: 1, removedVolumeCm3: 59 });
    expect(c.stockVolumeCm3).toBe(60);
    expect(c.removedVolumeCm3).toBe(59);
    expect(c.nearNetStock).toBe(false);
    expect(c.stockMm).toEqual(profile.stockMm);
  });

  it.each([1, .001])('keeps cycle, plan and line costs consistent at volume scale %s', (scale) => {
    const c = runMill({ ...profile, surfaceAreaCm2: 120 * scale,
      partVolumeCm3: 25 * scale, stockVolumeCm3: 60 * scale });
    expect(Math.abs(c.cycleTimeSec - c.plan!.totalSeconds)).toBeLessThanOrEqual(.5);
    expect(c.plan!.totalCost).toBeCloseTo(c.machineCost, 8);
    expect(c.lineItems.reduce((sum, line) => sum + line.value, 0)).toBeCloseTo(c.subtotal, 2);
    const tools = c.plan!.tools.length;
    expect(c.lineItems.find((line) => line.key === 'noncut')!.driver).toContain(`${tools} tools`);
  });

  it.each(['mill', 'turn'])('charges derived programming once and removes it on repeat (%s)', (kind) => {
    const c = kind === 'mill' ? runMill(profile, true) : calculateMachiningCosts({
      isTurned: true, materialName: 'Aluminium 6082', volumeCm3: 25,
      profile: turningProfile, materialPricePerKg: 16.5, setups: 2,
    }, 10, false, .25, settings, 1, 0, route);
    expect(c.nreCost).toBeGreaterThan(0);
    expect(c.setupByMachine!.reduce((sum, row) => sum + row.setupMin, 0)).toBeCloseTo(c.setupTimeMin, 6);
    const first = c.subtotal + c.overhead + c.marginAmount;
    expect(first - c.repeatUnitPrice!).toBeCloseTo(c.nreCost! / 10 * (1 + settings.overheadPercent) * 1.25, 6);
    expect(c.lineItems.reduce((sum, line) => sum + line.value, 0)).toBeCloseTo(c.subtotal, 2);
    const programming = c.lineItems.find((line) => line.key === 'nre')!;
    // Changing the legacy per-setup NRE knob cannot add a second charge when
    // programming has already been derived from the route's features.
    const changed = { ...settings, cnc: { ...settings.cnc!, programmingMinPerSetup: 999 } };
    const rerun = kind === 'mill' ? calculateMilledCosts({materialName:'Aluminium 6082', profile, materialPricePerKg:16.5},10,false,.25,changed,1,0,route)
      : calculateMachiningCosts({isTurned:true,materialName:'Aluminium 6082',volumeCm3:25,profile:turningProfile,materialPricePerKg:16.5,setups:2},10,false,.25,changed,1,0,route);
    expect(rerun.lineItems.find((line) => line.key === 'nre')!.value).toBe(programming.value);
  });

  it('retains every priced machine when the display plan has fewer setups', () => {
    const c = { setupTimeMin: 640, cycleTimeSec: 60, lineItems: [],
      setupByMachine: [
        { machineName: 'NTX', setups: 1, setupMin: 365 },
        { machineName: 'Mini Mill', setups: 1, setupMin: 275 },
      ], plan: { setups: [{ index: 1, name: 'Op 1', seconds: 60, operations: [] }] },
    } as unknown as MachiningCosts;
    const rows = buildJobRouter({ quantity: 1, machiningCosts: c }).filter((op) => op.kind === 'machining');
    expect(rows.map((op) => op.workCentre)).toEqual(['NTX', 'Mini Mill']);
    expect(rows.reduce((sum, op) => sum + op.setupMin, 0)).toBe(640);
    expect(rows[1].notes).toContain('REVIEW REQUIRED');
  });

  it('does not reduce a deep large bore to a volume-only allowance', () => {
    const bore = { ...profile, setupCount: 1, holeCount: 0,
      turnedFeatures: [{ kind: 'bore' as const, diameterMm: 17, lengthMm: 80 }],
      turningRoute: true };
    const c = runMill(bore);
    const turning = c.lineItems.find((line) => line.key === 'turning');
    expect(turning).toBeDefined();
    expect(turning!.driver.toLowerCase()).toContain('bore');
    expect(c.plan!.setups.flatMap((s) => s.operations).some((op) => op.name.includes('Bore'))).toBe(true);
    expect(c.cycleTimeSec).toBeGreaterThan(0);
  });

  it('prices each milling holding at its route machine rate', () => {
    const routed = runMill(profile, true);
    const primaryOnly = runMill(profile, false);
    expect(routed.machineCost).not.toBeCloseTo(primaryOnly.machineCost, 5);
    expect(routed.lineItems.find((line) => line.key === 'machine-rate')?.driver).toContain('H Mini Mill');
    expect(routed.lineItems.reduce((sum, line) => sum + line.value, 0)).toBeCloseTo(routed.subtotal, 2);
    expect(Math.abs(routed.plan!.totalSeconds - routed.cycleTimeSec)).toBeLessThan(1);
  });

  it('uses the weighted route rate for turned runtime', () => {
    const primary = calculateMachiningCosts({ isTurned: true, materialName: 'Aluminium 6082',
      volumeCm3: 25, profile: turningProfile, materialPricePerKg: 16.5, setups: 2 },
      10, false, .25, settings, 1.8, 0, route);
    const primaryOnly = calculateMachiningCosts({ isTurned: true, materialName: 'Aluminium 6082',
      volumeCm3: 25, profile: turningProfile, materialPricePerKg: 16.5, setups: 2 },
      10, false, .25, settings, 1.8);
    expect(primary.machineCost).toBeLessThan(primaryOnly.machineCost);
  });

  it('restores saved review choices, including operations removed from the catalogue', () => {
    const quote = { marginPercent: .37, notes: 'Retain inspection', secondaryOps: [
      { id: 'special', name: 'Special inspection', category: 'inspection', lotCharge: 90, perPartCost: 2 },
    ] } as Quote;
    expect(restoreReviewState(quote, [])).toEqual({ margin: .37, notes: quote.notes, secondaryOps: quote.secondaryOps });
  });

  it('recovers legacy secondary selections from saved costs', () => {
    const quote = { marginPercent: .25, notes: '', machiningCosts: { lineItems: [
      { key: 'secondary', name: 'Gold plating', value: 20 },
    ] } } as Quote;
    expect(restoreReviewState(quote, []).secondaryOps[0].name).toBe('Gold plating');
    expect(restoreReviewState(quote, []).secondaryOps[0].perPartCost).toBe(20);
    expect(restoreReviewState(quote, []).warning).toContain('Confirm');
  });
});
