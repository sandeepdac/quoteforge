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
} from '../types';
import { DEFAULT_CNC_SETTINGS, DEFAULT_TURNING_TOOLS } from '../constants';
import { materialPropsFor, nextStandardBar } from './materials';
import { estimateTurningTimes, DEFAULT_OP_APPROACH, TurningProfile, polygonSectionMm2, acrossCornersMm } from './turning';
import { deriveRouteSetup, routeRateMultiplier, type RouteSetupOp } from './setupModel';
import { TOOL_CHANGE_SEC } from './machineSelection';
import { secondaryOpsCostPerUnit, secondaryOpsLineItems } from './secondaryOps';
import type { SecondaryOperation } from './secondaryOps';
import type { EstimatedTurningOp } from './turningTools';
import { realisation, partNeedsInterruptedDerate, normaliseRealisation } from './realisation';

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
): { barDiameterMm: number; barLengthMm: number; stockVolumeCm3: number; stockDescription: string } {
  // Chargeable length per part: the part + facing + the width lost to parting.
  const barLengthMm = profile.lengthMm + cnc.facingAllowanceMm + cnc.partingWidthMm;
  // A POLYGON BAR is bought at its across-flats size and keeps its flats, so
  // there is no turning allowance on it and its weight is the polygon's, not a
  // round bar's. The VOC housing was being charged for ⌀36 round bar — 71 cm³
  // of brass a part — when it is cut from 25.4 A/F hex at 39.
  if (profile.stock?.shape === 'polygon') {
    const { flats, acrossFlatsMm } = profile.stock;
    const stockVolumeCm3 = (polygonSectionMm2(flats, acrossFlatsMm) * barLengthMm) / 1000;
    const name = flats === 6 ? 'hex' : flats === 4 ? 'square' : flats === 8 ? 'octagon' : `${flats}-sided`;
    return {
      barDiameterMm: Math.round(acrossCornersMm(flats, acrossFlatsMm) * 100) / 100,
      barLengthMm, stockVolumeCm3,
      stockDescription: `${acrossFlatsMm} A/F ${name} bar`,
    };
  }
  const barDiameterMm = nextStandardBar(profile.odMm + 2 * cnc.radialStockAllowanceMm);
  const stockVolumeCm3 = ((Math.PI / 4) * barDiameterMm * barDiameterMm * barLengthMm) / 1000;
  return { barDiameterMm, barLengthMm, stockVolumeCm3, stockDescription: `⌀${barDiameterMm} bar` };
}

