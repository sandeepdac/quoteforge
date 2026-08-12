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
  setups: number;
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

  // --- Chamfer / edge-break: carved from the finish budget so the total is
  // unchanged, shown as its own op when there are edges worth breaking. -----
  let chamfer: SubOp | null = null;
  if ((inp.holeCount > 0 || inp.bossCount > 0) && cham) {
    const chamSec = Math.min(inp.finishBaseSec * 0.08, 30);
    if (chamSec > 0.5) {
      const wall = subs.find((o) => o.name === 'Wall finishing');
      if (wall) wall.sec = Math.max(0, wall.sec - chamSec); // conserve total time
      chamfer = {
        name: 'Chamfer / edge break',
        tool: toolName(cham, 'Chamfer mill'),
        sec: chamSec,
        driver: `${inp.holeCount} holes + edges`,
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
  const setups = Math.min(requested, fillable);

  // --- Distribute the work across the real setups --------------------------
  // Round-robin in cut order: roughing lands in setup 1, later setups pick up
  // finishing and drilling — the way a re-clamped job spreads work, instead of
  // piling every operation into the first setup and leaving the rest empty.
  const ops: DraftOp[] = [];
  subs.forEach((s, i) => ops.push({ ...s, setup: (i % setups) + 1 }));
  if (chamfer) ops.push({ ...chamfer, setup: setups }); // edge-break on the last setup

  // --- Facing (once per real setup — you skim each re-clamped face) ---------
  const facePerSetup = inp.facingSec / setups;
  if (facePerSetup > 0.5) {
    for (let s = 1; s <= setups; s++) {
      ops.push({
        name: 'Facing',
        tool: toolName(face, 'Face mill'),
        sec: facePerSetup,
        driver: `skim face @ ${r1(face?.vc ?? 0)} m/min`,
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
