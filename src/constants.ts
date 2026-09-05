import { CncSettings, SecondaryOperation, ShopSettings, ShopTool } from './types';
import { ALL_MACHINE_IDS } from './utils/machineSelection';

/**
 * A shop's default finishing / inspection catalogue. These are the non-machining
 * work centres a job routes through (TurnCircuit's op 60 SCANOD plate, op 70
 * inspection). Editable per shop in Settings → Secondary Ops.
 */
export const DEFAULT_SECONDARY_OPS: SecondaryOperation[] = [
  { id: 'plate-gold', name: 'Gold plate 2µm (subcon)', category: 'plating', lotCharge: 200, perPartCost: 2.5, leadTimeDays: 10 },
  { id: 'anodize-2', name: 'Anodise Type II (colour)', category: 'anodize', lotCharge: 120, perPartCost: 3.0, leadTimeDays: 7 },
  { id: 'anodize-3', name: 'Hard anodise Type III', category: 'anodize', lotCharge: 150, perPartCost: 5.0, leadTimeDays: 7 },
  { id: 'passivate', name: 'Passivate (stainless)', category: 'passivate', lotCharge: 90, perPartCost: 1.5, leadTimeDays: 5 },
  { id: 'heat-treat', name: 'Heat treat / temper', category: 'heattreat', lotCharge: 180, perPartCost: 4.0, leadTimeDays: 10 },
  { id: 'fai', name: 'First-article inspection (FAI)', category: 'inspection', lotCharge: 85, perPartCost: 0.75, leadTimeDays: 2 },
];

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
/**
 * CALIBRATION — what is switched on, and why the rest is not.
 *
 * Seven job sheets say Lance charges a FLAT £30/hr (£38 for two-machine routes),
 * and that setup time is a property of the machine (120-900 min) rather than of
 * the part. Both findings are solid. Only ONE of them is in the price, because
 * they were measured separately and only one improved the answer.
 *
 *   spread (worst/best price error over the seven parts, lower is better)
 *     shipped engine                                6.8
 *     + flat £30/hr rate alone                      8.8   <- WORSE
 *     + two-op rate uplift alone                    7.8   <- worse
 *     + setup from the route alone                  3.5   <- SHIPPED
 *     + all three together                          3.8   <- worse than route alone
 *
 * Setup from the route is live (see quoteCosts.ts). It also removed the
 * systematic low bias: errors now straddle 1.0 instead of every part being
 * under-quoted, and six of eight lines sit within 25% of Lance's booked setup.
 *
 * The rate is deliberately NOT flattened. It looks obviously right and measures
 * obviously wrong, and the reason is visible in the same table: our CYCLE time
 * is still 3-50x too fast, so an inflated £/hr is silently absorbing that error.
 * Flatten the rate and the cycle error is exposed with nothing covering it.
 *
 * The order of work is therefore: machine selection (done, 6/6), setup (done),
 * CYCLE TIME (next), and only then the rate. The numbers below stay because
 * they are evidence and they are right; they are not yet wired into a price.
 *
 * An earlier attempt switched rate and setup on together while machine
 * selection was 3/6, and the spread went to 19.6 — a wrong machine cost seven
 * times the setup error it used to. That is why selection came first.
 */

/**
 * A route that needs two machining operations prices higher per hour: £36.67,
 * £37.16, £38.50 and £39.12 across the four such quotes, against exactly £30.00
 * on the four single-op ones. 38/30. Why the second machine costs more per hour
 * rather than simply more hours is the one thing in his pricing we cannot yet
 * explain, so this is an OBSERVATION, not a mechanism.
 */
export const MULTI_OP_RATE_MULTIPLIER = 38 / 30;

export const DEFAULT_CNC_SETTINGS: CncSettings = {
  // NOT YET £30/hr, and the reason is measured — see CALIBRATION above.
  machineRatePerMin: 1.25,
  setupRatePerMin: 0.80,
  setupTimeFirstOpMin: 35,
  setupTimePerToolMin: 3,
  secondOpSetupMin: 20,
  flatSetupChargePerSetup: 0, // off by default; set to your per-setup charge (e.g. 150) to match CAM-quote billing
  setupBillingMode: 'both',   // 'time' | 'flat' | 'both' — how the flat charge combines with time labour

  efficiencyFactor: 0.8, // actual = theoretical / 0.8 (real shops run below book)
  feedrateRatioPercent: 100, // client-facing feed override; 100 = programmed feed (neutral)
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
  programmingMinPerSetup: 25, // one-time CAM programming per setup (NRE; not on reorder)
  toolLibrary: DEFAULT_TURNING_TOOLS,
  // Machines on the floor — defaults to the full catalog; a shop unchecks the
  // machines it doesn't own so selection only compares what it actually runs.
  machines: [...ALL_MACHINE_IDS],
};

export const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  name: 'Your Machine Shop',
  address: '',
  logo: '',
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
  currency: 'USD',
  taxRatePercent: 20, // VAT / sales tax on invoices; editable in Settings
  secondaryOps: DEFAULT_SECONDARY_OPS,
  cnc: DEFAULT_CNC_SETTINGS,
};
