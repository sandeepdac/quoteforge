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
  CncSettings,
  CostLineItem,
  MachiningCosts,
  ShopSettings,
} from '../types';
import { DEFAULT_CNC_SETTINGS } from '../constants';
import { materialPropsFor } from './materials';
import { millingMrrCm3PerMin, finishingRateCm2PerMin, roughingToolDiaMm, MillingToolConfig } from './milling';
import { buildMilledPlan } from './milledPlanner';
import { secondaryOpsCostPerUnit, secondaryOpsLineItems } from './secondaryOps';
import type { SecondaryOperation } from './secondaryOps';

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
  /**
   * COMPOUND-ANGLE work. A hole or bore whose axis is not along a stock face can
   * only be produced along that axis, so it needs its own tilted fixture or an
   * indexed 4th/5th-axis rotation — a real setup the axis-aligned count misses.
   * These are the setups included in `setupCount` on top of the axis-aligned ones,
   * and they are the reason a quote for an angled part must be reviewed.
   */
  angledSetups?: number;
  /** How far off a stock axis each angled hole/bore axis sits (degrees). */
  angledToolAxisDegs?: number[];
  /** Open/partial circular features (⌀ mm) — interpolated bores, not drilled. */
  partialBoreDiametersMm?: number[];
  /** Holes carrying a counterbore/step — each is a drill AND a counterbore. */
  steppedHoleCount?: number;
  /** Round spigots the cutter has to profile around (⌀ mm). */
  roundBossDiametersMm?: number[];
  /**
   * Features the SPINDLE can cut, because they are coaxial with the part's
   * turning axis — bores, spigots, faces. On a lathe or mill-turn these are
   * TURNED (roughly 4x faster than interpolating them with an end mill); only
   * the off-axis features are milled with driven tools.
   */
  turnedFeatureDiametersMm?: number[];
  /** Planar faces square to the turning axis — facing cuts. */
  facingCandidates?: number;
  /**
   * True when the stock is ROUND BAR (a mill-turn part) rather than a rectangular
   * billet: `stockMm` then holds the bar as {⌀, ⌀, length} and `barDiameterMm` is
   * the bar size. The part is turned to profile and milled with driven tools in
   * one clamp, so far less material is removed and setups collapse.
   */
  fromBarStock?: boolean;
  /** Round bar ⌀ (mm) when `fromBarStock` — the stock is bar, not a block. */
  barDiameterMm?: number;
}

export interface MilledMachiningInput {
  materialName: string;
  profile: MilledProfile;
  materialPricePerKg: number;
  /** Secondary operations selected for this quote (plating, inspection, …). */
  secondaryOps?: SecondaryOperation[];
}

const STANDARD_BATCH_QTYS = [1, 5, 25, 100, 500];

/**
 * Re-express a prismatic (billet) profile as a MILL-TURN part cut from ROUND BAR.
 *
 * This is the client's actual workflow (points 1 & 2): a round-ish part isn't
 * hogged out of a rectangular block on a machining centre — it's fed as round bar
 * into a turn-mill, turned to its profile, and milled with driven tools in ONE
 * clamp ("all faces in one operation"). Two things change versus the billet route:
 *   • STOCK becomes round bar sized to the part (⌀ = `barDiameterMm`, length =
 *     the part's longest dimension + facing/part-off). A bar removes far less
 *     material than the smallest block that contains the part, so material and
 *     roughing both drop.
 *   • SETUPS collapse to what a mill-turn really needs (main collet, plus at most a
 *     sub-spindle pick-off for back-face work) instead of one per tool-access
 *     direction a 3-axis machining centre would re-fixture for.
 *
 * The pocket / boss / hole / surface-area drivers are unchanged — the driven-tool
 * milling still has to cut them. (Roughing the bar→profile stock is still priced
 * at the milling MRR here, which slightly overstates it: on a real turn-mill the
 * OD is hogged by TURNING, which is faster. It stays conservative and is far
 * closer than block-milling.)
 */
