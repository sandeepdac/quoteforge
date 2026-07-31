import { ShopSettings } from './types';

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
};
