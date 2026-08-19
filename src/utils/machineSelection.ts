/**
 * MACHINE SELECTION — which machine should make this part, and why?
 *
 * Turncircuit runs several machine types with different capabilities and running
 * costs. The client's headline question: can the tool tell them apart, and pick
 * the most efficient machine that can actually make the part?
 *
 * The logic is two-stage, matching how a shop thinks:
 *   1. CAPABILITY (a hard gate) — can the machine physically make it?
 *        • diameter within the machine's bar / chuck capacity
 *        • off-axis (cross) features need LIVE TOOLING; a plain 2-axis lathe
 *          would need a separate milling second-op
 *        • prismatic parts go to a machining centre, not a lathe
 *   2. EFFICIENCY (the tie-break among capable machines) — the cheapest route:
 *        • small bar-fed parts run cheapest on a SLIDING-HEAD (continuous bar
 *          feed, unattended, a guide bush supports slender work)
 *        • larger plain-turned parts run on a 2-axis lathe (simplest machine)
 *        • cross/milling features on a turned part want a TURN-MILL (one setup)
 *        • a prismatic part needing many tool-access directions is cheaper on a
 *          5-AXIS mill (fewer re-fixtures) than a 3-axis run in many setups
 *        • a prismatic part with a ROUND-ish cross-section that fits the bar
 *          capacity is made from ROUND BAR on a TURN-MILL — turned to profile
 *          and milled with driven tools in ONE clamp ("all faces in one op"),
 *          which is how a mill-turn shop actually cuts these parts.
 *
 * The recommendation carries a `rateMultiplier` so the choice actually moves the
 * quote — a turn-mill minute costs more than a sliding-head minute. Advisory
 * defaults; a shop tunes the catalog to its own machines and rates.
 *
 * A shop can also declare WHICH machines it owns (`ownedMachines`); the selector
 * then only compares the machines actually on the floor — so "I have a 5-axis
 * mill and a 5-axis turning centre, which is best for this part?" is answered
 * against that real inventory, not a generic catalog.
 */
import { nextStandardBar } from './materials';

export type MachineId =
  | 'sliding-head'
  | 'cnc-lathe-2axis'
  | 'turn-mill'
  | 'mill-3axis'
  | 'mill-5axis';

/** Which machining route a part is costed on — bar (turn / mill-turn) or billet (mill). */
export type MachiningRoute = 'turn' | 'mill' | 'mill-turn';
/** The raw stock the chosen route buys. */
export type StockForm = 'bar' | 'billet' | 'plate';

export interface MachineSpec {
  id: MachineId;
  name: string;
  kind: 'turn' | 'mill';
  /** Driven tools — can cut off-axis (cross-holes, flats, milling on a turned part). */
  liveTooling: boolean;
  /** Largest workpiece diameter this machine can turn (mm). Turning machines only. */
  maxTurnDiaMm?: number;
  /** Bar-fed (continuous stock feed, unattended small parts). */
  barFed?: boolean;
  /** Simultaneous axes (a proxy for multi-face reach in one setup). */
  axes: number;
  /** Relative machine charge-out vs the baseline spindle rate (advisory). */
  rateMultiplier: number;
  note: string;
}

export const MACHINE_CATALOG: Record<MachineId, MachineSpec> = {
  'sliding-head': {
    id: 'sliding-head', name: 'Sliding-Head (Swiss) Lathe', kind: 'turn',
    liveTooling: true, maxTurnDiaMm: 32, barFed: true, axes: 5, rateMultiplier: 1.0,
    note: 'Bar-fed small precision turning; guide bush supports slender work; driven tools for cross-features.',
  },
  'cnc-lathe-2axis': {
    id: 'cnc-lathe-2axis', name: '2-Axis CNC Lathe', kind: 'turn',
    liveTooling: false, maxTurnDiaMm: 250, barFed: false, axes: 2, rateMultiplier: 0.9,
    note: 'Simple, low-cost turning for larger plain-turned / chucked parts. No live tooling.',
  },
  'turn-mill': {
    id: 'turn-mill', name: 'Multi-Axis Turn-Mill Centre', kind: 'turn',
    liveTooling: true, maxTurnDiaMm: 65, barFed: true, axes: 5, rateMultiplier: 1.35,
    note: 'Turning + milling in one setup (Y-axis, sub-spindle). Round bar, driven tools — hits every face in one op. Premium rate; earns it by eliminating setups and a second machine.',
  },
  'mill-3axis': {
    id: 'mill-3axis', name: '3-Axis Machining Centre', kind: 'mill',
    liveTooling: true, axes: 3, rateMultiplier: 1.1,
    note: 'Prismatic milling; reaches features from one direction per setup.',
  },
  'mill-5axis': {
    id: 'mill-5axis', name: '5-Axis Machining Centre', kind: 'mill',
    liveTooling: true, axes: 5, rateMultiplier: 1.6,
    note: 'Reaches multiple faces in one clamp; premium rate offset by far fewer setups.',
  },
};

