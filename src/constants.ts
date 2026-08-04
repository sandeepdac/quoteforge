import { CncSettings, ShopSettings } from './types';

/**
 * CNC machining defaults tuned for a small-part precision shop (sliding-head
 * turning + turn-mill), machining metals and plastics. Rates are per-minute;
 * ~£75/hr spindle ≈ 1.25/min. Removal/finishing rates are the MILD-STEEL
 * baseline and get scaled by each material's machinability. Advisory — a shop
 * tunes these to its own machines.
 */
export const DEFAULT_CNC_SETTINGS: CncSettings = {
  machineRatePerMin: 1.25,
  setupRatePerMin: 1.10,
  setupTimeMin: 20,
  baseRemovalRateCm3PerMin: 8,     // mild steel; brass ≈ 28, aluminium ≈ 24, stainless ≈ 3.6
  baseFinishingRateCm2PerMin: 20,  // mild steel; scaled by machinability
  drillTimePerHoleMin: 0.5,
  millingStockAllowanceMm: 3,
  turningStockAllowanceMm: 2,
  turningFacingAllowanceMm: 5,
  inspectionBaseMin: 3,
  inspectionPerHoleMin: 0.4,
  deburrBaseMin: 1.5,
  deburrPerHoleMin: 0.3,
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