export function calculateMachiningCosts(
  input: MachiningInput,
  quantity: number,
  isRush: boolean,
  marginPercent: number,
  settings: ShopSettings,
  /** Machine charge-out multiplier from the selected machine (see machineSelection). */
  machineRateMultiplier = 1,
  /** Total setup minutes for the whole route (see buildRoute). Already summed. */
  routeSetupMin = 0,
  /**
   * The ROUTE: every op, on the machine that actually runs it. Given one, setup
   * is DERIVED from this part's own tools, fixturings and features (setupModel.ts)
   * rather than looked up — the difference between an estimate a quoter can
   * defend and a number copied off someone else's job sheet.
   *
   * A route, not a machine, because four of the seven quoted parts run on two of
   * them. Passing only the primary charged the second machine's dial-in at zero.
   */
  routeOps?: RouteSetupOp[],
): MachiningCosts {
  const cnc = settings.cnc ?? DEFAULT_CNC_SETTINGS;
  const { overheadPercent, rushPremiumPercent } = settings;
  const m = materialPropsFor(input.materialName);
  const eff = cnc.efficiencyFactor > 0 ? cnc.efficiencyFactor : 0.8;
  const routeRate = routeOps?.length ? routeRateMultiplier(routeOps) : null;
  const machineRatePerMin = cnc.machineRatePerMin * (routeRate ?? (machineRateMultiplier > 0 ? machineRateMultiplier : 1));
  // Client-facing feedrate override (Settings): 100% = programmed feed; scales
  // CUTTING time only (air moves, bar-feed and setup are unaffected).
  const feedMult = 100 / Math.max(1, cnc.feedrateRatioPercent ?? 100);
  const qty = Math.max(1, Math.round(quantity || 1));

  // --- Stock & material ----------------------------------------------------
  const { barDiameterMm, barLengthMm, stockVolumeCm3, stockDescription } = computeStock(input.profile, cnc);
  const partVol = Math.max(0, input.volumeCm3);
  const removedVol = Math.max(0, stockVolumeCm3 - partVol);
  const stockWeightKg = (stockVolumeCm3 * m.densityGCm3) / 1000;
  const materialCost = stockWeightKg * input.materialPricePerKg * (1 - cnc.scrapRecovery);
  const buyToFlyRatio = stockVolumeCm3 > 0 ? partVol / stockVolumeCm3 : 0;

  // --- Cycle time (theoretical → actual via efficiency) --------------------
  // TOOL CHANGE IS THE MACHINE'S, not one number for the whole floor. A turret
  // indexes in about a second; a machining-centre ATC takes five. The shop's own
  // setting still wins when no machine has been chosen yet.
  const toolChangeSec = routeOps?.length
    ? TOOL_CHANGE_SEC[routeOps[0].machine.kind] ?? cnc.toolChangeSec
    : cnc.toolChangeSec;
  // ...and so is the rapid rate. Sourced per machine where a specification was
  // published; see MachineSpec.rapidTraverseMmPerMin.
  const rapidMmPerMin = routeOps?.length
    ? routeOps[0].machine.rapidTraverseMmPerMin || DEFAULT_OP_APPROACH.rapidMmPerMin
    : DEFAULT_OP_APPROACH.rapidMmPerMin;
  const t = estimateTurningTimes(
    // The bar is computed right here; passing it stops roughing's pass count
    // falling back to a guess at the stock allowance.
    { ...input.profile, barDiameterMm }, m, removedVol, {
    maxRpm: cnc.maxRpm,
    toolChangeSec,
    roughFraction: 0.9,
    maxDrillDiaMm: cnc.maxDrillDiaMm ?? 20,
    toolLibrary: cnc.toolLibrary ?? DEFAULT_TURNING_TOOLS,
    toolAssemblies: cnc.turningToolAssemblies,
    facingAllowanceMm: cnc.facingAllowanceMm,
    opApproach: { ...DEFAULT_OP_APPROACH, rapidMmPerMin },
  });
  // Per-op actual seconds and cost (efficiency applied to cutting/air alike).
  const ratePerSec = machineRatePerMin / 60;
  // The feedrate override slows CUTTING; it does not slow a rapid or a turret
  // index. Keeping the two apart matters because `cycleTimeSec` below already
  // applies it that way — when the line items did not, Settings -> Feedrate
  // moved the price without moving any row that explained it, and the
  // breakdown stopped adding up to the subtotal it is supposed to account for.
  // WHAT THE BOOK SPEEDS ACTUALLY DELIVER HERE — see realisation.ts.
  //
  // Applied to CUTTING only. A derate on surface speed and feed slows the tool
  // in metal; it does not slow a rapid, a turret index or a spindle settling,
  // and those are already counted move by move in the idle column. The
  // conditional interrupted-cut factor joins the product only when this part's
  // geometry calls for it.
  const real = realisation(cnc.realisation, partNeedsInterruptedDerate({
    odMm: input.profile.odMm,
    boreDiaMm: input.profile.boreDiaMm,
    crossFeatureCount: input.profile.crossFeatureList?.length ?? 0,
  }));
  // A POLYGON BAR INTERRUPTS ONLY THE CUTS ON ITS OUTSIDE. Turning a round out
  // of hex, the corners strike the insert six times a revolution until the
  // flats are gone — but the drill, the boring bar and the threading tool inside
  // the part never see a corner. Applied per part, the factor inflated all of
  // those too; it applies to the operations that cut the bar's outside only.
  const polygonOd = input.profile.stock?.shape === 'polygon' && (input.profile.odRegions?.length ?? 0) > 0;
  const OD_OPS = new Set<EstimatedTurningOp>(['face', 'rough', 'finish', 'groove', 'partoff']);
  const interruptedOnly = 1 / normaliseRealisation(cnc.realisation).interruptedCut;
  /** The realisation multiplier for ONE operation. */
  const opMult = (op: EstimatedTurningOp) =>
    real.multiplier * (polygonOd && !real.interruptedApplied && OD_OPS.has(op) ? interruptedOnly : 1);
  // EFFICIENCY APPLIES TO CUTTING, NOT TO IDLE — and that is a correction.
  //
  // It used to divide the whole cycle. That made sense when idle was a guess: a
  // flat tool-change allowance plus 5% of cutting for rapids. It does not make
  // sense now. Every idle second is built from a MACHINE SPECIFICATION — the
  // turret's index time, the machine's own rapid traverse, the spindle settle,
  // the clearance gap, the peck retracts — and dividing those by 0.8 asserts the
  // turret indexes 25% slower than its datasheet and the slides rapid at 24 m/min
  // when the machine is built for 30. They do not.
  //
  // What efficiency legitimately covers — an override wound back, a feed-hold, a
  // moment lost — happens while the tool is in the cut, which is where it is now
  // charged. The honest consequence is that measured idle drops further below
  // the shop's, and that is a real signal rather than a flattering one: the
  // per-operation idle model is light, and inflating machine specifications was
  // hiding by how much.
  const cutSec = (sec: number) => (sec * feedMult * real.multiplier) / eff;
  const opCost = (sec: number) => cutSec(sec) * ratePerSec;
  const airCost = (sec: number) => sec * ratePerSec;
  const theoreticalCuttingSec = t.cuttingSec;
  const cycleTimeSec =
    t.opTimes.reduce((a, o) => a + (o.cuttingSec * feedMult * opMult(o.op)) / eff, 0) + t.airSec + cnc.barLoadSec;

  // EVERY OPERATION'S TWO COLUMNS, the way a cycle sheet writes them.
  //
  // The breakdown used to charge each operation one blended figure and then add
  // two lumps at the bottom: every turret index in a single "Tool selections"
  // row, and a flat 5%-of-cutting "Rapid movement allowance" that was labelled
  // provisional because it was never measured travel. A reader could see that
  // eleven tool changes had been paid for but not which operation waited for
  // one, and the approach time was inside the cutting number, so "Drilling
  // 1.7 s" was a true figure that no machinist could recognise.
  //
  // Now each row owns its own idle — its index, its approach, its retracts —
  // and the feedrate override applies to the cutting half only, which is what
  // it always meant: turning a feed down does not slow a rapid.
  const opSplit = new Map(t.opTimes.map(o => [o.op, o]));
  const splitFor = (op: EstimatedTurningOp) =>
    opSplit.get(op) ?? { op, cuttingSec: 0, idleSec: 0 };
  /** Actual seconds for one operation: cutting scaled by the override, idle not. */
  const opSecs = (op: EstimatedTurningOp) => {
    const s = splitFor(op);
    return (s.cuttingSec * feedMult * opMult(op)) / eff + s.idleSec;
  };
  const opTotalCost = (op: EstimatedTurningOp) => opSecs(op) * ratePerSec;
  /** "3.1s cutting + 12.4s idle" — the phrase the cycle sheets are read in. */
  const splitStr = (op: EstimatedTurningOp) => {
    const s = splitFor(op);
    return `${r1((s.cuttingSec * feedMult * opMult(op)) / eff)}s cutting + ${r1(s.idleSec)}s idle`;
  };
  const machineCost = (cycleTimeSec / 60) * machineRatePerMin;

  // --- Setup (amortised over the batch) ------------------------------------
  const setups = Math.max(1, Math.round(input.setups || 1));
  // SETUP TIME — calibrated against seven Turncircuit job sheets.
  //
  // This used to be `base + tools x 3 min`, which tied setup to how many times
  // the part is CLAMPED. Lance's sheets say it is tied to which MACHINE it runs
  // on: dialling in the 5-axis mill-turn is ~900 min and the 2-axis lathe ~120,
  // whatever is in the chuck. The old formula produced 50-220 min against his
  // actual 195-2070 and, worse, was wrong by 2.5x on some parts and 17x on
  // others — so no single correction could have fixed it.
  //
  // `routeSetupMin` is the sum the ROUTE already worked out: each machine's own
  // setup character, with the second op discounted because the part exists and
  // only the holding changes. It is taken as given — scaling it again here would
  // charge the second op twice. Falls back to the old shape when no machine has
  // been chosen yet.
  const derivedSetup = routeOps?.length ? deriveRouteSetup(routeOps, {
    toolCount: t.toolCount,
    featureCount: (input.profile.crossFeatureList ?? []).length
      + (input.profile.threads ?? []).length
      + (input.profile.boreDiaMm > 0 ? 1 : 0)
      + input.profile.grooveCount + input.profile.threadCount,
    cycleMin: cycleTimeSec / 60,
  }) : null;
  const derivedProgrammingMin = derivedSetup?.perOp.reduce((sum, op) => sum + op.breakdown.programmingMin, 0) ?? 0;
  const setupTimeMin = derivedSetup ? derivedSetup.totalMin - derivedProgrammingMin : (routeSetupMin || (
    cnc.setupTimeFirstOpMin +
    (setups - 1) * cnc.secondOpSetupMin +
    t.toolCount * cnc.setupTimePerToolMin));
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
  // Still an operation allowance, not measured insert wear or replacement cost.
  const toolingCost = t.operationCount * cnc.toolingCostPerOp;

  // --- Secondary operations (plating / passivate / inspection …) -----------
  // Lot charge amortised over the batch + per-part cost; folded into subtotal so
  // overhead + margin apply the same as the machining work.
  const secondaryCost = secondaryOpsCostPerUnit(input.secondaryOps, qty);

  // --- One-time NRE: CAM programming (NRE) ---------------------------------
  // Programming/proving the turning cycle is one-time and does not recur on a
  // reorder; amortised over the first batch, excluded from the repeat price.
  const programmingMin = derivedSetup ? derivedProgrammingMin : Math.max(0, cnc.programmingMinPerSetup ?? 0) * setups;
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
  const secStr = (sec: number) => `${r1(cutSec(sec))} s`;
  // WHAT IS TURNED, in the words of the regions when the geometry gave them —
  // "⌀21 × 44 recess from 25.4 A/F hex bar", not "70 mm OD" and "4 grooves".
  const regions = input.profile.odRegions ?? [];
  const regionList = (kind: 'boss' | 'recess') => regions.filter((r) => r.kind === kind)
    .map((r) => `⌀${r1(r.diameterMm)} × ${r1(r.lengthMm)}`).join(', ');
  const roughWhat = regions.length
    ? `${regionList('boss') || 'no open bosses'} turned from ${stockDescription}`
    : `${r1(removedVol)} cm³ removed`;
  const finishWhat = regions.length ? (regionList('boss') || 'no open bosses') : `${r1(input.profile.lengthMm)} mm OD`;
  const grooveName = regions.length ? 'Recess (grooving insert)' : 'Grooving';
  const grooveWhat = regions.length
    ? `${regionList('recess') || 'no recesses'} — multi-plunge, then floor and flanks`
    : `${input.profile.grooveCount} groove${input.profile.grooveCount === 1 ? '' : 's'}`;
  // EVERY HOLE THE DRILLING ROW DRILLS. It named only the main bore's pilot, so
  // on the VOC housing it read "⌀10.5 × 14 mm deep" against 29 s that also
  // included the ⌀10 hole running 41 mm behind it — a traveller line that
  // undersold its own number by three quarters.
  const drillWhat = [
    ...(input.profile.boreDiaMm > 0 && input.profile.boreDepthMm > 0
      ? [`⌀${r1(t.drillDiaMm)} × ${r1(input.profile.boreDepthMm)} mm`] : []),
    ...(input.profile.additionalBores ?? []).map((h) => `⌀${r1(h.diameterMm)} × ${r1(h.depthMm)} mm`),
  ].join(' + ') || 'no holes';
  // What the single-point threading row is cutting: threads entered by count,
  // plus called-out ones a lathe screwcuts (a coaxial G1/4 is not tapped).
  const threadWhat = [
    ...(input.profile.threadCount > 0
      ? [`${input.profile.threadCount} thread${input.profile.threadCount === 1 ? '' : 's'}`] : []),
    ...t.screwcutCallouts.map((c) => `${c} screwcut, not tapped`),
  ].join(', ') || 'no threads';
  const lineItems: CostLineItem[] = [
    { key: 'material', name: 'Bar stock', driver: `${stockDescription} × ${r1(barLengthMm)} mm ${m.label} — ${stockWeightKg.toFixed(3)} kg @ $${input.materialPricePerKg.toFixed(2)}/kg`, value: materialCost, color: COLORS.material },
    { key: 'facing', name: 'Facing', driver: `${input.profile.faceCount} face${input.profile.faceCount === 1 ? '' : 's'} — ${splitStr('face')}`, seconds: opSecs('face'), value: opTotalCost('face'), color: COLORS.facing },
    { key: 'rough', name: 'Rough turning', driver: `${roughWhat} @ ${Math.round(m.cuttingSpeedRough * m.feedRough * m.depthOfCutRough)} cm³/min — ${splitStr('rough')}`, seconds: opSecs('rough'), value: opTotalCost('rough'), color: COLORS.rough },
    { key: 'finish', name: 'Finish turning', driver: `${finishWhat} @ ${m.cuttingSpeedFinish} m/min — ${splitStr('finish')}`, seconds: opSecs('finish'), value: opTotalCost('finish'), color: COLORS.finish },
    { key: 'deburr', name: 'Deburring', driver: `breaking the edges the cutters leave — ${splitStr('deburr')}`, seconds: opSecs('deburr'), value: opTotalCost('deburr'), color: COLORS.finish },
    { key: 'spot', name: 'Spot drilling', driver: `centre the ⌀${r1(t.drillDiaMm)} drill before it wanders — ${splitStr('spot')}`, seconds: opSecs('spot'), value: opTotalCost('spot'), color: COLORS.drill },
    { key: 'drill', name: 'Drilling', driver: `${drillWhat} — ${splitStr('drill')}`, seconds: opSecs('drill'), value: opTotalCost('drill'), color: COLORS.drill },
    { key: 'bore', name: 'Boring', driver: `finish bore ⌀${input.profile.boreDiaMm} — ${splitStr('bore')}`, seconds: opSecs('bore'), value: opTotalCost('bore'), color: COLORS.bore },
    { key: 'groove', name: grooveName, driver: `${grooveWhat} — ${splitStr('groove')}`, seconds: opSecs('groove'), value: opTotalCost('groove'), color: COLORS.groove },
    { key: 'thread', name: 'Threading (single-point)', driver: `${threadWhat} — ${splitStr('thread')}`, seconds: opSecs('thread'), value: opTotalCost('thread'), color: COLORS.thread },
    { key: 'parting', name: 'Part-off', driver: `${splitStr('partoff')}`, seconds: opSecs('partoff'), value: opTotalCost('partoff'), color: COLORS.parting },
    // Off-axis work is inside `machineCost`, so without this row the breakdown
    // stops adding up to the subtotal it is supposed to explain.
    { key: 'tap', name: 'Tapping', driver: `${(input.profile.threads ?? []).map((t) => `${Math.max(1, t.count ?? 1)}x ${t.callout}`).join(', ') || 'none'} — ${splitStr('tap')}`, seconds: opSecs('tap'), value: opTotalCost('tap'), color: COLORS.thread },
    { key: 'cross', name: 'Off-axis features (driven tool)', driver: `${input.profile.crossFeatureList?.length ?? 0} feature${(input.profile.crossFeatureList?.length ?? 0) === 1 ? '' : 's'} off the turning axis — ${splitStr('cross')}`, seconds: opSecs('cross'), value: opTotalCost('cross'), color: COLORS.drill },
    // No "Tool selections" row and no "Rapid movement allowance" row: both are
    // now inside the operations above, on the lines that cause them. This one
    // stays because it belongs to no operation — it is the bar feed and the
    // door, which is exactly how Turncircuit's sheets open too.
    { key: 'loading', name: 'Load / unload / bar feed', driver: `${cnc.barLoadSec}s per part — ${t.toolChangeCount} turret ${t.toolChangeCount === 1 ? 'index' : 'indexes'} × ${r1(toolChangeSec)}s are charged on the operations that call for them, not here`, seconds: cnc.barLoadSec, value: cnc.barLoadSec * ratePerSec, color: COLORS.noncut },
    // BOTH NUMBERS, the way a manufacturer's mileage and the real one are both
    // published. This row carries no cost of its own: the derate is already
    // inside every cutting row above. It is here so the quote states what was
    // assumed, because an allowance nobody can see is one nobody can argue with.
    { key: 'realisation', name: 'Cutting conditions (already in the rows above)', driver: `theoretical ${r1(theoreticalCuttingSec)}s at book speeds → ${r1(t.opTimes.reduce((a, o) => a + o.cuttingSec * opMult(o.op), 0))}s realised. ${real.explanation}.${polygonOd && !real.interruptedApplied ? ` Interrupted cut ${normaliseRealisation(cnc.realisation).interruptedCut} applied to the operations on the ${stockDescription}'s outside only.` : ''} ${real.applied.map((x) => `${x.name} ${x.value} (${x.why})`).join('; ')}`, seconds: 0, value: 0, color: COLORS.noncut },
    { key: 'setup', name: `Setup labour ÷ ${qty}`, driver: derivedSetup ? `${r1(setupTimeMin)} min preparation, excluding ${derivedProgrammingMin} min CAM billed separately. Full first-order breakdown: ${derivedSetup.explanation} — batch ${qty}` : `${r1(setupTimeMin)} min over ${setups} setup${setups > 1 ? 's' : ''}, batch of ${qty}`, value: setupLabourBilled / qty, color: COLORS.setup },
    { key: 'setupCharge', name: `Setup charge ÷ ${qty}`, driver: flatBilled > 0 ? `$${(cnc.flatSetupChargePerSetup ?? 0).toFixed(0)} × ${setups} setup${setups > 1 ? 's' : ''}, batch of ${qty}` : '', value: flatBilled / qty, color: COLORS.setup },
    { key: 'tooling', name: 'Tooling / consumables', driver: `${t.operationCount} operations — provisional allowance, not a tool-life calculation`, value: toolingCost, color: COLORS.tooling },
    { key: 'nre', name: `CAM programming (one-time) ÷ ${qty}`, driver: `${r1(programmingMin)} min NRE over ${setups} setup${setups > 1 ? 's' : ''}, batch of ${qty} — not billed again on reorder`, value: programmingPerUnit, color: COLORS.nre },
    ...secondaryOpsLineItems(input.secondaryOps, qty),
    // The realisation row is explanatory and carries no cost of its own, so it
    // has to survive the zero filter that drops operations a part does not have.
  ].filter((li) => Math.abs(li.value) > 0 || li.key === 'realisation');

  // --- Per-setup / per-operation plan (a turning job sheet) ----------------
  // Same seconds as the line items, grouped the way a turner reads a job. A
  // bar-fed / sliding-head part runs in ONE setup; a second op (back-face /
  // cross features) is listed but not itemised because those features are not
  // in the cycle-time estimate. Tools come from the shop turning library.
  const toolFor = (op: EstimatedTurningOp, fallback: string) =>
    t.toolAssignments.find(a => a.op === op)?.label ?? fallback;
  const p = input.profile;
  // Each entry carries its OP. The tool for a plan row used to be found by
  // ARRAY INDEX into t.toolAssignments, which silently assumed the two lists were
  // the same length in the same order — adding one operation here misaligned
  // every row after it and read a tool off the end of the array.
  const opSrc: Array<{ op: EstimatedTurningOp; name: string; sec: number; tool: string; driver: string; color: string }> = [
    { op: 'face', name: 'Facing', sec: t.facingSec, tool: toolFor('face', 'OD turning tool'), driver: `${p.faceCount} face${p.faceCount === 1 ? '' : 's'}`, color: COLORS.facing },
    { op: 'rough', name: 'Rough turning', sec: t.roughSec, tool: toolFor('rough', 'OD turning tool'), driver: roughWhat, color: COLORS.rough },
    { op: 'deburr', name: 'Deburring', sec: t.deburrSec, tool: toolFor('deburr', 'Chamfer / deburr tool'), driver: 'break the edges — drawing says burr free', color: COLORS.finish },
    { op: 'spot', name: 'Spot drilling', sec: t.spotSec, tool: toolFor('spot', 'Spot / centre drill'), driver: `centre the ⌀${r1(t.drillDiaMm)} drill`, color: COLORS.drill },
    { op: 'drill', name: 'Drilling', sec: t.drillSec, tool: toolFor('drill', 'Carbide drill'), driver: drillWhat, color: COLORS.drill },
    { op: 'bore', name: 'Boring', sec: t.boreSec, tool: toolFor('bore', 'Boring bar'), driver: `⌀${r1(t.drillDiaMm)} → ⌀${r1(p.boreDiaMm)}, ${r1((p.boreDiaMm - t.drillDiaMm) / 2)} mm off the wall`, color: COLORS.bore },
    { op: 'finish', name: 'Finish turning', sec: t.finishSec, tool: toolFor('finish', 'OD finishing tool'), driver: finishWhat, color: COLORS.finish },
    { op: 'groove', name: grooveName, sec: t.grooveSec, tool: toolFor('groove', 'Unassigned groove tool'), driver: grooveWhat, color: COLORS.groove },
    { op: 'thread', name: 'Threading', sec: t.threadSec, tool: toolFor('thread', 'Unassigned thread tool'), driver: threadWhat, color: COLORS.thread },
    { op: 'partoff', name: 'Part-off', sec: t.partingSec, tool: toolFor('partoff', 'Parting blade'), driver: 'cut to length', color: COLORS.parting },
    { op: 'tap', name: 'Tapping', sec: t.tapSec, tool: toolFor('tap', 'Unassigned tap tool'), driver: (p.threads ?? []).map((th) => `${Math.max(1, th.count ?? 1)}x ${th.callout}`).join(', ') || 'threads', color: COLORS.thread },
    { op: 'cross', name: 'Off-axis features', sec: t.crossSec, tool: toolFor('cross', 'Unassigned cross tool'), driver: `${p.crossFeatureList?.length ?? 0} cross feature${(p.crossFeatureList?.length ?? 0) === 1 ? '' : 's'}`, color: COLORS.drill },
  ];
  const planOps: PlanOperation[] = opSrc
    // Keep every operation that carries real time. The old half-second floor was
    // meant to drop operations that do not exist (no grooves, no thread → zero
    // seconds), but on a small part it also hid REAL work: a ⌀14 × 11 mm bar
    // part had its rough turning and pilot drill removed from the plan while the
    // reference toolpath still listed them, so the two views of the same part
    // disagreed and the drill looked un-costed. It never was: the seconds are in
    // the cycle either way — only the display dropped them.
    .filter((o) => o.sec > 0)
    .map((o, i, all) => {
      const s = splitFor(o.op);
      const changed = i === 0 || all[i - 1].tool !== o.tool;
      return {
        op: o.op,
        name: o.name,
        tool: o.tool,
        // The row's OWN total now — cutting, approach, retract and the index
        // that brought this tool round. It used to be cutting-plus-approach
        // with the index sitting in a separate row at the bottom, which is why
        // "Drilling 1.7 s" looked impossible: true for the metal, but a
        // machinist counts getting the drill there as part of drilling.
        seconds: opSecs(o.op),
        cuttingSeconds: (s.cuttingSec * feedMult * opMult(o.op)) / eff,
        idleSeconds: s.idleSec,
        cost: opTotalCost(o.op),
        color: o.color,
        driver: `${o.driver} · ${splitStr(o.op)}`
          + (changed
            ? ` (idle includes ${r1(toolChangeSec)}s to bring this tool round)`
            : ' · same tool as above, no index'),
      };
    });
  // The plan now accounts for the whole cycle on its own rows: no air lump to
  // add back, because there is no longer one. Bar load is still outside the
  // operations because it belongs to the job, not to a cut.
  const setup1Sec = planOps.reduce((a, o) => a + o.seconds, 0) + cnc.barLoadSec;
  const setup1Cost = planOps.reduce((a, o) => a + o.cost, 0) + cnc.barLoadSec * ratePerSec;
  const planSetups = [
    // NAMED "Op", not "Setup". These groups are FIXTURINGS and the time against
    // them is CUTTING time; "Setup labour" further down is the time to prepare
    // the machine. Calling both of them "setup" put 2m 15s and 900 min in the
    // same table under the same word, which reads as a contradiction.
    { index: 1, name: setups > 1 ? 'Op 1 — main turning' : 'Op 1', operations: planOps, seconds: setup1Sec, cost: setup1Cost, toolChanges: t.toolChangeCount },
  ];
  if (setups > 1) {
    // The second op used to be an empty row costing nothing, which reads as "no
    // work here" — when what it actually means is "there IS work here and its
    // cycle time is NOT estimated". On part 029068 that hid a ⌀1 drill breaking
    // through the OD: detected, given 20 minutes of second-op setup labour, and
    // then shown as a blank line, so it looked like the engine had missed it.
    //
    // These operations carry zero seconds ON PURPOSE — a cross feature is cut
    // with live tooling that this turning model does not estimate. Naming them
    // is what turns a silent exclusion into a stated one.
    const cross = p.crossFeatureDiametersMm ?? [];
    const secondOps: PlanOperation[] = cross.map((dia, i) => ({
      name: `Off-axis feature ⌀${r1(dia)}`,
      tool: 'Live tooling / second op',
      seconds: 0,
      cost: 0,
      driver: `${i + 1} of ${cross.length} — NOT in the turned cycle time; add its time and tooling separately`,
      color: COLORS.groove,
    }));
    if (!secondOps.length && p.crossFeatures) {
      secondOps.push({
        name: 'Off-axis feature(s)',
        tool: 'Live tooling / second op',
        seconds: 0,
        cost: 0,
        driver: 'NOT in the turned cycle time; add its time and tooling separately',
        color: COLORS.groove,
      });
    }
    planSetups.push({
      index: 2,
      name: 'Op 2 — second op (back-face / cross features)',
      operations: secondOps,
      seconds: 0,
      cost: 0,
      toolChanges: 0,
    });
  }
  const planToolAgg = new Map<string, { name: string; ops: number; seconds: number }>();
  for (const o of planOps) {
    const identity = t.toolAssignments.find((a) => a.op === o.op)?.identity ?? `unassigned:${o.op}`;
    const cur = planToolAgg.get(identity) ?? { name: o.tool, ops: 0, seconds: 0 };
    cur.ops += 1;
    cur.seconds += o.seconds;
    planToolAgg.set(identity, cur);
  }
  const plan: MachiningPlan = {
    setups: planSetups,
    toolingWarnings: [...new Set(t.toolAssignments.flatMap(a => a.warning ? [a.warning] : [])),
      ...(t.crossSec > 0 || t.tapSec > 0 ? ['Cross-feature and tapping tools are grouped estimates; confirm the individual tools and sequence.'] : [])],
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
    partVolumeCm3: partVol,
    stockVolumeCm3,
    removedVolumeCm3: removedVol,
    buyToFlyRatio: Math.round(buyToFlyRatio * 100) / 100,
    barDiameterMm,
    stockDescription,
    cycleTimeSec: Math.round(cycleTimeSec),
    setupTimeMin: r1(setupTimeMin),
    // The per-machine split, so the traveller can name the right work centre on
    // each line instead of stamping the primary machine on all of them.
    setupByMachine: derivedSetup?.perOp.map((o) => ({
      machineName: o.machineName,
      setups: o.setups,
      setupMin: o.breakdown.totalMin - o.breakdown.programmingMin,
    })),
    setups,
    nreCost,
    repeatUnitPrice,
    efficiencyFactor: eff,
    batchCurve,
    plan,
    machineClass: 'turn',
  };
}