/** All machine ids in catalog order — the default "owns everything" set. */
export const ALL_MACHINE_IDS: MachineId[] = [
  'sliding-head', 'cnc-lathe-2axis', 'turn-mill', 'mill-3axis', 'mill-5axis',
];

export interface MachineSelectionInput {
  isTurned: boolean;
  // Turned drivers
  odMm?: number;
  barDiameterMm?: number;
  lengthMm?: number;
  crossFeatures?: boolean;
  // Milled drivers
  setupCount?: number;
  /**
   * Setups forced by hole/bore axes on a COMPOUND ANGLE. These survive every
   * route: even a turn-mill that does the rest in one clamp must still index or
   * tilt to reach them, so they must never be collapsed away.
   */
  angledSetups?: number;
  pocketCount?: number;
  bossCount?: number;
  /** Measured bounding box (mm) — lets a milled part be tested for round-bar fit. */
  partDimsMm?: { x: number; y: number; z: number };
  /** Finished part volume (cm³) — decides whether the cross-section is round (fits
   *  a bar of its width) or square-cornered (needs a bar of its diagonal). */
  partVolumeCm3?: number;
  /**
   * Machines the shop actually owns. When set, only these compete and the
   * recommendation is the best AMONG THEM. Omit to consider the whole catalog.
   */
  ownedMachines?: MachineId[];
}

export interface MachineCandidate {
  id: MachineId;
  name: string;
  capable: boolean;
  /** Short capability verdict for this machine. */
  reason: string;
}

export interface MachineRecommendation {
  recommended: MachineId;
  recommendedName: string;
  /** Machine charge-out multiplier to apply to the spindle rate. */
  rateMultiplier: number;
  /** Why this machine was chosen (plain language). */
  reasons: string[];
  /** Every relevant machine with its capability verdict — the "show the working". */
  candidates: MachineCandidate[];
  /** Set when a chosen route implies a separate milling second-op. */
  secondOpNote?: string;
  /** How the part is costed: turn / mill / mill-turn (round bar + driven tools). */
  route: MachiningRoute;
  /** Raw stock the route buys — bar (turn / mill-turn) or billet/plate (mill). */
  stockForm: StockForm;
  /** Round bar ⌀ (mm) when the route runs from bar — else undefined. */
  barDiameterMm?: number;
  /** Setups the chosen route actually needs (a mill-turn collapses many → 1–2). */
  effectiveSetups?: number;
}

const SLENDER_WARN = 10; // L/D above which a guide bush (sliding-head) really helps
const BAR_RADIAL_ALLOWANCE_MM = 2; // clean-up stock over the finished OD before the next bar size
const BAR_CROSS_BALANCE_MIN = 0.55; // cross-section must be roughly round/square (not a flat plate) for bar work
const BAR_CORNER_FILL = 1.05;       // cross fills ≤ this fraction of a ⌀=width cylinder → round enough to fit that bar
const BAR_MIN_FILL = 0.5;           // ...and ≥ this, or the solid is a block inside a notional cylinder, not bar work
const BAR_MIN_ASPECT = 1.2;         // bar work runs along its length: a disc/flange is chucked, not bar-fed

/** Is a machine on the shop floor? (No inventory declared → the whole catalog.) */
function ownsFn(owned?: MachineId[]) {
  const set = owned && owned.length ? new Set(owned) : null;
  return (id: MachineId) => (set ? set.has(id) : true);
}