export function toBarStockProfile(
  billet: MilledProfile,
  barDiameterMm: number,
  effectiveSetups: number,
  cnc: CncSettings = DEFAULT_CNC_SETTINGS
): MilledProfile {
  const dia = Math.max(1, barDiameterMm);
  // Bar axis length = the part's longest extent + facing both ends + part-off.
  const longestMm = Math.max(billet.stockMm.x, billet.stockMm.y, billet.stockMm.z);
  const barLenMm = longestMm + (cnc.facingAllowanceMm ?? 2) + (cnc.partingWidthMm ?? 3);
  const barVolCm3 = ((Math.PI / 4) * dia * dia * barLenMm) / 1000;
  const partVol = Math.max(0, billet.partVolumeCm3);
  const setups = Math.max(1, Math.round(effectiveSetups || 1));
  return {
    ...billet,
    // Represent the bar as a {⌀, ⌀, length} box so the cost model's footprint
    // (⌀²) and min-dimension (⌀, the roughing-tool sizer) read correctly.
    stockMm: { x: dia, y: dia, z: barLenMm },
    stockVolumeCm3: Math.round(barVolCm3 * 10) / 10,
    partVolumeCm3: partVol,
    removedVolumeCm3: Math.round(Math.max(0, barVolCm3 - partVol) * 10) / 10,
    setupCount: setups,
    fromBarStock: true,
    barDiameterMm: dia,
    // Round bar IS the right stock now, so the solid-billet "sparse" warning
    // no longer applies — the near-net over-hog it warned about is gone.
    sparseBillet: false,
  };
}

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
  nre: '#a855f7',
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

// Sculptured-surface finishing. A contoured 3D part (freeform faces, organic
// pockets, deep fillets) can't be finished with a big flat cutter — it needs a
// small BALL at a fine stepover, several times slower per cm² than a flat wall.
// A part's contour is signalled by how much MORE surface it has than a compact
// block of the same volume (surface ÷ same-volume-cube surface). Thin plates also
// have a high ratio but finish FAST (planar), so their contribution is damped by
// "plateness" — otherwise a flat plate would be mistaken for a sculptured part.
const SCULPT_START = 1.8; // surface/cube ratio at/below which a part is treated as prismatic
const SCULPT_K = 0.95;    // finish-slowdown gain above the threshold
const SCULPT_POW = 2;     // quadratic: moderate blocks stay ~1×, truly contoured parts ramp hard
const SCULPT_CAP = 10;    // finishing never more than 10× slower (tiny ball, fine stepover)
const CONTOUR_SETUP_CEILING = 5; // the sculpt setup floor never lifts a part past 5 re-clamps

/** Geometry a contour test needs: surface area, part volume, stock bbox. */
interface ContourInput {
  surfaceAreaCm2: number;
  partVolumeCm3: number;
  stockMm: { x: number; y: number; z: number };
}

/**
 * How much more surface a part carries than a compact block of the same volume,
 * damped for plates. 0 for prismatic/plate parts, rising with 3D contour. Shared
 * by the finishing-rate derate and the setup-count floor.
 */
function sculptExcess(p: ContourInput): number {
  const partVol = Math.max(1, p.partVolumeCm3);
  const cubeArea = 6 * Math.pow(partVol, 2 / 3); // cm² of a same-volume cube
  const ratio = p.surfaceAreaCm2 > 0 ? p.surfaceAreaCm2 / cubeArea : 1;
  const sd = [p.stockMm.x, p.stockMm.y, p.stockMm.z].sort((a, b) => a - b);
  // plateness → 1 when the thinnest dim is far smaller than the next (a flat plate).
  const plateness = sd[1] > 0 ? 1 - Math.min(1, sd[0] / (0.3 * sd[1])) : 0;
  // Sparseness damping. The surface/compact-cube ratio also blows up for a SPARSE
  // part — an open frame or spread-out bracket that fills a tiny fraction of its
  // envelope — which is prismatic (planar walls + holes), not a sculptured 3D
  // freeform. Without this, such a part is mistaken for a mould and finished at up
  // to 10× (a ~300 cm³ part filling 1% of a 320×534×163 envelope). Dense parts
  // (which the sculpt/setup logic was calibrated on) fill their envelope, so their
  // damping is 1 and their behaviour is unchanged.
  // Only the extreme case is damped: a genuinely contoured part that is hollow
  // (e.g. FTC-07 fills ~14% of its envelope) keeps its full sculpt, while a thin
  // open frame filling ~1% is pulled back toward prismatic.
  const envVolCm3 = (sd[0] * sd[1] * sd[2]) / 1000;
  const fill = envVolCm3 > 0 ? partVol / envVolCm3 : 1;
  const sparseDamp = Math.min(1, fill / 0.1);
  return Math.max(0, ratio - SCULPT_START) * (1 - plateness) * sparseDamp;
}

