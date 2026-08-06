/**
 * CNC TURNING cost model — driven by CYCLE TIME.
 *
 * For a machinist, price is dominated by how long the part occupies the machine.
 * This model estimates that time operation-by-operation (facing, roughing,
 * finishing, drilling, boring, grooving, threading, part-off) from the material's
 * cutting data and a turned profile, applies the shop efficiency factor, adds
 * non-cutting time, and rolls it into a price where **setup is amortised over the
 * batch quantity**. Change the quantity and the answer changes — see `batchCurve`.
 *
 * Turned parts only. Non-rotational parts are handled upstream (flagged, not
 * costed). This estimates cycle time; it does NOT generate toolpaths.
 */
import {
  BatchPricePoint,
  CostLineItem,
  MachiningCosts,
  ShopSettings,
} from '../types';
import { DEFAULT_CNC_SETTINGS } from '../constants';
import { materialPropsFor, nextStandardBar } from './materials';
import { estimateTurningTimes, TurningProfile } from './turning';

export interface MachiningInput {
  /** True for a rotationally-symmetric (turned) part. Only these are costed here. */
  isTurned: boolean;
  materialName: string;
  /** Finished part volume (cm³) — for removal = stock − part. */
  volumeCm3: number;
  /** The turned profile (OD, length, bore, faces, grooves, threads, cross-features). */
  profile: TurningProfile;
  /** Number of setups (1 = single op; 2 = back-face / second op). */
  setups: number;
  materialPricePerKg: number;
}

const STANDARD_BATCH_QTYS = [1, 5, 25, 100, 500];

const COLORS: Record<string, string> = {
  material: '#0891b2',
  facing: '#f59e0b',
  rough: '#2563eb',
  finish: '#3b82f6',
  drill: '#8b5cf6',
  bore: '#a78bfa',
  groove: '#14b8a6',
  thread: '#ec4899',
  parting: '#64748b',
  noncut: '#94a3b8',
  setup: '#ef4444',
  tooling: '#93c5fd',
};

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Round bar selection + chargeable stock volume for a turned profile. */
export function computeStock(
  profile: TurningProfile,
  cnc = DEFAULT_CNC_SETTINGS
): { barDiameterMm: number; barLengthMm: number; stockVolumeCm3: number } {
  const barDiameterMm = nextStandardBar(profile.odMm + 2 * cnc.radialStockAllowanceMm);
  // Chargeable length per part: the part + facing + the width lost to parting.
  const barLengthMm = profile.lengthMm + cnc.facingAllowanceMm + cnc.partingWidthMm;
  const stockVolumeCm3 = ((Math.PI / 4) * barDiameterMm * barDiameterMm * barLengthMm) / 1000;
  return { barDiameterMm, barLengthMm, stockVolumeCm3 };
}

