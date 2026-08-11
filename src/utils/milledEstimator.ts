/**
 * CNC MILLING / prismatic cost model — driven by CYCLE TIME, same philosophy as
 * turning: price is dominated by how long the part occupies the machine, plus
 * setup amortised over the batch.
 *
 * The geometry service (OCP) supplies the drivers behind the three high-leverage
 * rules:
 *   • SETUP COUNT — distinct tool-access directions (face-normal clustering).
 *     Setups are the biggest single cost lever on a milled part.
 *   • REMOVED VOLUME — billet minus part → roughing time at a milling MRR.
 *   • POCKETS / DEEP POCKETS — enclosed roughing + a deep-reach penalty (long
 *     thin tools run slow), and bosses/multiple setups imply soft-jaw fixturing.
 *
 * Time is THEORETICAL (book values); the shop **efficiency factor** (shared with
 * turning) corrects book-vs-reality uniformly, and is the headline calibration.
 * This estimates cost and time — it does NOT generate toolpaths.
 */
import {
  BatchPricePoint,
  CostLineItem,
  MachiningCosts,
  ShopSettings,
} from '../types';
import { DEFAULT_CNC_SETTINGS } from '../constants';
import { materialPropsFor } from './materials';
import { millingMrrCm3PerMin, finishingRateCm2PerMin, roughingToolDiaMm, MillingToolConfig } from './milling';
import { buildMilledPlan } from './milledPlanner';

/** A milled part reduced to the drivers a cycle-time model needs. */
export interface MilledProfile {
  /** Billet stock (bounding box) in mm. */
  stockMm: { x: number; y: number; z: number };
  stockVolumeCm3: number;
  partVolumeCm3: number;
  removedVolumeCm3: number;
  surfaceAreaCm2: number;
  /** Distinct tool-access directions (Rule 1). */
  setupCount: number;
  pocketCount: number;
  bossCount: number;
  /** Pockets whose depth/width ratio needs a long, slow tool (Rule 3). */
  deepPocketCount: number;
  holeCount: number;
  /** Measured hole diameters (mm), for per-size drilling operations. */
  holeDiametersMm?: number[];
  /** Part fills a small fraction of its bbox → solid-billet cost is an upper bound. */
  sparseBillet?: boolean;
}

export interface MilledMachiningInput {
  materialName: string;
  profile: MilledProfile;
  materialPricePerKg: number;
}

const STANDARD_BATCH_QTYS = [1, 5, 25, 100, 500];

const COLORS: Record<string, string> = {
  material: '#0891b2',
  facing: '#f59e0b',
  rough: '#2563eb',
  finish: '#3b82f6',
  drill: '#8b5cf6',
  deep: '#e11d48',
  noncut: '#94a3b8',
  setup: '#ef4444',
  fixture: '#fb923c',
  tooling: '#93c5fd',
};

// Milling-specific tuning (first-order; the efficiency factor calibrates the rest).
const FINISH_MACHINED_FRACTION = 0.6; // share of surface area that is machined (vs raw stock faces)
const DRILL_SEC_PER_HOLE_REF = 12;    // ref drill+retract per hole in steel; scales with machinability
// Feature-complexity weights. A part packed with small islands, pockets and holes
// has to be machined with small, SLOW tools that the single part-sized-cutter model
// cannot see — the dominant time driver on detailed parts (a NIST STC-10 spends 40+
// minutes on a 1.6 mm cutter). This heuristic scales cutting time with the measured
// feature counts; it subsumes the old flat deep-pocket derate. Calibrated so simple
// reference parts stay ~1.0 and a highly-featured one lands near a real CAM quote.
const CX_BOSS = 0.07;   // per island to machine around
const CX_POCKET = 0.12; // per enclosed pocket
const CX_DEEP = 0.35;   // per deep/narrow pocket (long thin tool)
const CX_HOLE = 0.02;   // per hole (proxy for small-feature density)
const CX_CAP = 3.0;     // never more than +300%

function featureComplexityMult(p: MilledProfile): number {
  const cx =
    CX_BOSS * Math.max(0, p.bossCount || 0) +
    CX_POCKET * Math.max(0, p.pocketCount || 0) +
    CX_DEEP * Math.max(0, p.deepPocketCount || 0) +
    CX_HOLE * Math.max(0, p.holeCount || 0);
  return 1 + Math.min(CX_CAP, cx);
}

