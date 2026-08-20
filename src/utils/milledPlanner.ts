/**
 * MILLED OPERATION PLANNER — expands the milling cost model's cutting-time
 * buckets into a tool-by-tool job sheet, the way a CAM system lists operations:
 * face → adaptive rough → rest-rough → wall/floor finish → a drill op per hole
 * size → chamfer, each tied to a real cutter from the shop tool library.
 *
 * It REDISTRIBUTES the same theoretical seconds the estimator already computed
 * (facing / roughing / finishing / drilling / small-tool detail) — it does not
 * invent new time — so the calibrated quote total is unchanged; this only
 * controls which tools appear and how the work reads as operations and setups.
 */
import type { MaterialProps } from './materials';
import type { MachiningPlan, PlanOperation, PlanSetup } from '../types';
import {
  millingToolsFor,
  faceMill,
  roughingTool,
  wallFinisher,
  floorFinisher,
  detailTool,
  restRoughTool,
  chamferTool,
  groupHoles,
  MillingTool,
} from './millingTools';

export interface MilledPlanInput {
  m: MaterialProps;
  minPlaneDimMm: number;
  /** Theoretical seconds (pre-efficiency), matching the estimator's buckets. */
  facingSec: number;
  roughBaseSec: number;
  finishBaseSec: number;
  /** Extra small-tool detail seconds split out of rough/finish (deepMult − 1). */
  roughComplexSec: number;
  finishComplexSec: number;
  drillSec: number;
  removedVolCm3: number;
  millMrr: number;
  finishAreaCm2: number;
  finishRate: number;
  holeCount: number;
  holeDiametersMm?: number[];
  maxDrillMm: number;
  bossCount: number;
  /** Seconds of on-axis TURNING (spindle work), when the route is a lathe. */
  turningSec?: number;
  /** The on-axis features that turning covers — named in the traveller. */
  turnedFeatures?: Array<{ kind: 'bore' | 'spigot'; diameterMm: number; lengthMm: number }>;
  /** The chosen machine has a spindle that turns — changes the tool vocabulary. */
  turningRoute?: boolean;
  /** MEASURED conical work: countersinks and chamfers, with their own seconds.
   *  Absent (0) means the geometry service found none — not that none were
   *  looked for, which was the situation until cones were inspected at all. */
  countersinkSec?: number;
  chamferSec?: number;
  countersinks?: Array<{ diameterMm: number; includedDeg: number; depthMm: number; count?: number }>;
  chamfers?: Array<{ diameterMm: number; includedDeg: number; depthMm: number; count?: number }>;
  setups: number;
  /**
   * Setups that exist for WORKHOLDING, not for work volume — a hole drilled on a
   * compound angle needs its own tilted fixture or rotation even if that is the
   * only thing done in it. These must survive the phantom-setup merge below.
   */
  angledSetups?: number;
  eff: number;
  /** theoretical sec → machine cost. */
  opCost: (sec: number) => number;
  toolChangeSec: number;
  colors: Record<string, string>;
}