export function calculateMachiningCosts(
  input: MachiningInput,
  quantity: number,
  isRush: boolean,
  marginPercent: number,
  settings: ShopSettings,
  /** Machine charge-out multiplier from the selected machine (see machineSelection). */
  machineRateMultiplier = 1
): MachiningCosts {
  const cnc = settings.cnc ?? DEFAULT_CNC_SETTINGS;
  const { overheadPercent, rushPremiumPercent } = settings;
  const m = materialPropsFor(input.materialName);
  const eff = cnc.efficiencyFactor > 0 ? cnc.efficiencyFactor : 0.8;
  const machineRatePerMin = cnc.machineRatePerMin * (machineRateMultiplier > 0 ? machineRateMultiplier : 1);
  const qty = Math.max(1, Math.round(quantity || 1));

  // --- Stock & material ----------------------------------------------------
  const { barDiameterMm, barLengthMm, stockVolumeCm3 } = computeStock(input.profile, cnc);
  const partVol = Math.max(0, input.volumeCm3);
  const removedVol = Math.max(0, stockVolumeCm3 - partVol);
  const stockWeightKg = (stockVolumeCm3 * m.densityGCm3) / 1000;
  const materialCost = stockWeightKg * input.materialPricePerKg * (1 - cnc.scrapRecovery);
  const buyToFlyRatio = stockVolumeCm3 > 0 ? partVol / stockVolumeCm3 : 0;

  // --- Cycle time (theoretical → actual via efficiency) --------------------
  const t = estimateTurningTimes(input.profile, m, removedVol, {
    maxRpm: cnc.maxRpm,
    toolChangeSec: cnc.toolChangeSec,
    roughFraction: 0.9,
  });
  // Per-op actual seconds and cost (efficiency applied to cutting/air alike).
  const ratePerSec = machineRatePerMin / 60;
  const opCost = (sec: number) => (sec / eff) * ratePerSec;
  const cycleTimeSec = t.cuttingSec / eff + t.airSec / eff + cnc.barLoadSec;
  const machineCost = (cycleTimeSec / 60) * machineRatePerMin;

  // --- Setup (amortised over the batch) ------------------------------------
  const setups = Math.max(1, Math.round(input.setups || 1));
  const setupTimeMin =
    cnc.setupTimeFirstOpMin +
    (setups - 1) * cnc.secondOpSetupMin +
    t.toolCount * cnc.setupTimePerToolMin;
  const setupCostTotal = setupTimeMin * cnc.setupRatePerMin;
  const setupPerUnit = setupCostTotal / qty;

  // --- Tooling -------------------------------------------------------------
  const toolingCost = t.toolCount * cnc.toolingCostPerOp;

  // --- Roll-up (per unit) --------------------------------------------------
  const subtotal = materialCost + machineCost + setupPerUnit + toolingCost;
  const overhead = subtotal * overheadPercent;
  const marginAmount = (subtotal + overhead) * marginPercent;
  const unitPrice = subtotal + overhead + marginAmount;
  const quoteTotal = unitPrice * qty;
  const rushPremium = isRush ? quoteTotal * rushPremiumPercent : 0;

  // --- Traceable line items (each shows its driver, incl. actual time) -----
  const secStr = (sec: number) => `${r1(sec / eff)} s`;
  const lineItems: CostLineItem[] = [
    { key: 'material', name: 'Bar stock', driver: `⌀${barDiameterMm} × ${r1(barLengthMm)} mm ${m.label} — ${stockWeightKg.toFixed(3)} kg @ $${input.materialPricePerKg.toFixed(2)}/kg`, value: materialCost, color: COLORS.material },
    { key: 'facing', name: 'Facing', driver: `${input.profile.faceCount} face${input.profile.faceCount === 1 ? '' : 's'} — ${secStr(t.facingSec)}`, value: opCost(t.facingSec), color: COLORS.facing },
    { key: 'rough', name: 'Rough turning', driver: `${r1(removedVol)} cm³ removed @ ${Math.round(m.cuttingSpeedRough * m.feedRough * m.depthOfCutRough)} cm³/min — ${secStr(t.roughSec)}`, value: opCost(t.roughSec), color: COLORS.rough },
    { key: 'finish', name: 'Finish turning', driver: `${r1(input.profile.lengthMm)} mm @ ${m.cuttingSpeedFinish} m/min — ${secStr(t.finishSec)}`, value: opCost(t.finishSec), color: COLORS.finish },
    { key: 'drill', name: 'Drilling', driver: `⌀${input.profile.boreDiaMm} × ${input.profile.boreDepthMm} mm bore — ${secStr(t.drillSec)}`, value: opCost(t.drillSec), color: COLORS.drill },
    { key: 'bore', name: 'Boring', driver: `finish bore ⌀${input.profile.boreDiaMm} — ${secStr(t.boreSec)}`, value: opCost(t.boreSec), color: COLORS.bore },
    { key: 'groove', name: 'Grooving', driver: `${input.profile.grooveCount} groove${input.profile.grooveCount === 1 ? '' : 's'} — ${secStr(t.grooveSec)}`, value: opCost(t.grooveSec), color: COLORS.groove },
    { key: 'thread', name: 'Threading', driver: `${input.profile.threadCount} thread${input.profile.threadCount === 1 ? '' : 's'} — ${secStr(t.threadSec)}`, value: opCost(t.threadSec), color: COLORS.thread },
    { key: 'parting', name: 'Part-off', driver: `${secStr(t.partingSec)}`, value: opCost(t.partingSec), color: COLORS.parting },
    { key: 'noncut', name: 'Tool changes / load', driver: `${t.toolCount} tool changes, rapids + ${cnc.barLoadSec}s load`, value: (t.airSec / eff + cnc.barLoadSec) * ratePerSec, color: COLORS.noncut },
    { key: 'setup', name: `Setup ÷ ${qty}`, driver: `${r1(setupTimeMin)} min over ${setups} setup${setups > 1 ? 's' : ''}, batch of ${qty}`, value: setupPerUnit, color: COLORS.setup },
    { key: 'tooling', name: 'Tooling / consumables', driver: `${t.toolCount} operations`, value: toolingCost, color: COLORS.tooling },
  ].filter((li) => li.value > 0.005);

  // --- Batch quantity curve (setup amortisation) ---------------------------
  const batchCurve: BatchPricePoint[] = STANDARD_BATCH_QTYS.map((q) => {
    const sPer = setupCostTotal / q;
    const sub = materialCost + machineCost + sPer + toolingCost;
    const oh = sub * overheadPercent;
    const mg = (sub + oh) * marginPercent;
    return { quantity: q, unitPrice: sub + oh + mg, setupPerUnit: sPer };
  });

  return {
    materialCost,
    machineCost,
    setupCost: setupPerUnit,
    toolingCost,
    subtotal,
    overhead,
    marginAmount,
    rushPremium,
    lineItems,
    partVolumeCm3: r1(partVol),
    stockVolumeCm3: r1(stockVolumeCm3),
    removedVolumeCm3: r1(removedVol),
    buyToFlyRatio: Math.round(buyToFlyRatio * 100) / 100,
    barDiameterMm,
    cycleTimeSec: Math.round(cycleTimeSec),
    setupTimeMin: r1(setupTimeMin),
    setups,
    efficiencyFactor: eff,
    batchCurve,
  };
}