/**
 * Finishing-time multiplier for a contoured part (1 = prismatic, up to SCULPT_CAP).
 * Quadratic so a moderately-featured block barely moves while a sculptured 3D part
 * (deep freeform faces, finished with a small ball) slows sharply.
 */
function sculptFinishMult(p: MilledProfile): number {
  return Math.min(SCULPT_CAP, 1 + SCULPT_K * Math.pow(sculptExcess(p), SCULPT_POW));
}

/**
 * Setup-count FLOOR for contoured parts. The geometry service counts distinct
 * tool-access directions — the geometric minimum — but a contoured part is
 * re-clamped to finish its curved faces from better angles, so a CAM plan uses
 * more setups than access directions (e.g. NIST FTC-07: 3 access dirs, 5 setups).
 * Add a bonus that is 0 for prismatic/plate parts and grows with the contour, so
 * simple blocks (already matching their setup count) are left alone.
 */
export function contouredSetupCount(baseSetups: number, p: ContourInput): number {
  const base = Math.max(1, Math.round(baseSetups || 1));
  const bonus = Math.min(3, Math.round(sculptExcess(p) / 1.3));
  // The sculpt bonus only LIFTS an under-counted contoured part toward the number
  // of real re-clamps a CAM plan uses (FTC-07: 3 access dirs → 5). It must never
  // push a part that already has a healthy access-direction count into extra,
  // work-less setups: part 12630 measured 5 access directions (matching the real
  // shop's 5 ops), and a spurious +1 left the 6th setup with only a facing skim.
  // Cap the lifted value at CONTOUR_SETUP_CEILING, and never reduce below base.
  return Math.min(base + bonus, Math.max(base, CONTOUR_SETUP_CEILING));
}

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
  // Client-facing feedrate override (Settings): 100% = programmed feed. Below 100
  // runs cutting slower (more time), above 100 faster. Scales CUTTING time only.
  const feedMult = 100 / Math.max(1, cnc.feedrateRatioPercent ?? 100);
  const machineRatePerMin = cnc.machineRatePerMin * (machineRateMultiplier > 0 ? machineRateMultiplier : 1);
  const qty = Math.max(1, Math.round(quantity || 1));
  const p = input.profile;

  // --- Stock & material ----------------------------------------------------
  const rawStockVol = Math.max(0, p.stockVolumeCm3);
  const partVol = Math.max(0, p.partVolumeCm3);

  // Near-net cap. A SOLID billet is physically wrong for a very sparse part —
  // an open frame / weldment / near-net casting that fills a tiny % of its
  // bounding box. Milling it from a solid block would hog away nearly the whole
  // envelope (e.g. 98% removed) and produce an absurd upper-bound price. Below a
  // floor yield the solid-billet assumption is unrealistic, so we price on an
  // assumed near-net stock at that floor instead. The measured envelope + the
  // sparse-billet warning still tell the user to confirm the real stock.
  const YIELD_FLOOR = 0.15;
  const rawYield = rawStockVol > 0 ? partVol / rawStockVol : 1;
  const nearNetStock = partVol > 0 && rawYield < YIELD_FLOOR;
  const stockVol = nearNetStock ? partVol / YIELD_FLOOR : rawStockVol;
  const removedVol = nearNetStock
    ? Math.max(0, stockVol - partVol)
    : Math.max(0, p.removedVolumeCm3 || rawStockVol - partVol);
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
  const roughBaseSec = (removedVol > 0 && millMrr > 0 ? (removedVol / millMrr) * 60 : 0) * feedMult;
  const roughSec = roughBaseSec * deepMult;

  // --- Facing: skim the top face(s) that are cut, ~ stock footprint --------
  const footprintCm2 = (p.stockMm.x * p.stockMm.y) / 100;
  const finishRate = finishingRateCm2PerMin(m, millCfg);
  const facingSec = (finishRate > 0 ? (footprintCm2 / finishRate) * 60 : 0) * feedMult;

  // --- Finishing: walls + floors of the machined faces ---------------------
  // Contoured parts finish far slower (small ball at fine stepover); the multiplier
  // is 1 for prismatic parts and plates, so simple-part calibration is unchanged.
  const finishSculpt = sculptFinishMult(p);
  const finishAreaCm2 = FINISH_MACHINED_FRACTION * Math.max(0, p.surfaceAreaCm2);
  const finishBaseSec = (finishRate > 0 ? (finishAreaCm2 / finishRate) * 60 * finishSculpt : 0) * feedMult;
  const finishSec = finishBaseSec * deepMult;
  // Extra seconds attributable to small-tool feature detail (rough + finish).
  const complexitySec = (roughBaseSec + finishBaseSec) * (deepMult - 1);

  // --- Drilling: holes, depth ~ smallest stock dimension -------------------
  const holes = Math.max(0, p.holeCount || 0);
  const throughDepthMm = Math.min(p.stockMm.x, p.stockMm.y, p.stockMm.z) || 10;
  const drillPerHole = DRILL_SEC_PER_HOLE_REF * (1 / Math.max(0.3, m.machinability)) * (throughDepthMm / 20);
  const drillSec = holes * drillPerHole * feedMult;

  // --- Cycle time (theoretical → actual via efficiency) --------------------
  const cuttingSec = roughSec + facingSec + finishSec + drillSec;
  const toolCount = estimateToolCount(p);
  const toolChangeSec = cnc.millToolChangeSec ?? 10;
  const airSec = toolCount * toolChangeSec + cuttingSec * 0.08; // rapids between features
  const ratePerSec = machineRatePerMin / 60;
  const opCost = (sec: number) => (sec / eff) * ratePerSec;
  const cycleTimeSec = cuttingSec / eff + airSec / eff;
  const machineCost = (cycleTimeSec / 60) * machineRatePerMin;

  // --- Per-setup / per-operation plan (tool-by-tool job sheet) -------------
  // Built BEFORE setup billing because the plan is the source of truth for how
  // many setups actually carry work. It redistributes the SAME cutting seconds
  // into named, tool-assigned operations (face, adaptive/rest rough, wall/floor
  // finish, a drill op per hole size, chamfer), spreads them across the setups,
  // and sizes the setup count to the real work — never a phantom, facing-only
  // re-clamp — without changing the calibrated total.
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
    setups: Math.max(1, Math.round(p.setupCount || 1)),
    angledSetups: p.angledSetups,
    eff,
    opCost,
    toolChangeSec,
    colors: COLORS,
  });

  // --- Setup (amortised over the batch) — Rule 1 is the driver -------------
  // Milling setups are slower than the bar-lathe defaults: each one means
  // clamping a billet in a vise or soft jaws, tramming, probing and touching off
  // every tool, so milling carries its own baseline times. Bill on the setups the
  // plan could actually fill — phantom facing-only re-clamps are merged away.
  const setups = plan.setups.length;
  const setupTimeMin =
    (cnc.millSetupFirstOpMin ?? cnc.setupTimeFirstOpMin) +
    (setups - 1) * (cnc.millSetupPerExtraOpMin ?? cnc.secondOpSetupMin) +
    toolCount * cnc.setupTimePerToolMin;
  // Setup billing: time-based labour, a flat per-setup charge, or both (one-time
  // job costs amortised over the batch). 'flat' matches how CAM quotes bill setup.
  const flatSetupCharge = Math.max(0, cnc.flatSetupChargePerSetup ?? 0) * setups;
  const setupLabour = setupTimeMin * cnc.setupRatePerMin;
  const setupMode = cnc.setupBillingMode ?? 'both';
  const setupLabourBilled = setupMode === 'flat' ? 0 : setupLabour;
  const flatBilled = setupMode === 'time' ? 0 : flatSetupCharge;
  const setupCostTotal = setupLabourBilled + flatBilled;
  const setupPerUnit = setupCostTotal / qty;

  // --- Fixturing: soft jaws / custom work-holding for multi-setup or bosses
  const needsSoftJaws = setups >= 3 || p.bossCount > 0;
  // Soft jaws / fixtures are made ONCE for the job, so like setup they amortise
  // over the batch — charging them per part made a 500-off carry 500 sets of jaws.
  const fixtureCostTotal = needsSoftJaws ? cnc.toolingCostPerOp * 4 * setups : 0;
  const fixtureCost = fixtureCostTotal / qty;

  // --- Tooling -------------------------------------------------------------
  const toolingCost = toolCount * cnc.toolingCostPerOp;

  // --- Secondary operations (plating / anodise / inspection …) -------------
  // Subcontract finishing + inspection: a lot charge amortised over the batch
  // plus a per-part cost. Folded into the subtotal so overhead + margin apply
  // the same as machining (the shop marks up subcon like the rest of the job).
  const secondaryCost = secondaryOpsCostPerUnit(input.secondaryOps, qty);

  // --- One-time NRE: CAM programming + fixturing ---------------------------
  // Writing/proving the toolpaths and making the soft jaws are done ONCE for the
  // part and do not recur on a reorder. They amortise over the first batch but
  // are excluded from the repeat price. (Separating this is what lets us show a
  // first-order vs repeat-order price — a ~30% swing at mid quantities.)
  const programmingMin = Math.max(0, cnc.programmingMinPerSetup ?? 0) * setups;
  const nreProgrammingCost = programmingMin * cnc.setupRatePerMin;
  const nreCost = nreProgrammingCost + fixtureCostTotal; // one-time for the whole job
  const programmingPerUnit = nreProgrammingCost / qty;

  // --- Roll-up (per unit) --------------------------------------------------
  // `subtotal` is the FIRST-order per-part cost (carries the amortised NRE). The
  // repeat-order cost drops the one-time NRE (programming + fixture).
  const subtotal = materialCost + machineCost + setupPerUnit + toolingCost + fixtureCost + secondaryCost + programmingPerUnit;
  const overhead = subtotal * overheadPercent;
  const marginAmount = (subtotal + overhead) * marginPercent;
  const unitPrice = subtotal + overhead + marginAmount;
  const withMarkup = (sub: number) => sub * (1 + overheadPercent) * (1 + marginPercent);
  const repeatUnitPrice = withMarkup(subtotal - programmingPerUnit - fixtureCost);
  const quoteTotal = unitPrice * qty;
  const rushPremium = isRush ? quoteTotal * rushPremiumPercent : 0;

  // --- Traceable line items ------------------------------------------------
  const secStr = (sec: number) => `${r1(sec / eff)} s`;
  const lineItems: CostLineItem[] = [
    { key: 'material', name: 'Billet stock', driver: `${r1(p.stockMm.x)}×${r1(p.stockMm.y)}×${r1(p.stockMm.z)} mm ${m.label} — ${stockWeightKg.toFixed(3)} kg @ $${input.materialPricePerKg.toFixed(2)}/kg`, value: materialCost, color: COLORS.material },
    { key: 'facing', name: 'Face / skim', driver: `${r1(footprintCm2)} cm² footprint — ${secStr(facingSec)}`, value: opCost(facingSec), color: COLORS.facing },
    { key: 'rough', name: 'Roughing (hog-out)', driver: `${r1(removedVol)} cm³ removed @ ${r1(millMrr)} cm³/min — ${secStr(roughBaseSec)}`, value: opCost(roughBaseSec), color: COLORS.rough },
    { key: 'finish', name: 'Finishing (walls/floors)', driver: `${r1(finishAreaCm2)} cm²${finishSculpt > 1.05 ? ` contoured ×${r1(finishSculpt)} (small ball)` : ` @ ${r1(finishRate)} cm²/min`} — ${secStr(finishBaseSec)}`, value: opCost(finishBaseSec), color: COLORS.finish },
    { key: 'drill', name: 'Drilling', driver: `${holes} hole${holes === 1 ? '' : 's'} — ${secStr(drillSec)}`, value: opCost(drillSec), color: COLORS.drill },
    { key: 'deep', name: 'Feature-complexity (small tools)', driver: deepMult > 1.001 ? `${p.bossCount} boss / ${p.pocketCount} pocket${deep > 0 ? ` / ${deep} deep` : ''} / ${p.holeCount} holes → small-tool detail +${Math.round((deepMult - 1) * 100)}% — ${secStr(complexitySec)}` : '', value: opCost(complexitySec), color: COLORS.deep },
    { key: 'noncut', name: 'Tool changes / rapids', driver: `${toolCount} tools, ${p.pocketCount} pocket${p.pocketCount === 1 ? '' : 's'}`, value: (airSec / eff) * ratePerSec, color: COLORS.noncut },
    { key: 'setup', name: `Setup labour ÷ ${qty}`, driver: `${r1(setupTimeMin)} min over ${setups} setup${setups > 1 ? 's' : ''}, batch of ${qty}`, value: setupLabourBilled / qty, color: COLORS.setup },
    { key: 'setupCharge', name: `Setup charge ÷ ${qty}`, driver: flatBilled > 0 ? `$${(cnc.flatSetupChargePerSetup ?? 0).toFixed(0)} × ${setups} setup${setups > 1 ? 's' : ''}, batch of ${qty}` : '', value: flatBilled / qty, color: COLORS.setup },
    { key: 'nre', name: `CAM programming (one-time) ÷ ${qty}`, driver: `${r1(programmingMin)} min NRE over ${setups} setup${setups > 1 ? 's' : ''}, batch of ${qty} — not billed again on reorder`, value: programmingPerUnit, color: COLORS.nre },
    { key: 'fixture', name: `Soft jaws / fixture ÷ ${qty}`, driver: needsSoftJaws ? `${setups} setups${p.bossCount > 0 ? `, ${p.bossCount} boss` : ''} → work-holding, made once (one-time)` : '', value: fixtureCost, color: COLORS.fixture },
    { key: 'tooling', name: 'Tooling / consumables', driver: `${toolCount} operations`, value: toolingCost, color: COLORS.tooling },
    ...secondaryOpsLineItems(input.secondaryOps, qty),
  ].filter((li) => li.value > 0.005);

  // --- Batch quantity curve (setup + NRE amortisation) ---------------------
  // First-order price carries the one-time NRE (programming + jaws); the repeat
  // price drops it (programs written, fixtures exist) — the gap narrows with qty.
  const perUnitFixed = materialCost + machineCost + toolingCost;
  const batchCurve: BatchPricePoint[] = STANDARD_BATCH_QTYS.map((q) => {
    const recurringPer = setupCostTotal / q + secondaryOpsCostPerUnit(input.secondaryOps, q);
    const nrePer = (nreProgrammingCost + fixtureCostTotal) / q;
    const repeatSub = perUnitFixed + recurringPer;
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
    nearNetStock,
    fromBarStock: p.fromBarStock,
    barDiameterMm: p.fromBarStock ? (p.barDiameterMm ?? 0) : 0,
    cycleTimeSec: Math.round(cycleTimeSec),
    setupTimeMin: r1(setupTimeMin),
    setups,
    nreCost,
    repeatUnitPrice,
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