/**
 * Distinct cutters a prismatic part needs. Tool changes are a first-order cost on
 * a milled part — a real 3-setup job runs 8–12 tools and can spend a third of its
 * cycle swapping them — so this must reflect actual CUTTERS, not operation types.
 * A face mill and a roughing end mill are shared across setups; each setup adds a
 * finishing cutter and a chamfer tool, and holes add a drill.
 */
function estimateToolCount(p: MilledProfile): number {
  let tools = 2;                       // face mill + roughing end mill
  tools += Math.max(1, p.setupCount);  // a finisher per setup
  tools += p.holeCount > 0 ? 1 : 0;    // drill
  tools += p.pocketCount > 0 ? 1 : 0;  // smaller cutter to clear pocket corners
  tools += p.deepPocketCount > 0 ? 1 : 0; // long-reach tool
  tools += 1;                          // chamfer/deburr
  return tools;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function calculateMilledCosts(
  input: MilledMachiningInput,
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
  const p = input.profile;

  // --- Stock & material ----------------------------------------------------
  const stockVol = Math.max(0, p.stockVolumeCm3);
  const partVol = Math.max(0, p.partVolumeCm3);
  const removedVol = Math.max(0, p.removedVolumeCm3 || stockVol - partVol);
  const stockWeightKg = (stockVol * m.densityGCm3) / 1000;
  const materialCost = stockWeightKg * input.materialPricePerKg * (1 - cnc.scrapRecovery);
  const buyToFlyRatio = stockVol > 0 ? partVol / stockVol : 0;

  // --- Feature-complexity derate (small slow tools on detailed parts) ------
  const deep = Math.max(0, p.deepPocketCount || 0);
  const deepMult = featureComplexityMult(p);

  // --- Roughing: remove the bulk at a real milling MRR (ae·ap·vf) ----------
  // The roughing cutter is sized to the part, not fixed: it dominates MRR, and a
  // big open plate takes a far heavier cut than a small contoured one.
  const minDimMm = Math.min(p.stockMm.x, p.stockMm.y, p.stockMm.z) || 20;
  const millCfg: MillingToolConfig = {
    toolDiaMm: cnc.millToolDiaMm ?? roughingToolDiaMm(minDimMm),
    flutes: 3,
    radialFactor: 0.35,
    axialFactor: 0.8,
    maxRpm: cnc.millMaxRpm ?? 12000,
  };
  const millMrr = millingMrrCm3PerMin(m, millCfg);
  // Base (open, part-sized tool) time; the complexity delta is billed separately
  // so the line items sum cleanly to the subtotal.
  const roughBaseSec = removedVol > 0 && millMrr > 0 ? (removedVol / millMrr) * 60 : 0;
  const roughSec = roughBaseSec * deepMult;

  // --- Facing: skim the top face(s) that are cut, ~ stock footprint --------
  const footprintCm2 = (p.stockMm.x * p.stockMm.y) / 100;
  const finishRate = finishingRateCm2PerMin(m, millCfg);
  const facingSec = finishRate > 0 ? (footprintCm2 / finishRate) * 60 : 0;

  // --- Finishing: walls + floors of the machined faces ---------------------
  const finishAreaCm2 = FINISH_MACHINED_FRACTION * Math.max(0, p.surfaceAreaCm2);
  const finishBaseSec = finishRate > 0 ? (finishAreaCm2 / finishRate) * 60 : 0;
  const finishSec = finishBaseSec * deepMult;
  // Extra seconds attributable to small-tool feature detail (rough + finish).
  const complexitySec = (roughBaseSec + finishBaseSec) * (deepMult - 1);

  // --- Drilling: holes, depth ~ smallest stock dimension -------------------
  const holes = Math.max(0, p.holeCount || 0);
  const throughDepthMm = Math.min(p.stockMm.x, p.stockMm.y, p.stockMm.z) || 10;
  const drillPerHole = DRILL_SEC_PER_HOLE_REF * (1 / Math.max(0.3, m.machinability)) * (throughDepthMm / 20);
  const drillSec = holes * drillPerHole;

  // --- Cycle time (theoretical → actual via efficiency) --------------------
  const cuttingSec = roughSec + facingSec + finishSec + drillSec;
  const toolCount = estimateToolCount(p);
  const toolChangeSec = cnc.millToolChangeSec ?? 10;
  const airSec = toolCount * toolChangeSec + cuttingSec * 0.08; // rapids between features
  const ratePerSec = machineRatePerMin / 60;
  const opCost = (sec: number) => (sec / eff) * ratePerSec;
  const cycleTimeSec = cuttingSec / eff + airSec / eff;
  const machineCost = (cycleTimeSec / 60) * machineRatePerMin;

  // --- Setup (amortised over the batch) — Rule 1 is the driver -------------
  // Milling setups are slower than the bar-lathe defaults: each one means
  // clamping a billet in a vise or soft jaws, tramming, probing and touching off
  // every tool, so milling carries its own baseline times.
  const setups = Math.max(1, Math.round(p.setupCount || 1));
  const setupTimeMin =
    (cnc.millSetupFirstOpMin ?? cnc.setupTimeFirstOpMin) +
    (setups - 1) * (cnc.millSetupPerExtraOpMin ?? cnc.secondOpSetupMin) +
    toolCount * cnc.setupTimePerToolMin;
  // Time-based setup + an optional flat charge per setup (both one-time job costs,
  // amortised over the batch). The flat charge matches how CAM quotes bill setup.
  const flatSetupCharge = Math.max(0, cnc.flatSetupChargePerSetup ?? 0) * setups;
  const setupCostTotal = setupTimeMin * cnc.setupRatePerMin + flatSetupCharge;
  const setupPerUnit = setupCostTotal / qty;

  // --- Fixturing: soft jaws / custom work-holding for multi-setup or bosses
  const needsSoftJaws = setups >= 3 || p.bossCount > 0;
  // Soft jaws / fixtures are made ONCE for the job, so like setup they amortise
  // over the batch — charging them per part made a 500-off carry 500 sets of jaws.
  const fixtureCostTotal = needsSoftJaws ? cnc.toolingCostPerOp * 4 * setups : 0;
  const fixtureCost = fixtureCostTotal / qty;

  // --- Tooling -------------------------------------------------------------
  const toolingCost = toolCount * cnc.toolingCostPerOp;

  // --- Roll-up (per unit) --------------------------------------------------
  const subtotal = materialCost + machineCost + setupPerUnit + toolingCost + fixtureCost;
  const overhead = subtotal * overheadPercent;
  const marginAmount = (subtotal + overhead) * marginPercent;
  const unitPrice = subtotal + overhead + marginAmount;
  const quoteTotal = unitPrice * qty;
  const rushPremium = isRush ? quoteTotal * rushPremiumPercent : 0;

  // --- Traceable line items ------------------------------------------------
  const secStr = (sec: number) => `${r1(sec / eff)} s`;
  const lineItems: CostLineItem[] = [
    { key: 'material', name: 'Billet stock', driver: `${r1(p.stockMm.x)}×${r1(p.stockMm.y)}×${r1(p.stockMm.z)} mm ${m.label} — ${stockWeightKg.toFixed(3)} kg @ $${input.materialPricePerKg.toFixed(2)}/kg`, value: materialCost, color: COLORS.material },
    { key: 'facing', name: 'Face / skim', driver: `${r1(footprintCm2)} cm² footprint — ${secStr(facingSec)}`, value: opCost(facingSec), color: COLORS.facing },
    { key: 'rough', name: 'Roughing (hog-out)', driver: `${r1(removedVol)} cm³ removed @ ${r1(millMrr)} cm³/min — ${secStr(roughBaseSec)}`, value: opCost(roughBaseSec), color: COLORS.rough },
    { key: 'finish', name: 'Finishing (walls/floors)', driver: `${r1(finishAreaCm2)} cm² @ ${r1(finishRate)} cm²/min — ${secStr(finishBaseSec)}`, value: opCost(finishBaseSec), color: COLORS.finish },
    { key: 'drill', name: 'Drilling', driver: `${holes} hole${holes === 1 ? '' : 's'} — ${secStr(drillSec)}`, value: opCost(drillSec), color: COLORS.drill },
    { key: 'deep', name: 'Feature-complexity (small tools)', driver: deepMult > 1.001 ? `${p.bossCount} boss / ${p.pocketCount} pocket${deep > 0 ? ` / ${deep} deep` : ''} / ${p.holeCount} holes → small-tool detail +${Math.round((deepMult - 1) * 100)}% — ${secStr(complexitySec)}` : '', value: opCost(complexitySec), color: COLORS.deep },
    { key: 'noncut', name: 'Tool changes / rapids', driver: `${toolCount} tools, ${p.pocketCount} pocket${p.pocketCount === 1 ? '' : 's'}`, value: (airSec / eff) * ratePerSec, color: COLORS.noncut },
    { key: 'setup', name: `Setup labour ÷ ${qty}`, driver: `${r1(setupTimeMin)} min over ${setups} setup${setups > 1 ? 's' : ''} (${setups} access dir.), batch of ${qty}`, value: (setupTimeMin * cnc.setupRatePerMin) / qty, color: COLORS.setup },
    { key: 'setupCharge', name: `Setup charge ÷ ${qty}`, driver: flatSetupCharge > 0 ? `$${(cnc.flatSetupChargePerSetup ?? 0).toFixed(0)} × ${setups} setup${setups > 1 ? 's' : ''}, batch of ${qty}` : '', value: flatSetupCharge / qty, color: COLORS.setup },
    { key: 'fixture', name: `Soft jaws / fixture ÷ ${qty}`, driver: needsSoftJaws ? `${setups} setups${p.bossCount > 0 ? `, ${p.bossCount} boss` : ''} → work-holding, made once` : '', value: fixtureCost, color: COLORS.fixture },
    { key: 'tooling', name: 'Tooling / consumables', driver: `${toolCount} operations`, value: toolingCost, color: COLORS.tooling },
  ].filter((li) => li.value > 0.005);

  // --- Per-setup / per-operation plan (tool-by-tool job sheet) -------------
  // Redistributes the SAME cutting seconds into named operations, each assigned
  // a real cutter from the shop milling tool library, and grouped into the
  // measured setups — so the estimate reads like a CAM operation list (face,
  // adaptive rough, rest-rough, wall/floor finish, a drill op per hole size,
  // chamfer) without changing the calibrated total.
  const sortedDims = [p.stockMm.x, p.stockMm.y, p.stockMm.z].sort((a, b) => a - b);
  const plan = buildMilledPlan({
    m,
    minPlaneDimMm: sortedDims[1], // the smaller in-plane dimension (not the thickness)
    facingSec,
    roughBaseSec,
    finishBaseSec,
    roughComplexSec: roughBaseSec * (deepMult - 1),
    finishComplexSec: finishBaseSec * (deepMult - 1),
    drillSec,
    removedVolCm3: removedVol,
    millMrr,
    finishAreaCm2,
    finishRate,
    holeCount: holes,
    holeDiametersMm: p.holeDiametersMm,
    maxDrillMm: cnc.maxDrillDiaMm ?? 20,
    bossCount: p.bossCount,
    setups,
    eff,
    opCost,
    toolChangeSec,
    colors: COLORS,
  });

  // --- Batch quantity curve (setup amortisation) ---------------------------
  const perUnitFixed = materialCost + machineCost + toolingCost;
  const batchCurve: BatchPricePoint[] = STANDARD_BATCH_QTYS.map((q) => {
    const sPer = (setupCostTotal + fixtureCostTotal) / q;
    const sub = perUnitFixed + sPer;
    const oh = sub * overheadPercent;
    const mg = (sub + oh) * marginPercent;
    return { quantity: q, unitPrice: sub + oh + mg, setupPerUnit: sPer };
  });

  return {
    materialCost,
    machineCost,
    setupCost: setupPerUnit,
    toolingCost: toolingCost + fixtureCost,
    subtotal,
    overhead,
    marginAmount,
    rushPremium,
    lineItems,
    partVolumeCm3: r1(partVol),
    stockVolumeCm3: r1(stockVol),
    removedVolumeCm3: r1(removedVol),
    buyToFlyRatio: Math.round(buyToFlyRatio * 100) / 100,
    barDiameterMm: 0,
    cycleTimeSec: Math.round(cycleTimeSec),
    setupTimeMin: r1(setupTimeMin),
    setups,
    efficiencyFactor: eff,
    batchCurve,
    machineClass: 'mill',
    plan,
    stockMm: { x: r1(p.stockMm.x), y: r1(p.stockMm.y), z: r1(p.stockMm.z) },
    pocketCount: p.pocketCount,
    bossCount: p.bossCount,
    deepPocketCount: deep,
    holeCount: holes,
  };
}