/**
 * Reduce a bounding box to a turning cross-section: the pair of dimensions most
 * nearly equal is the diameter (round bar spans them); the remaining dimension is
 * the length along the bar axis. Mirrors the turned/milled classifier so bar
 * eligibility is consistent with how a part was classed.
 */
function crossSection(dims: { x: number; y: number; z: number }) {
  const [a, b, c] = [dims.x, dims.y, dims.z].map((d) => Math.max(0, d)).sort((p, q) => q - p);
  const pairs = [
    { hi: a, lo: b, axis: c }, // longest two are the cross-section
    { hi: a, lo: c, axis: b },
    { hi: b, lo: c, axis: a }, // shortest two are the cross-section (a disc/puck)
  ];
  // The roundest cross-section is the pair whose two members are closest in size.
  const best = pairs.reduce((m, p) => (p.hi > 0 && p.lo / p.hi > m.lo / m.hi ? p : m), pairs[0]);
  const widthMm = best.hi;               // largest cross dimension
  const balance = best.hi > 0 ? best.lo / best.hi : 0; // 1 = square/round cross-section
  const diagonalMm = Math.sqrt(best.hi * best.hi + best.lo * best.lo);
  return { widthMm, balance, diagonalMm, lengthMm: best.axis };
}

/** Can this milled part be made from round bar on a turn-mill? Full working. */
function barFit(input: MachineSelectionInput) {
  const dims = input.partDimsMm;
  const tm = MACHINE_CATALOG['turn-mill'];
  const cap = tm.maxTurnDiaMm ?? 0;
  if (!dims) return null;
  const cs = crossSection(dims);
  if (cs.widthMm <= 0) return null;

  // Is the cross-section round enough to sit inside a bar of its WIDTH, or does it
  // have square corners that would need a bar of its DIAGONAL? Judge from how full
  // the solid is relative to a cylinder of ⌀=width: a turned/round cross-section
  // fills ≲ π/4 of the width-box, a square-cornered block fills more.
  const cylOfWidthCm3 = (Math.PI / 4) * cs.widthMm * cs.widthMm * cs.lengthMm / 1000;
  const cylFill = cylOfWidthCm3 > 0 && (input.partVolumeCm3 ?? 0) > 0
    ? (input.partVolumeCm3 as number) / cylOfWidthCm3
    : 0.7; // unknown volume → assume round-ish (fits the width bar)
  // Roundness is a TWO-SIDED test, and getting that wrong is what routed a
  // prismatic block to round bar:
  //   • too FULL (> ~1.05) → square corners stick out past the width-cylinder,
  //     so the bar must span the diagonal, not the width;
  //   • too EMPTY (< ~0.5) → the solid occupies only a fraction of the bar that
  //     contains it. That is not a body of revolution, it is a block sitting
  //     inside a notional cylinder. Everything fits inside SOME cylinder, so
  //     "fits" alone is no evidence at all — a 61×52×47 block read as 34% full
  //     and was sent to ⌀60 bar holding more material than the billet.
  const roundEnough = cylFill <= BAR_CORNER_FILL && cylFill >= BAR_MIN_FILL;
  const containDiaMm = roundEnough ? cs.widthMm : cs.diagonalMm;

  const barDiameterMm = nextStandardBar(containDiaMm + 2 * BAR_RADIAL_ALLOWANCE_MM);
  const fitsCapacity = barDiameterMm <= cap;
  const barLike = cs.balance >= BAR_CROSS_BALANCE_MIN;

  // Reported so the candidate reason can show the material consequence of a
  // wrong call (bar bigger than the block) in plain numbers.
  const barLengthMm = cs.lengthMm + 5; // facing + part-off allowance
  const barVolumeCm3 = ((Math.PI / 4) * barDiameterMm * barDiameterMm * barLengthMm) / 1000;
  const billetVolumeCm3 = (dims.x * dims.y * dims.z) / 1000;

  // Bar stock is for parts that are LONGER than they are wide — that is what
  // "bar" means. A disc or a flange (40 across, 22 thick) is chucked from plate
  // or a sawn billet, never bar-fed: you would buy a huge slug and part off a
  // thin slice. Volume-fill tests cannot see this, because a flange with a bore
  // and counterbores fills its cylinder about as well as a real shaft does —
  // which is how part 031167-A, a 40x40x22 disc, ended up quoted from ⌀45 bar
  // with its two setups collapsed to one.
  const elongated = cs.lengthMm >= BAR_MIN_ASPECT * cs.widthMm;

  return {
    ...cs,
    barDiameterMm,
    containDiaMm,
    fitsCapacity,
    barLike,
    roundEnough,
    elongated,
    cylFill,
    barVolumeCm3,
    billetVolumeCm3,
    cap,
    eligible: fitsCapacity && barLike && roundEnough && elongated,
  };
}

