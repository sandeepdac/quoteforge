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
  MachiningPlan,
  PlanOperation,
  PlanSetup,
  ShopSettings,
} from '../types';
import { DEFAULT_CNC_SETTINGS } from '../constants';
import { materialPropsFor } from './materials';
import { millingMrrCm3PerMin, finishingRateCm2PerMin, roughingToolDiaMm, MillingToolConfig } from './milling';

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
const DEEP_POCKET_PENALTY = 0.4;      // +40% on rough+finish per deep pocket (long-tool derate)

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

  // --- Deep-pocket derate (applies to bulk + finish reach) -----------------
  const deep = Math.max(0, p.deepPocketCount || 0);
  const deepMult = 1 + Math.min(1.2, DEEP_POCKET_PENALTY * deep);

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
  const roughSec = removedVol > 0 && millMrr > 0 ? (removedVol / millMrr) * 60 * deepMult : 0;

  // --- Facing: skim the top face(s) that are cut, ~ stock footprint --------
  const footprintCm2 = (p.stockMm.x * p.stockMm.y) / 100;
  const finishRate = finishingRateCm2PerMin(m, millCfg);
  const facingSec = finishRate > 0 ? (footprintCm2 / finishRate) * 60 : 0;

  // --- Finishing: walls + floors of the machined faces ---------------------
  const finishAreaCm2 = FINISH_MACHINED_FRACTION * Math.max(0, p.surfaceAreaCm2);
  const finishSec = finishRate > 0 ? (finishAreaCm2 / finishRate) * 60 * deepMult : 0;

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
  const setupCostTotal = setupTimeMin * cnc.setupRatePerMin;
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
    { key: 'rough', name: 'Roughing (hog-out)', driver: `${r1(removedVol)} cm³ removed @ ${r1(millMrr)} cm³/min — ${secStr(roughSec)}`, value: opCost(roughSec), color: COLORS.rough },
    { key: 'finish', name: 'Finishing (walls/floors)', driver: `${r1(finishAreaCm2)} cm² @ ${r1(finishRate)} cm²/min — ${secStr(finishSec)}`, value: opCost(finishSec), color: COLORS.finish },
    { key: 'drill', name: 'Drilling', driver: `${holes} hole${holes === 1 ? '' : 's'} — ${secStr(drillSec)}`, value: opCost(drillSec), color: COLORS.drill },
    { key: 'deep', name: 'Deep-pocket derate', driver: deep > 0 ? `${deep} deep pocket${deep === 1 ? '' : 's'} → +${Math.round((deepMult - 1) * 100)}% rough/finish` : '', value: deep > 0 ? opCost((roughSec + finishSec) * (1 - 1 / deepMult)) : 0, color: COLORS.deep },
    { key: 'noncut', name: 'Tool changes / rapids', driver: `${toolCount} tools, ${p.pocketCount} pocket${p.pocketCount === 1 ? '' : 's'}`, value: (airSec / eff) * ratePerSec, color: COLORS.noncut },
    { key: 'setup', name: `Setup ÷ ${qty}`, driver: `${r1(setupTimeMin)} min over ${setups} setup${setups > 1 ? 's' : ''} (${setups} access dir.), batch of ${qty}`, value: setupPerUnit, color: COLORS.setup },
    { key: 'fixture', name: `Soft jaws / fixture ÷ ${qty}`, driver: needsSoftJaws ? `${setups} setups${p.bossCount > 0 ? `, ${p.bossCount} boss` : ''} → work-holding, made once` : '', value: fixtureCost, color: COLORS.fixture },
    { key: 'tooling', name: 'Tooling / consumables', driver: `${toolCount} operations`, value: toolingCost, color: COLORS.tooling },
  ].filter((li) => li.value > 0.005);

  // --- Per-setup / per-operation plan --------------------------------------
  // The same seconds as the line items, regrouped the way a machinist reads a
  // job sheet. Work is spread evenly across setups: we know HOW MANY setups the
  // geometry needs, but not which feature lands in which — that would take a
  // posted toolpath. Drilling is put in the first setup, and facing happens once
  // per setup (you skim each new face after re-clamping).
  const toolName = `${r1(millCfg.toolDiaMm)} mm ${millCfg.flutes}F flat end mill`;
  const faceMillName = 'Face mill';
  const drillName = 'Drill';
  const finishToolName = `${r1(millCfg.toolDiaMm)} mm ${millCfg.flutes}F finisher`;
  const planSetups: PlanSetup[] = [];
  const changesPerSetup = Math.max(1, Math.round(toolCount / setups));
  for (let i = 0; i < setups; i++) {
    const share = 1 / setups;
    const ops: PlanOperation[] = [];
    const push = (name: string, tool: string, sec: number, driver: string, color: string) => {
      if (sec > 0.5) ops.push({ name, tool, seconds: sec / eff, cost: opCost(sec), driver, color });
    };
    push('Facing', faceMillName, facingSec / setups, `${r1(footprintCm2 / setups)} cm² @ ${r1(finishRate)} cm²/min`, COLORS.facing);
    push('Roughing', toolName, roughSec * share, `${r1(removedVol * share)} cm³ @ ${r1(millMrr)} cm³/min`, COLORS.rough);
    push('Finishing', finishToolName, finishSec * share, `${r1(finishAreaCm2 * share)} cm² @ ${r1(finishRate)} cm²/min`, COLORS.finish);
    if (i === 0) push('Drilling', drillName, drillSec, `${holes} hole${holes === 1 ? '' : 's'}`, COLORS.drill);
    const changeSec = changesPerSetup * toolChangeSec;
    const secs = ops.reduce((a, o) => a + o.seconds, 0) + changeSec / eff;
    planSetups.push({
      index: i + 1,
      name: `Setup ${i + 1}`,
      operations: ops,
      seconds: secs,
      cost: ops.reduce((a, o) => a + o.cost, 0) + opCost(changeSec),
      toolChanges: changesPerSetup,
    });
  }
  const planToolAgg = new Map<string, { name: string; ops: number; seconds: number }>();
  for (const s of planSetups) {
    for (const o of s.operations) {
      const cur = planToolAgg.get(o.tool) ?? { name: o.tool, ops: 0, seconds: 0 };
      cur.ops += 1;
      cur.seconds += o.seconds;
      planToolAgg.set(o.tool, cur);
    }
  }
  const plan: MachiningPlan = {
    setups: planSetups,
    tools: [...planToolAgg.values()].sort((a, b) => b.seconds - a.seconds),
    totalSeconds: planSetups.reduce((a, s) => a + s.seconds, 0),
    totalCost: planSetups.reduce((a, s) => a + s.cost, 0),
  };

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
