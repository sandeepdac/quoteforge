import { CncSettings, ShopSettings } from './types';

/**
 * CNC TURNING defaults for a small-part precision shop (sliding-head, bar-fed),
 * metals and plastics. Rates per minute (~£75/hr spindle ≈ 1.25/min). Cutting
 * speeds/feeds live in the material table; the efficiency factor calibrates the
 * book-vs-reality gap uniformly. Advisory — a shop tunes these to its machines.
 */
export const DEFAULT_CNC_SETTINGS: CncSettings = {
  machineRatePerMin: 1.25,
  setupRatePerMin: 0.80,
  setupTimeFirstOpMin: 35,
  setupTimePerToolMin: 3,
  secondOpSetupMin: 20,
  efficiencyFactor: 0.8, // actual = theoretical / 0.8 (real shops run below book)
  maxRpm: 6000,
  toolChangeSec: 3,
  barLoadSec: 8,
  toolingCostPerOp: 0.5,
  radialStockAllowanceMm: 2,
  facingAllowanceMm: 2,
  partingWidthMm: 3,
  gripLengthMm: 20,
  scrapRecovery: 0,
};

export const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  name: 'ForgeFab Dynamics',
  address: '500 Fabrication Way, Industrial Park, OH 44101',
  logo: 'https://picsum.photos/seed/forgefabs/200/200',
  rates: {
    laserPerMin: 2.50,
    pressBrakePerMin: 1.80,
    welderPerMin: 1.50,
    assemblyPerMin: 1.20,
    finishRatePerM2: 15.00, // $15 per m2 for powder coat
  },
  speeds: {
    laserCuttingMmPerMin: 3000,
    weldingMmPerMin: 300,
    bendSetupMin: 3,
    bendSimpleMin: 0.4,
    bendCompoundMin: 0.8,
  },
  overheadPercent: 0.12,
  defaultMargin: 0.25,
  rushPremiumPercent: 0.20,
  scrapFactor: 0.15,
  cnc: DEFAULT_CNC_SETTINGS,
};