/** Pick the most efficient capable machine for a part, with reasoning. */
export function selectMachine(input: MachineSelectionInput): MachineRecommendation {
  return input.isTurned ? selectTurningMachine(input) : selectMillingMachine(input);
}

function selectTurningMachine(input: MachineSelectionInput): MachineRecommendation {
  const owns = ownsFn(input.ownedMachines);
  const od = Math.max(0, input.odMm ?? input.barDiameterMm ?? 0);
  const bar = Math.max(od, input.barDiameterMm ?? od);
  const len = Math.max(0, input.lengthMm ?? 0);
  const slenderness = od > 0 ? len / od : 0;
  const cross = !!input.crossFeatures;

  const sh = MACHINE_CATALOG['sliding-head'];
  const l2 = MACHINE_CATALOG['cnc-lathe-2axis'];
  const tm = MACHINE_CATALOG['turn-mill'];

  const fitsSliding = bar <= (sh.maxTurnDiaMm ?? 0);
  const fitsTurnMill = od <= (tm.maxTurnDiaMm ?? 0);
  const fits2Axis = od <= (l2.maxTurnDiaMm ?? 0);

  const candidates: MachineCandidate[] = [
    {
      id: sh.id, name: sh.name, capable: fitsSliding,
      reason: fitsSliding
        ? `Bar ⌀${bar.toFixed(0)} ≤ ${sh.maxTurnDiaMm} mm capacity${cross ? '; driven tools handle cross-features in-cycle' : ''}.`
        : `Bar ⌀${bar.toFixed(0)} exceeds ${sh.maxTurnDiaMm} mm sliding-head capacity.`,
    },
    {
      id: l2.id, name: l2.name, capable: fits2Axis,
      reason: !fits2Axis
        ? `⌀${od.toFixed(0)} exceeds ${l2.maxTurnDiaMm} mm swing.`
        : cross
          ? `Turns the part, but has no live tooling — cross-features need a separate milling second-op.`
          : `⌀${od.toFixed(0)} within ${l2.maxTurnDiaMm} mm swing; plain turning, no live tooling needed.`,
    },
    {
      id: tm.id, name: tm.name, capable: fitsTurnMill,
      reason: fitsTurnMill
        ? `⌀${od.toFixed(0)} ≤ ${tm.maxTurnDiaMm} mm; turning + milling in one setup.`
        : `⌀${od.toFixed(0)} exceeds ${tm.maxTurnDiaMm} mm turn-mill capacity.`,
    },
  ];

  const reasons: string[] = [];
  let recommended: MachineId;
  let secondOpNote: string | undefined;

  if (fitsSliding && owns('sliding-head')) {
    // Small bar-fed work — the sliding-head is the cheapest route and has driven
    // tools, so it also covers cross-features in-cycle.
    recommended = 'sliding-head';
    reasons.push(`Small diameter (⌀${bar.toFixed(0)} ≤ ${sh.maxTurnDiaMm} mm) → runs bar-fed on a sliding-head: continuous stock feed, unattended, lowest cost per part.`);
    if (slenderness > SLENDER_WARN) reasons.push(`Slender part (L/D ${slenderness.toFixed(1)}:1) — the sliding-head guide bush supports it right at the cut, avoiding deflection.`);
    if (cross) reasons.push(`Cross-features are cut in-cycle with the machine's driven tools — no separate operation.`);
  } else if (cross) {
    // Larger part with off-axis features → wants live tooling on a bigger machine.
    if (fitsTurnMill && owns('turn-mill')) {
      recommended = 'turn-mill';
      reasons.push(`${owns('sliding-head') ? `Too large for a sliding-head (⌀${bar.toFixed(0)} > ${sh.maxTurnDiaMm} mm) and has` : 'Has'} cross/milling features → a turn-mill does turning + milling in one setup, avoiding a second op.`);
    } else {
      recommended = 'cnc-lathe-2axis';
      reasons.push(`⌀${od.toFixed(0)} exceeds turn-mill capacity — turn on a 2-axis lathe, then a separate milling op for the cross-features.`);
      secondOpNote = 'Off-axis features require a second milling operation on this route — add its setup/time separately.';
    }
  } else {
    // Larger plain-turned part → the simplest, cheapest lathe that fits.
    recommended = fits2Axis && owns('cnc-lathe-2axis') ? 'cnc-lathe-2axis' : 'turn-mill';
    reasons.push(fits2Axis && owns('cnc-lathe-2axis')
      ? `Larger plain-turned part (⌀${od.toFixed(0)}) with no off-axis features → a 2-axis lathe is the simplest, lowest-rate machine that fits.`
      : `⌀${od.toFixed(0)} exceeds standard swing — route to the larger-capacity turn-mill.`);
  }

  const spec = MACHINE_CATALOG[recommended];
  return {
    recommended, recommendedName: spec.name, rateMultiplier: spec.rateMultiplier,
    reasons, candidates: filterOwned(candidates, input.ownedMachines, recommended),
    secondOpNote,
    route: 'turn', stockForm: 'bar', barDiameterMm: input.barDiameterMm,
    effectiveSetups: cross ? 2 : 1,
  };
}

