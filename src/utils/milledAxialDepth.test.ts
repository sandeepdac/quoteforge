import { describe, it, expect } from 'vitest';
import { calculateMilledCosts, type MilledProfile } from './milledEstimator';
import { MACHINE_CATALOG } from './machineSelection';
import { DEFAULT_SHOP_SETTINGS } from '../constants';

/**
 * The axial depth of a milling roughing pass is a shop setting.
 *
 * Lance's programs take 0.17-0.25 x the cutter diameter per pass (a 3 mm end
 * mill at 0.5 mm in 316; an 8 mm at 2 mm in aluminium) where the model assumed
 * 0.8. The default is unchanged; the setting lets a shop use its own.
 */
const profile = {
  stockMm: { x: 40, y: 30, z: 20 }, stockVolumeCm3: 24, partVolumeCm3: 6,
  removedVolumeCm3: 18, surfaceAreaCm2: 40, setupCount: 1, pocketCount: 1,
  bossCount: 0, deepPocketCount: 0, holeCount: 0,
} as MilledProfile;

const rough = (millAxialFactor?: number) => {
  const settings = { ...DEFAULT_SHOP_SETTINGS, cnc: { ...DEFAULT_SHOP_SETTINGS.cnc!, millAxialFactor } };
  const c = calculateMilledCosts(
    { materialName: 'Aluminium 6082', profile, materialPricePerKg: 6.5 },
    1, false, 0.25, settings, 1, 0, [{ machine: MACHINE_CATALOG['ntx-1000'], setups: 1 }]);
  return c.plan!.setups.flatMap((s) => s.operations).find((o) => /roughing/i.test(o.name))!.cuttingSeconds!;
};

describe('millAxialFactor', () => {
  it('shallower passes take proportionally longer to rough', () => {
    expect(rough(0.2) / rough(0.8)).toBeCloseTo(4, 6);
  });

  it('left unset, it is the old full-flute-depth 0.8', () => {
    expect(rough(undefined)).toBeCloseTo(rough(0.8), 9);
  });
});
