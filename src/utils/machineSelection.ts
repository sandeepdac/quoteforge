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
 *
 * The recommendation carries a `rateMultiplier` so the choice actually moves the
 * quote — a turn-mill minute costs more than a sliding-head minute. Advisory
 * defaults; a shop tunes the catalog to its own machines and rates.
 */

export type MachineId =
  | 'sliding-head'
  | 'cnc-lathe-2axis'
  | 'turn-mill'
  | 'mill-3axis'
  | 'mill-5axis';

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
    note: 'Turning + milling in one setup (Y-axis, sub-spindle). Premium rate; earns it by eliminating a second op.',
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

export interface MachineSelectionInput {
  isTurned: boolean;
  // Turned drivers
  odMm?: number;
  barDiameterMm?: number;
  lengthMm?: number;
  crossFeatures?: boolean;
  // Milled drivers
  setupCount?: number;
  pocketCount?: number;
  bossCount?: number;
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
}

const SLENDER_WARN = 10; // L/D above which a guide bush (sliding-head) really helps

/** Pick the most efficient capable machine for a part, with reasoning. */
export function selectMachine(input: MachineSelectionInput): MachineRecommendation {
  return input.isTurned ? selectTurningMachine(input) : selectMillingMachine(input);
}

function selectTurningMachine(input: MachineSelectionInput): MachineRecommendation {
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

  if (fitsSliding) {
    // Small bar-fed work — the sliding-head is the cheapest route and has driven
    // tools, so it also covers cross-features in-cycle.
    recommended = 'sliding-head';
    reasons.push(`Small diameter (⌀${bar.toFixed(0)} ≤ ${sh.maxTurnDiaMm} mm) → runs bar-fed on a sliding-head: continuous stock feed, unattended, lowest cost per part.`);
    if (slenderness > SLENDER_WARN) reasons.push(`Slender part (L/D ${slenderness.toFixed(1)}:1) — the sliding-head guide bush supports it right at the cut, avoiding deflection.`);
    if (cross) reasons.push(`Cross-features are cut in-cycle with the machine's driven tools — no separate operation.`);
  } else if (cross) {
    // Larger part with off-axis features → wants live tooling on a bigger machine.
    if (fitsTurnMill) {
      recommended = 'turn-mill';
      reasons.push(`Too large for a sliding-head (⌀${bar.toFixed(0)} > ${sh.maxTurnDiaMm} mm) and has cross/milling features → a turn-mill does turning + milling in one setup, avoiding a second op.`);
    } else {
      recommended = 'cnc-lathe-2axis';
      reasons.push(`⌀${od.toFixed(0)} exceeds turn-mill capacity — turn on a 2-axis lathe, then a separate milling op for the cross-features.`);
      secondOpNote = 'Off-axis features require a second milling operation on this route — add its setup/time separately.';
    }
  } else {
    // Larger plain-turned part → the simplest, cheapest lathe that fits.
    recommended = fits2Axis ? 'cnc-lathe-2axis' : 'turn-mill';
    reasons.push(fits2Axis
      ? `Larger plain-turned part (⌀${od.toFixed(0)}) with no off-axis features → a 2-axis lathe is the simplest, lowest-rate machine that fits.`
      : `⌀${od.toFixed(0)} exceeds standard swing — route to the larger-capacity turn-mill.`);
  }

  const spec = MACHINE_CATALOG[recommended];
  return {
    recommended, recommendedName: spec.name, rateMultiplier: spec.rateMultiplier,
    reasons, candidates, secondOpNote,
  };
}

function selectMillingMachine(input: MachineSelectionInput): MachineRecommendation {
  const setups = Math.max(1, input.setupCount ?? 1);
  const m3 = MACHINE_CATALOG['mill-3axis'];
  const m5 = MACHINE_CATALOG['mill-5axis'];

  const candidates: MachineCandidate[] = [
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
  ];

  const reasons: string[] = [];
  let recommended: MachineId;
  if (setups >= 4) {
    recommended = 'mill-5axis';
    reasons.push(`Features are approached from ${setups} directions — on a 3-axis that's ${setups} re-fixtures. A 5-axis reaches them in one or two clamps, so the higher rate is repaid by far fewer setups.`);
  } else {
    recommended = 'mill-3axis';
    reasons.push(`Features are reachable in ${setups} setup${setups === 1 ? '' : 's'} — a 3-axis machining centre is the lowest-cost route.`);
  }
  if ((input.pocketCount ?? 0) > 0) reasons.push(`${input.pocketCount} pocket(s) roughed and finished on the machining centre.`);

  const spec = MACHINE_CATALOG[recommended];
  return {
    recommended, recommendedName: spec.name, rateMultiplier: spec.rateMultiplier,
    reasons, candidates,
  };
}