function selectMillingMachine(input: MachineSelectionInput): MachineRecommendation {
  const owns = ownsFn(input.ownedMachines);
  const setups = Math.max(1, input.setupCount ?? 1);
  const m3 = MACHINE_CATALOG['mill-3axis'];
  const m5 = MACHINE_CATALOG['mill-5axis'];
  const tm = MACHINE_CATALOG['turn-mill'];

  const fit = barFit(input);
  const millTurnOwned = owns('turn-mill');

  const candidates: MachineCandidate[] = [];
  // Turn-mill from bar is only a candidate when we could measure the part.
  if (fit) {
    candidates.push({
      id: tm.id, name: tm.name, capable: fit.eligible,
      reason: fit.eligible
        ? `Round cross-section ⌀${fit.widthMm.toFixed(0)} → ⌀${fit.barDiameterMm} bar (≤ ${fit.cap} mm capacity); turned to profile and milled with driven tools in one clamp.`
        // Root cause first: shape disqualifies before size does, because a block
        // that "needs a bar too big" is really just a block.
        : !fit.barLike
          ? `Flat/slab cross-section (${Math.round(fit.balance * 100)}% square) — not round-bar work; belongs on a machining centre.`
          : !fit.roundEnough
            ? `Prismatic solid — fills only ${Math.round(fit.cylFill * 100)}% of the ⌀${fit.widthMm.toFixed(0)} cylinder around it, so it is a block, not bar work (⌀${fit.barDiameterMm} bar would hold ${fit.barVolumeCm3.toFixed(0)} cm³ against a ${fit.billetVolumeCm3.toFixed(0)} cm³ block).`
            : !fit.elongated
              ? `Disc / flange proportions (${fit.lengthMm.toFixed(0)} long vs ${fit.widthMm.toFixed(0)} across) — bar work runs along its length; a disc is chucked from plate or a sawn billet.`
              : `Needs ⌀${fit.barDiameterMm} bar > ${fit.cap} mm turn-mill capacity — too large for bar work.`,
    });
  }
  candidates.push(
    {
      id: m3.id, name: m3.name, capable: true,
      reason: setups <= 3
        ? `${setups} tool-access direction${setups === 1 ? '' : 's'} — reachable in ${setups} setup${setups === 1 ? '' : 's'} on a 3-axis.`
        : `Capable, but ${setups} access directions mean ${setups} separate setups (slow, more handling).`,
    },
    {
      id: m5.id, name: m5.name, capable: true,
      reason: setups >= 4
        ? `Reaches the ${setups} feature directions in one or two clamps — far fewer setups.`
        : `Overkill for ${setups} setup${setups === 1 ? '' : 's'} — the premium rate isn't repaid here.`,
    },
  );

  const reasons: string[] = [];
  let recommended: MachineId;
  let route: MachiningRoute = 'mill';
  let stockForm: StockForm = 'billet';
  let barDiameterMm: number | undefined;
  let effectiveSetups = setups;

  if (fit && fit.eligible && millTurnOwned) {
    // The client's real workflow: round bar on a mill-turn, all faces in one op.
    recommended = 'turn-mill';
    route = 'mill-turn';
    stockForm = 'bar';
    barDiameterMm = fit.barDiameterMm;
    // Main collet + (a sub-spindle pick-off for back-face work) — PLUS any
    // compound-angle axes, which a turn-mill still has to index or tilt for.
    // Collapsing those to a flat 1-or-2 is what let an angled part price as if
    // its angled holes were free.
    effectiveSetups = (setups >= 3 ? 2 : 1) + Math.max(0, input.angledSetups ?? 0);
    reasons.push(`Round-ish cross-section (⌀${fit.widthMm.toFixed(0)}, ${Math.round(fit.balance * 100)}% square) fits ⌀${fit.barDiameterMm} bar within the turn-mill's ${fit.cap} mm capacity → made from ROUND BAR, not a solid billet.`);
    reasons.push(`Turned to profile then milled with driven tools in ${effectiveSetups === 1 ? 'a single clamp' : 'one clamp plus a sub-spindle pick-off'} — all faces in one operation, replacing the ${setups} re-clamp${setups === 1 ? '' : 's'} a machining centre would need.`);
    reasons.push(`Round bar sized to the part (⌀${fit.barDiameterMm}) removes far less material than hogging the part out of a rectangular block.`);
  } else if (setups >= 4 && owns('mill-5axis')) {
    recommended = 'mill-5axis';
    reasons.push(`Features are approached from ${setups} directions — on a 3-axis that's ${setups} re-fixtures. A 5-axis reaches them in one or two clamps, so the higher rate is repaid by far fewer setups.`);
    effectiveSetups = 2;
    if (fit && !fit.eligible && fit.barLike) reasons.push(`Too large for the turn-mill's ${fit.cap} mm bar capacity (needs ⌀${fit.barDiameterMm}), so it stays on a machining centre.`);
  } else if (owns('mill-3axis')) {
    recommended = 'mill-3axis';
    reasons.push(`Features are reachable in ${setups} setup${setups === 1 ? '' : 's'} — a 3-axis machining centre is the lowest-cost route.`);
    if (fit && !fit.eligible && !fit.barLike) reasons.push(`Its flat/slab cross-section isn't round-bar work, so a turn-mill doesn't apply.`);
  } else if (owns('mill-5axis')) {
    recommended = 'mill-5axis';
    reasons.push(`Routed to the 5-axis machining centre (no 3-axis on the floor).`);
    effectiveSetups = 2;
  } else if (fit && fit.eligible && millTurnOwned) {
    recommended = 'turn-mill';
  } else {
    // Nothing suitable owned — fall back to the generic best so the quote still prices.
    recommended = setups >= 4 ? 'mill-5axis' : 'mill-3axis';
    reasons.push(`Features are reachable in ${setups} setup${setups === 1 ? '' : 's'}.`);
  }

  if ((input.pocketCount ?? 0) > 0 && route === 'mill') {
    reasons.push(`${input.pocketCount} pocket(s) roughed and finished on the machining centre.`);
  }

  const spec = MACHINE_CATALOG[recommended];
  return {
    recommended, recommendedName: spec.name, rateMultiplier: spec.rateMultiplier,
    reasons, candidates: filterOwned(candidates, input.ownedMachines, recommended),
    route, stockForm, barDiameterMm, effectiveSetups,
  };
}

/**
 * Show the bake-off among the machines the shop actually owns. When an inventory
 * is declared we hide machines that aren't on the floor (they can't win), but we
 * always keep the recommended machine visible even if the caller passed an
 * inconsistent inventory.
 */
function filterOwned(
  candidates: MachineCandidate[],
  owned: MachineId[] | undefined,
  recommended: MachineId
): MachineCandidate[] {
  if (!owned || !owned.length) return candidates;
  const set = new Set(owned);
  const kept = candidates.filter((c) => set.has(c.id) || c.id === recommended);
  return kept.length ? kept : candidates;
}
