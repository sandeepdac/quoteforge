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
  MachiningPlan,
  PlanOperation,
  ShopSettings,
  ShopTool,
  TurningOp,
} from '../types';
import { DEFAULT_CNC_SETTINGS, DEFAULT_TURNING_TOOLS } from '../constants';
import { materialPropsFor, nextStandardBar } from './materials';
import { estimateTurningTimes, TurningProfile } from './turning';
import { secondaryOpsCostPerUnit, secondaryOpsLineItems } from './secondaryOps';
import type { SecondaryOperation } from './secondaryOps';

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
  /** Secondary operations selected for this quote (plating, inspection, …). */
  secondaryOps?: SecondaryOperation[];
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
  nre: '#a855f7',
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
  // Client-facing feedrate override (Settings): 100% = programmed feed; scales
  // CUTTING time only (air moves, bar-feed and setup are unaffected).
  const feedMult = 100 / Math.max(1, cnc.feedrateRatioPercent ?? 100);
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
    maxDrillDiaMm: cnc.maxDrillDiaMm ?? 20,
  });
  // Per-op actual seconds and cost (efficiency applied to cutting/air alike).
  const ratePerSec = machineRatePerMin / 60;
  const opCost = (sec: number) => (sec / eff) * ratePerSec;
  const cycleTimeSec = (t.cuttingSec * feedMult) / eff + t.airSec / eff + cnc.barLoadSec;
  const machineCost = (cycleTimeSec / 60) * machineRatePerMin;

  // --- Setup (amortised over the batch) ------------------------------------
  const setups = Math.max(1, Math.round(input.setups || 1));
  const setupTimeMin =
    cnc.setupTimeFirstOpMin +
    (setups - 1) * cnc.secondOpSetupMin +
    t.toolCount * cnc.setupTimePerToolMin;
  // Setup billing: time-based labour, a flat per-setup charge, or both (one-time
  // job costs amortised over the batch). 'flat' matches how CAM quotes bill setup.
  const flatSetupCharge = Math.max(0, cnc.flatSetupChargePerSetup ?? 0) * setups;
  const setupLabour = setupTimeMin * cnc.setupRatePerMin;
  const setupMode = cnc.setupBillingMode ?? 'both';
  const setupLabourBilled = setupMode === 'flat' ? 0 : setupLabour;
  const flatBilled = setupMode === 'time' ? 0 : flatSetupCharge;
  const setupCostTotal = setupLabourBilled + flatBilled;
  const setupPerUnit = setupCostTotal / qty;

  // --- Tooling -------------------------------------------------------------
  const toolingCost = t.toolCount * cnc.toolingCostPerOp;

  // --- Secondary operations (plating / passivate / inspection …) -----------
  // Lot charge amortised over the batch + per-part cost; folded into subtotal so
  // overhead + margin apply the same as the machining work.
  const secondaryCost = secondaryOpsCostPerUnit(input.secondaryOps, qty);

  // --- One-time NRE: CAM programming (NRE) ---------------------------------
  // Programming/proving the turning cycle is one-time and does not recur on a
  // reorder; amortised over the first batch, excluded from the repeat price.
  const programmingMin = Math.max(0, cnc.programmingMinPerSetup ?? 0) * setups;
  const nreCost = programmingMin * cnc.setupRatePerMin;
  const programmingPerUnit = nreCost / qty;

  // --- Roll-up (per unit) --------------------------------------------------
  const subtotal = materialCost + machineCost + setupPerUnit + toolingCost + secondaryCost + programmingPerUnit;
  const overhead = subtotal * overheadPercent;
  const marginAmount = (subtotal + overhead) * marginPercent;
  const unitPrice = subtotal + overhead + marginAmount;
  const withMarkup = (sub: number) => sub * (1 + overheadPercent) * (1 + marginPercent);
  const repeatUnitPrice = withMarkup(subtotal - programmingPerUnit);
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
    { key: 'setup', name: `Setup labour ÷ ${qty}`, driver: `${r1(setupTimeMin)} min over ${setups} setup${setups > 1 ? 's' : ''}, batch of ${qty}`, value: setupLabourBilled / qty, color: COLORS.setup },
    { key: 'setupCharge', name: `Setup charge ÷ ${qty}`, driver: flatBilled > 0 ? `$${(cnc.flatSetupChargePerSetup ?? 0).toFixed(0)} × ${setups} setup${setups > 1 ? 's' : ''}, batch of ${qty}` : '', value: flatBilled / qty, color: COLORS.setup },
    { key: 'tooling', name: 'Tooling / consumables', driver: `${t.toolCount} operations`, value: toolingCost, color: COLORS.tooling },
    { key: 'nre', name: `CAM programming (one-time) ÷ ${qty}`, driver: `${r1(programmingMin)} min NRE over ${setups} setup${setups > 1 ? 's' : ''}, batch of ${qty} — not billed again on reorder`, value: programmingPerUnit, color: COLORS.nre },
    ...secondaryOpsLineItems(input.secondaryOps, qty),
  ].filter((li) => li.value > 0.005);

  // --- Per-setup / per-operation plan (a turning job sheet) ----------------
  // Same seconds as the line items, grouped the way a turner reads a job. A
  // bar-fed / sliding-head part runs in ONE setup; a second op (back-face /
  // cross features) is listed but not itemised because those features are not
  // in the cycle-time estimate. Tools come from the shop turning library.
  const tools: ShopTool[] = settings.cnc?.toolLibrary ?? DEFAULT_TURNING_TOOLS;
  const toolFor = (op: TurningOp, fallback: string) =>
    tools.find((tl) => tl.op === op)?.description ?? fallback;
  const p = input.profile;
  const opSrc: Array<{ name: string; sec: number; tool: string; driver: string; color: string }> = [
    { name: 'Facing', sec: t.facingSec, tool: toolFor('face', 'OD turning tool'), driver: `${p.faceCount} face${p.faceCount === 1 ? '' : 's'}`, color: COLORS.facing },
    { name: 'Rough turning', sec: t.roughSec, tool: toolFor('rough', 'OD turning tool'), driver: `${r1(removedVol)} cm³ removed`, color: COLORS.rough },
    { name: 'Drilling', sec: t.drillSec, tool: toolFor('drill', 'Carbide drill'), driver: `⌀${p.boreDiaMm} × ${p.boreDepthMm} mm`, color: COLORS.drill },
    { name: 'Boring', sec: t.boreSec, tool: toolFor('bore', 'Boring bar'), driver: `bore to ⌀${p.boreDiaMm}`, color: COLORS.bore },
    { name: 'Finish turning', sec: t.finishSec, tool: toolFor('finish', 'OD finishing tool'), driver: `${r1(p.lengthMm)} mm OD`, color: COLORS.finish },
    { name: 'Grooving', sec: t.grooveSec, tool: 'Grooving tool', driver: `${p.grooveCount} groove${p.grooveCount === 1 ? '' : 's'}`, color: COLORS.groove },
    { name: 'Threading', sec: t.threadSec, tool: 'Threading tool', driver: `${p.threadCount} thread${p.threadCount === 1 ? '' : 's'}`, color: COLORS.thread },
    { name: 'Part-off', sec: t.partingSec, tool: toolFor('partoff', 'Parting blade'), driver: 'cut to length', color: COLORS.parting },
  ];
  const planOps: PlanOperation[] = opSrc
    .filter((o) => o.sec > 0.5)
    .map((o) => ({ name: o.name, tool: o.tool, seconds: o.sec / eff, cost: opCost(o.sec), driver: o.driver, color: o.color }));
  const changeSec = t.toolCount * cnc.toolChangeSec;
  const setup1Sec = planOps.reduce((a, o) => a + o.seconds, 0) + changeSec / eff + cnc.barLoadSec;
  const setup1Cost = planOps.reduce((a, o) => a + o.cost, 0) + opCost(changeSec) + cnc.barLoadSec * ratePerSec;
  const planSetups = [
    { index: 1, name: setups > 1 ? 'Setup 1 — main turning' : 'Setup 1', operations: planOps, seconds: setup1Sec, cost: setup1Cost, toolChanges: t.toolCount },
  ];
  if (setups > 1) {
    planSetups.push({ index: 2, name: 'Setup 2 — second op (back-face / cross features)', operations: [], seconds: 0, cost: 0, toolChanges: 0 });
  }
  const planToolAgg = new Map<string, { name: string; ops: number; seconds: number }>();
  for (const o of planOps) {
    const cur = planToolAgg.get(o.tool) ?? { name: o.tool, ops: 0, seconds: 0 };
    cur.ops += 1;
    cur.seconds += o.seconds;
    planToolAgg.set(o.tool, cur);
  }
  const plan: MachiningPlan = {
    setups: planSetups,
    tools: [...planToolAgg.values()].sort((a, b) => b.seconds - a.seconds),
    totalSeconds: planSetups.reduce((a, s) => a + s.seconds, 0),
    totalCost: planSetups.reduce((a, s) => a + s.cost, 0),
  };

  // --- Batch quantity curve (setup + NRE amortisation) ---------------------
  // First-order price carries the one-time programming NRE; the repeat price
  // drops it (program already written) — the gap narrows with quantity.
  const batchCurve: BatchPricePoint[] = STANDARD_BATCH_QTYS.map((q) => {
    const recurringPer = setupCostTotal / q + secondaryOpsCostPerUnit(input.secondaryOps, q);
    const nrePer = nreCost / q;
    const repeatSub = materialCost + machineCost + recurringPer + toolingCost;
    return {
      quantity: q,
      unitPrice: withMarkup(repeatSub + nrePer),
      repeatUnitPrice: withMarkup(repeatSub),
      setupPerUnit: recurringPer + nrePer,
    };
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
    nreCost,
    repeatUnitPrice,
    efficiencyFactor: eff,
    batchCurve,
    plan,
    machineClass: 'turn',
  };
}