interface DraftOp {
  name: string;
  tool: string;
  sec: number; // theoretical
  driver: string;
  color: string;
  setup: number; // 1-based
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const toolName = (t: MillingTool | undefined, fallback: string) => (t ? t.description : fallback);

/** A substantive (non-facing) operation, before it is assigned to a setup. */
interface SubOp {
  name: string;
  tool: string;
  sec: number;
  driver: string;
  color: string;
  /**
   * Force this operation into a specific setup. Turning operations are pinned to
   * the first holding: the OD and the bore are cut in ONE chucking on a lathe —
   * you do not turn a diameter, unclamp, and come back to bore it concentric
   * with it. Round-robin distribution is right for independent milling passes
   * and wrong for a turned register.
   */
  pinSetup?: number;
}

/** Build the tool-specific, setup-grouped plan. */
export function buildMilledPlan(inp: MilledPlanInput): MachiningPlan {
  const c = inp.colors;
  const tools = millingToolsFor(inp.m);
  const face = faceMill(tools);
  const rough = roughingTool(tools, inp.minPlaneDimMm);
  const wallFin = wallFinisher(tools, rough);
  const floorFin = floorFinisher(tools);
  const detail = detailTool(tools);
  const restRough = restRoughTool(tools, rough);
  const cham = chamferTool(tools);

  // --- Substantive operations, in cut order (setup assignment comes after) --
  // These are the real cutting operations; facing is added per-setup below. We
  // gather them first so we can size the setup count to the work that actually
  // exists — never emitting a setup that would carry only a facing skim.
  const subs: SubOp[] = [];
  const addSub = (o: SubOp) => {
    if (o.sec > 0.5) subs.push(o);
  };

  // On a lathe or mill-turn the on-axis features are cut by the SPINDLE, with
  // turning tools — a boring bar and an OD tool, not an end mill. Listing them
  // as milling operations was the visible symptom of the whole turned-vs-milled
  // gap: the traveller told the programmer to interpolate a bore the machine
  // could simply bore.
  const turnedBores = (inp.turnedFeatures ?? []).filter((f) => f.kind === 'bore');
  const turnedOds = (inp.turnedFeatures ?? []).filter((f) => f.kind === 'spigot');
  if ((inp.turningSec ?? 0) > 0.5 && (turnedBores.length || turnedOds.length)) {
    const total = turnedBores.length + turnedOds.length;
    const odShare = (inp.turningSec ?? 0) * (turnedOds.length / total);
    const boreShare = (inp.turningSec ?? 0) * (turnedBores.length / total);
    addSub({
      name: turnedOds.length ? `Turn OD ⌀${r1(turnedOds[0].diameterMm)}` : 'Turn OD',
      tool: 'OD turning tool (CNMG insert)',
      sec: odShare,
      driver: turnedOds.map((f) => `⌀${r1(f.diameterMm)}×${r1(f.lengthMm)}`).join(', ') || 'on-axis profile',
      color: c.turn ?? c.rough,
      pinSetup: 1,
    });
    addSub({
      name: turnedBores.length ? `Bore ⌀${r1(turnedBores[0].diameterMm)} (turned)` : 'Boring',
      tool: 'Boring bar',
      sec: boreShare,
      driver: turnedBores.map((f) => `⌀${r1(f.diameterMm)}×${r1(f.lengthMm)} deep`).join(', ') || 'on-axis bore',
      color: c.turn ?? c.drill,
      pinSetup: 1,
    });
  }

  addSub({
    name: 'Adaptive roughing',
    tool: toolName(rough, 'Roughing end mill'),
    sec: inp.roughBaseSec,
    driver: `${r1(inp.removedVolCm3)} cm³ @ ${r1(inp.millMrr)} cm³/min`,
    color: c.rough,
  });
  addSub({
    name: 'Rest roughing',
    tool: toolName(restRough, 'Mid end mill'),
    sec: inp.roughComplexSec,
    driver: `corners / narrow features ⌀${r1(restRough?.diaMm ?? 6)}`,
    color: c.deep,
  });
  addSub({
    name: 'Wall finishing',
    tool: toolName(wallFin, 'Finisher'),
    sec: inp.finishBaseSec * 0.6,
    driver: `${r1(inp.finishAreaCm2 * 0.6)} cm² walls @ ${r1(inp.finishRate)} cm²/min`,
    color: c.finish,
  });
  addSub({
    name: 'Floor finishing',
    tool: toolName(floorFin, 'Ball finisher'),
    sec: inp.finishBaseSec * 0.4,
    driver: `${r1(inp.finishAreaCm2 * 0.4)} cm² floors @ ${r1(inp.finishRate)} cm²/min`,
    color: c.finish,
  });
  addSub({
    name: 'Detail finishing',
    tool: toolName(detail, 'Small finisher'),
    sec: inp.finishComplexSec,
    driver: `small-tool detail ⌀${r1(detail?.diaMm ?? 3)}`,
    color: c.deep,
  });

  // --- Drilling: one operation per hole size (like a CAM plan) -------------
  const groups = groupHoles(inp.holeDiametersMm, inp.holeCount, inp.maxDrillMm);
  const totalHoles = groups.reduce((a, g) => a + g.count, 0) || 1;
  for (const g of groups) {
    const secShare = inp.drillSec * (g.count / totalHoles);
    if (g.interpolate) {
      addSub({
        name: `Bore / interpolate ⌀${r1(g.drillMm)}`,
        tool: toolName(rough, 'End mill (helical)'),
        sec: secShare,
        driver: `${g.count} hole${g.count === 1 ? '' : 's'} too big to drill — milled`,
        color: c.drill,
      });
    } else {
      addSub({
        name: `Drilling ⌀${r1(g.drillMm)}`,
        tool: `⌀${r1(g.drillMm)} mm drill`,
        sec: secShare,
        driver: `${g.count} hole${g.count === 1 ? '' : 's'}`,
        color: c.drill,
      });
    }
  }

  // --- Countersinks: a MEASURED operation with its own tool ----------------
  // Conical faces were never inspected, so countersinks were invisible. Now the
  // ⌀ and included angle come off the solid, which means the traveller can name
  // the tool a programmer would actually pick.
  const csinks = inp.countersinks ?? [];
  const nCsink = csinks.reduce((n, x) => n + Math.max(1, x.count ?? 1), 0);
  if ((inp.countersinkSec ?? 0) > 0.5 && nCsink > 0) {
    const angles = [...new Set(csinks.map((x) => Math.round(x.includedDeg)))];
    addSub({
      name: `Countersink ⌀${r1(csinks[0].diameterMm)}`,
      tool: `⌀${r1(csinks[0].diameterMm)} × ${angles[0]}° countersink`,
      sec: inp.countersinkSec ?? 0,
      driver: `${nCsink} countersink${nCsink === 1 ? '' : 's'} — ${csinks.map((x) => `⌀${r1(x.diameterMm)}@${Math.round(x.includedDeg)}°`).join(', ')}`,
      color: c.drill,
    });
  }

  // --- Chamfer / edge break ------------------------------------------------
  // When chamfers are MEASURED the time is real and additive: it is work that
  // was simply never counted. Without measurements the old behaviour stands — a
  // slice carved out of the finish budget so the total is conserved, which was
  // only ever a placeholder for "there are edges here, someone breaks them".
  let chamfer: SubOp | null = null;
  const chamfs = inp.chamfers ?? [];
  const nCham = chamfs.reduce((n, x) => n + Math.max(1, x.count ?? 1), 0);
  if ((inp.chamferSec ?? 0) > 0.5 && nCham > 0) {
    chamfer = {
      name: 'Chamfer / edge break',
      tool: toolName(cham, 'Chamfer mill'),
      sec: inp.chamferSec ?? 0,
      driver: `${nCham} measured chamfer${nCham === 1 ? '' : 's'} — ${chamfs.map((x) => `⌀${r1(x.diameterMm)}@${Math.round(x.includedDeg)}°`).join(', ')}`,
      color: c.facing,
    };
  } else if ((inp.holeCount > 0 || inp.bossCount > 0) && cham) {
    const chamSec = Math.min(inp.finishBaseSec * 0.08, 30);
    if (chamSec > 0.5) {
      const wall = subs.find((o) => o.name === 'Wall finishing');
      if (wall) wall.sec = Math.max(0, wall.sec - chamSec); // conserve total time
      chamfer = {
        name: 'Chamfer / edge break (estimated)',
        tool: toolName(cham, 'Chamfer mill'),
        sec: chamSec,
        driver: `${inp.holeCount} holes + edges — no chamfer geometry found, allowance only`,
        color: c.facing,
      };
    }
  }

  // --- Size the setup count to the real work -------------------------------
  // A 3-axis part is re-clamped once per access direction, but the plan must
  // never claim more setups than it has distinct operations to fill: a setup
  // with only a facing skim is a phantom (part 12630 showed 6 setups, 4 of them
  // facing-only). Cap the requested count at the number of substantive ops.
  const requested = Math.max(1, Math.round(inp.setups));
  const fillable = Math.max(1, subs.length + (chamfer ? 1 : 0));
  // ...but an ANGLED setup is not a phantom. It is forced by workholding — you
  // must re-fixture (or index a 4th/5th axis) to reach a compound-angle hole,
  // even if that setup carries a single short operation. Merging those away
  // would quietly re-create the very under-costing this exists to fix, so they
  // set a floor: one main setup plus one per angled tool axis.
  const angled = Math.max(0, Math.round(inp.angledSetups ?? 0));
  const setups = Math.max(Math.min(requested, fillable), Math.min(requested, 1 + angled));

  // --- Distribute the work across the real setups --------------------------
  // Round-robin in cut order: roughing lands in setup 1, later setups pick up
  // finishing and drilling — the way a re-clamped job spreads work, instead of
  // piling every operation into the first setup and leaving the rest empty.
  const ops: DraftOp[] = [];
  let slot = 0;
  for (const s of subs) {
    if (s.pinSetup) {
      ops.push({ ...s, setup: Math.min(setups, Math.max(1, s.pinSetup)) });
      continue; // pinned work does not consume a round-robin slot
    }
    ops.push({ ...s, setup: (slot % setups) + 1 });
    slot += 1;
  }
  if (chamfer) ops.push({ ...chamfer, setup: setups }); // edge-break on the last setup

  // --- Facing (once per real setup — you skim each re-clamped face) ---------
  const facePerSetup = inp.facingSec / setups;
  if (facePerSetup > 0.5) {
    for (let s = 1; s <= setups; s++) {
      ops.push({
        name: 'Facing',
        // On a lathe the face is spiralled from OD to centre with a turning
        // insert; a face mill on a turning machine is the same category error as
        // interpolating a bore it could simply bore.
        tool: inp.turningRoute ? 'Facing tool (turning insert)' : toolName(face, 'Face mill'),
        sec: facePerSetup,
        driver: inp.turningRoute
          ? 'face on the spindle, OD → centre'
          : `skim face @ ${r1(face?.vc ?? 0)} m/min`,
        color: c.facing,
        setup: s,
      });
    }
  }

  // --- Group into setups ----------------------------------------------------
  const planSetups: PlanSetup[] = [];
  for (let s = 1; s <= setups; s++) {
    const mine = ops.filter((o) => o.setup === s);
    const distinctTools = new Set(mine.map((o) => o.tool)).size;
    const changeSec = distinctTools * inp.toolChangeSec;
    const operations: PlanOperation[] = mine.map((o) => ({
      name: o.name,
      tool: o.tool,
      seconds: o.sec / inp.eff,
      cost: inp.opCost(o.sec),
      driver: o.driver,
      color: o.color,
    }));
    const seconds = operations.reduce((a, o) => a + o.seconds, 0) + changeSec / inp.eff;
    const cost = operations.reduce((a, o) => a + o.cost, 0) + inp.opCost(changeSec);
    planSetups.push({
      index: s,
      name: `Setup ${s}`,
      operations,
      seconds,
      cost,
      toolChanges: distinctTools,
    });
  }

  // --- Tool summary ---------------------------------------------------------
  const agg = new Map<string, { name: string; ops: number; seconds: number }>();
  for (const s of planSetups) {
    for (const o of s.operations) {
      const cur = agg.get(o.tool) ?? { name: o.tool, ops: 0, seconds: 0 };
      cur.ops += 1;
      cur.seconds += o.seconds;
      agg.set(o.tool, cur);
    }
  }

  return {
    setups: planSetups,
    tools: [...agg.values()].sort((a, b) => b.seconds - a.seconds),
    totalSeconds: planSetups.reduce((a, s) => a + s.seconds, 0),
    totalCost: planSetups.reduce((a, s) => a + s.cost, 0),
  };
}
