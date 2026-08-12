import { CncSettings, ShopSettings, ShopTool } from './types';

/**
 * Default turning tool library for a sliding-head bar shop. Editable per shop in
 * Settings → Tooling; the reference toolpath + G-code use these stations/tools.
 * Facing and roughing share the OD tool; finishing runs a sharper insert.
 */
export const DEFAULT_TURNING_TOOLS: ShopTool[] = [
  { op: 'face', station: 'T0101', description: 'OD rough — DCLNR + CNMG 120408-PM', noseRadiusMm: 0.8 },
  { op: 'rough', station: 'T0101', description: 'OD rough — DCLNR + CNMG 120408-PM', noseRadiusMm: 0.8 },
  { op: 'drill', station: 'T0202', description: 'Carbide drill (pilot / through)' },
  { op: 'bore', station: 'T0505', description: 'Boring bar — CCGT 060204 (opens bore to size)', noseRadiusMm: 0.4 },
  { op: 'finish', station: 'T0303', description: 'OD finish — SDJCR + DCGT 070204-AL', noseRadiusMm: 0.4 },
  { op: 'partoff', station: 'T0404', description: 'Part-off blade — 3 mm insert' },
];

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
  flatSetupChargePerSetup: 0, // off by default; set to your per-setup charge (e.g. 150) to match CAM-quote billing
  setupBillingMode: 'both',   // 'time' | 'flat' | 'both' — how the flat charge combines with time labour

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
  maxDrillDiaMm: 20,
  // Milling runs on different iron from the bar lathe above: a VMC spindle turns
  // much faster, an ATC change is slower than a turret index, and clamping a
  // billet (vise/soft jaws, tram, probe, touch-off) takes longer than bar-feeding.
  millMaxRpm: 12000,
  // millToolDiaMm intentionally unset — the roughing cutter is sized to the part
  // (see roughingToolDiaMm). Set it only to pin every job to one cutter.
  millToolChangeSec: 10,
  millSetupFirstOpMin: 60,
  millSetupPerExtraOpMin: 45,
  toolLibrary: DEFAULT_TURNING_TOOLS,
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
