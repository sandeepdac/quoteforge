/**
 * MACHINE SELECTION — which machine should make this part, and why?
 *
 * The catalog below is Turncircuit's ACTUAL plant list, not a generic set of
 * machine archetypes. That matters, because routing decisions are only as good
 * as the capability data behind them: an earlier generic catalog offered a
 * "5-axis machining centre" this shop does not own, and collapsed bar capacity
 * and chuck capacity into a single number — which sent a 40 mm flange to a
 * milling centre when it chucks comfortably on a Mori NL 2000.
 *
 * Two capacities, not one:
 *   • BAR capacity — the largest bar that passes through the spindle. Bar-fed
 *     work is the cheapest way to make a part: continuous feed, unattended.
 *   • CHUCK capacity — the largest workpiece that can be gripped and turned.
 *     Always larger (NTX 1000: ⌀65 bar but ⌀125 chucked; NL 2000: ⌀65 bar but
 *     ⌀430 chucked). "Cannot be bar-fed" is NOT "cannot be turned".
 *
 * Selection is two-stage, matching how a shop thinks:
 *   1. CAPABILITY (a hard gate) — can this machine physically make it? Bar or
 *      chuck diameter, turned length, milling envelope, live tooling for
 *      off-axis features.
 *   2. EFFICIENCY (the tie-break among capable machines) — the cheapest route,
 *      by charge-out rate, preferring bar-fed over chucked over milled.
 *
 * The recommendation carries a `rateMultiplier` so the choice moves the quote.
 * RATES ARE ADVISORY PLACEHOLDERS — relative multipliers against the base
 * spindle rate. A shop must set its real per-machine hourly rates before these
 * numbers mean money.
 */
import { nextStandardBar } from './materials';

/** Machine ids — Turncircuit's plant list. */
export type MachineId =
  | 'hanwha'
  | 'star-sr20'
  | 'star-sr32'
  | 'ntx-1000'
  | 'nl-2000'
  | 'hi-turner'
  | 'haas-vf2'
  | 'sabre'
  | 'h-mini-mill-300';

/** What sort of machine this is — selection reasons about KIND, never about a
 *  specific machine, so a shop can edit the catalog without touching logic. */
export type MachineKind = 'sliding-head' | 'lathe' | 'turn-mill' | 'mill';

/** Which machining route a part is costed on. */
export type MachiningRoute = 'turn' | 'mill' | 'mill-turn';
/** The raw stock the chosen route buys. */
export type StockForm = 'bar' | 'billet' | 'plate';

export interface MachineSpec {
  id: MachineId;
  name: string;
  kind: MachineKind;
  /** Driven tools — can cut off-axis features (cross-holes, flats, milling). */
  liveTooling: boolean;
  /** Simultaneous axes (a proxy for multi-face reach in one setup). */
  axes: number;
  /** Largest bar that feeds through the spindle (bar-fed work). */
  maxBarDiaMm?: number;
  /** Largest workpiece that can be chucked and turned — always ≥ bar capacity. */
  maxChuckDiaMm?: number;
  /** Longest component the machine can turn. */
  maxTurnLengthMm?: number;
  /** Milling work envelope (mm). */
  envelopeMm?: { x: number; y: number; z: number };
  /** Best achievable tolerance (mm) — gates precision work. */
  accuracyMm?: number;
  /** Relative charge-out vs the base spindle rate. ADVISORY — set real rates. */
  rateMultiplier: number;
  note: string;
}

/**
 * Turncircuit's plant. Five turning machines and four milling machines — this is
 * a turning shop, which is why per-feature turned-vs-milled routing matters so
 * much here.
 */
export const MACHINE_CATALOG: Record<MachineId, MachineSpec> = {
  hanwha: {
    id: 'hanwha', name: 'Hanwha Sliding-Head', kind: 'sliding-head',
    liveTooling: true, axes: 5, maxBarDiaMm: 10, maxChuckDiaMm: 45,
    accuracyMm: 0.01, rateMultiplier: 0.95,
    note: 'Small bar-fed precision turning to ⌀10 bar (⌀45 turned). Driven tools: profiles, drilling, tapping, thread whirling.',
  },
  'star-sr20': {
    id: 'star-sr20', name: 'Star SR-20 Sliding-Head', kind: 'sliding-head',
    liveTooling: true, axes: 5, maxBarDiaMm: 20, maxTurnLengthMm: 350,
    accuracyMm: 0.005, rateMultiplier: 1.0,
    note: 'Bar-fed to ⌀20 × 350 mm. Tightest tolerance on the floor (0.005 mm). Driven tools + thread whirling.',
  },
  'star-sr32': {
    id: 'star-sr32', name: 'Star SR-32 Sliding-Head', kind: 'sliding-head',
    liveTooling: true, axes: 5, maxBarDiaMm: 32, maxTurnLengthMm: 310,
    accuracyMm: 0.01, rateMultiplier: 1.05,
    note: 'Bar-fed to ⌀32 × 310 mm. Driven tools: profiles, drilling, tapping, thread whirling.',
  },
  'ntx-1000': {
    id: 'ntx-1000', name: 'DMG Mori NTX 1000 (5-axis Mill-Turn)', kind: 'turn-mill',
    liveTooling: true, axes: 5, maxBarDiaMm: 65, maxChuckDiaMm: 125, maxTurnLengthMm: 200,
    accuracyMm: 0.01, rateMultiplier: 1.6,
    note: 'The only 5-axis machine on the floor. Turning + milling in one clamp, Y ±105. Premium rate, repaid by eliminating setups.',
  },
  'nl-2000': {
    id: 'nl-2000', name: 'Mori NL 2000 Mill-Turn', kind: 'turn-mill',
    liveTooling: true, axes: 4, maxBarDiaMm: 65, maxChuckDiaMm: 430, maxTurnLengthMm: 450,
    accuracyMm: 0.01, rateMultiplier: 1.35,
    note: 'Large-capacity mill-turn: ⌀65 bar, but chucks to ⌀430 × 450 mm. Driven tools with Y ±70 for off-axis work.',
  },
  'hi-turner': {
    id: 'hi-turner', name: 'Hi Turner CNC Lathe', kind: 'lathe',
    liveTooling: false, axes: 2, maxBarDiaMm: 38, maxChuckDiaMm: 250, maxTurnLengthMm: 250,
    rateMultiplier: 0.9,
    note: 'Straightforward turning to ⌀250 × 250 mm. No live tooling — off-axis features need a separate milling op.',
  },
  'haas-vf2': {
    id: 'haas-vf2', name: 'Haas VF-2 (4-axis VMC)', kind: 'mill',
    liveTooling: true, axes: 4, envelopeMm: { x: 762, y: 406, z: 508 },
    rateMultiplier: 1.1,
    note: 'Vertical machining centre with a 4th axis — indexes to reach extra faces without a full re-fixture.',
  },
  sabre: {
    id: 'sabre', name: 'Sabre Machining Centre', kind: 'mill',
    liveTooling: true, axes: 3, envelopeMm: { x: 2000, y: 500, z: 500 },
    rateMultiplier: 1.15,
    note: 'Large-format milling to 2 m. Metals plus graphite, ABS, polycarbonate, nylon, POM and PEEK.',
  },
  'h-mini-mill-300': {
    id: 'h-mini-mill-300', name: 'H Mini Mill 300', kind: 'mill',
    liveTooling: true, axes: 3, maxBarDiaMm: 60, envelopeMm: { x: 370, y: 300, z: 450 },
    accuracyMm: 0.01, rateMultiplier: 1.0,
    note: 'Small machining centre with ⌀10–60 collet / bar workholding, billet to 370 mm. CONFIRM its exact classification with the shop.',
  },
};

/** All machine ids in catalog order — the default "owns everything" set. */
export const ALL_MACHINE_IDS: MachineId[] = [
  'hanwha', 'star-sr20', 'star-sr32', 'ntx-1000', 'nl-2000',
  'hi-turner', 'haas-vf2', 'sabre', 'h-mini-mill-300',
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
  /** Measured bounding box (mm) — drives bar/chuck fit and envelope gating. */
  partDimsMm?: { x: number; y: number; z: number };
  /** Finished part volume (cm³) — decides how round the cross-section really is. */
  partVolumeCm3?: number;
  /**
   * Circular features (bores, spigots, faces) sharing the part's main axis —
   * i.e. features a spindle can TURN. This is the evidence that a prismatic-
   * looking part is really chucking work.
   *
   * Volume alone cannot decide it: a square block with half its material
   * removed fills the cylinder around it about as well as a real turned part
   * does, so a 200×200×100 block reads as "round enough". Only actual coaxial
   * round features settle it, and those come from the geometry service.
   */
  onAxisTurnedFeatures?: number;
  /** Machines the shop actually owns. Omit to consider the whole catalog. */
  ownedMachines?: MachineId[];
}

export interface MachineCandidate {
  id: MachineId;
  name: string;
  capable: boolean;
  reason: string;
}

export interface MachineRecommendation {
  recommended: MachineId;
  recommendedName: string;
  rateMultiplier: number;
  reasons: string[];
  candidates: MachineCandidate[];
  /** Set when a chosen route implies a separate milling second-op. */
  secondOpNote?: string;
  route: MachiningRoute;
  stockForm: StockForm;
  /** Round bar ⌀ (mm) when the route runs from bar — else undefined. */
  barDiameterMm?: number;
  /** Setups the chosen route actually needs. */
  effectiveSetups?: number;
}

const SLENDER_WARN = 10; // L/D above which a guide bush (sliding-head) really helps
const BAR_RADIAL_ALLOWANCE_MM = 2; // clean-up stock over the finished OD before the next bar size
const BAR_CROSS_BALANCE_MIN = 0.55; // cross-section must be roughly round/square (not a flat plate)
const BAR_CORNER_FILL = 1.05;       // fills ≤ this fraction of a ⌀=width cylinder → fits that bar
const BAR_MIN_FILL = 0.5;           // ...and ≥ this, or it is a block inside a notional cylinder
const BAR_MIN_ASPECT = 1.2;         // bar work runs along its length: a disc is chucked, not bar-fed

/** The machines actually available, in catalog order. Unknown ids are ignored
 *  (older saved settings used a generic catalog), and an empty result means
 *  "no inventory declared" → consider everything. */
function availableMachines(owned?: MachineId[]): MachineSpec[] {
  const known = (owned ?? []).filter((id) => MACHINE_CATALOG[id]);
  const ids = known.length ? known : ALL_MACHINE_IDS;
  return ALL_MACHINE_IDS.filter((id) => ids.includes(id)).map((id) => MACHINE_CATALOG[id]);
}

/**
 * Reduce a bounding box to a turning cross-section: the pair of dimensions most
 * nearly equal is the diameter (round stock spans them); the remaining dimension
 * is the length along the spindle axis.
 */
function crossSection(dims: { x: number; y: number; z: number }) {
  const [a, b, c] = [dims.x, dims.y, dims.z].map((d) => Math.max(0, d)).sort((p, q) => q - p);
  const pairs = [
    { hi: a, lo: b, axis: c },
    { hi: a, lo: c, axis: b },
    { hi: b, lo: c, axis: a },
  ];
  const best = pairs.reduce((m, p) => (p.hi > 0 && p.lo / p.hi > m.lo / m.hi ? p : m), pairs[0]);
  return {
    widthMm: best.hi,
    balance: best.hi > 0 ? best.lo / best.hi : 0, // 1 = square/round cross-section
    diagonalMm: Math.sqrt(best.hi * best.hi + best.lo * best.lo),
    lengthMm: best.axis,
  };
}

/** How turnable is this solid, and what stock would it need? */
function turnFit(input: MachineSelectionInput) {
  const dims = input.partDimsMm;
  if (!dims) return null;
  const cs = crossSection(dims);
  if (cs.widthMm <= 0) return null;

  // Roundness is a TWO-SIDED test. Too FULL (>1.05) means square corners stick
  // out past the width-cylinder, so stock must span the diagonal. Too EMPTY
  // (<0.5) means the solid occupies a fraction of the cylinder containing it —
  // a block sitting inside a notional cylinder, not a body of revolution.
  // "Fits inside some cylinder" is true of everything and is no evidence at all.
  const cylOfWidthCm3 = ((Math.PI / 4) * cs.widthMm * cs.widthMm * cs.lengthMm) / 1000;
  const cylFill = cylOfWidthCm3 > 0 && (input.partVolumeCm3 ?? 0) > 0
    ? (input.partVolumeCm3 as number) / cylOfWidthCm3
    : 0.7;
  const roundEnough = cylFill <= BAR_CORNER_FILL && cylFill >= BAR_MIN_FILL;
  const containDiaMm = roundEnough ? cs.widthMm : cs.diagonalMm;
  const barDiameterMm = nextStandardBar(containDiaMm + 2 * BAR_RADIAL_ALLOWANCE_MM);
  const barLike = cs.balance >= BAR_CROSS_BALANCE_MIN;

  // Bar stock runs along its LENGTH. A disc or flange is chucked from a sawn
  // slug, never bar-fed — you would buy a huge bar to part off a thin slice.
  const elongated = cs.lengthMm >= BAR_MIN_ASPECT * cs.widthMm;

  return {
    ...cs,
    barDiameterMm,
    containDiaMm,
    barLike,
    roundEnough,
    elongated,
    cylFill,
    /** Suited to BAR feeding (round, elongated). Capacity checked per machine. */
    barSuitable: barLike && roundEnough && elongated,
    /** Suited to CHUCKED turning (round enough to grip and turn), any aspect. */
    chuckSuitable: barLike && roundEnough,
  };
}

/** Does a part of these dimensions fit a machine's milling envelope? */
function fitsEnvelope(spec: MachineSpec, dims?: { x: number; y: number; z: number }): boolean {
  if (!spec.envelopeMm || !dims) return true;
  const part = [dims.x, dims.y, dims.z].sort((a, b) => b - a);
  const env = [spec.envelopeMm.x, spec.envelopeMm.y, spec.envelopeMm.z].sort((a, b) => b - a);
  return part.every((d, i) => d <= env[i]);
}

const r0 = (v: number) => v.toFixed(0);

export function selectMachine(input: MachineSelectionInput): MachineRecommendation {
  return input.isTurned ? selectTurningMachine(input) : selectMilledPartMachine(input);
}

/** Build the recommendation object for a chosen spec. */
function recommend(
  spec: MachineSpec,
  reasons: string[],
  candidates: MachineCandidate[],
  extra: Partial<MachineRecommendation> = {}
): MachineRecommendation {
  return {
    recommended: spec.id,
    recommendedName: spec.name,
    rateMultiplier: spec.rateMultiplier,
    reasons,
    candidates,
    route: 'mill',
    stockForm: 'billet',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Turned parts (bodies of revolution)
// ---------------------------------------------------------------------------

function selectTurningMachine(input: MachineSelectionInput): MachineRecommendation {
  const machines = availableMachines(input.ownedMachines);
  const od = Math.max(0, input.odMm ?? input.barDiameterMm ?? 0);
  const bar = Math.max(od, input.barDiameterMm ?? od);
  const len = Math.max(0, input.lengthMm ?? 0);
  const slenderness = od > 0 ? len / od : 0;
  const cross = !!input.crossFeatures;

  const lathes = machines.filter((m) => m.kind !== 'mill');
  const candidates: MachineCandidate[] = lathes.map((m) => {
    const barOk = bar <= (m.maxBarDiaMm ?? 0);
    const chuckOk = od <= (m.maxChuckDiaMm ?? 0);
    const lenOk = !m.maxTurnLengthMm || len <= m.maxTurnLengthMm;
    const capable = (barOk || chuckOk) && lenOk && (!cross || m.liveTooling);
    let reason: string;
    if (!barOk && !chuckOk) {
      reason = `⌀${r0(od)} exceeds this machine (${m.maxBarDiaMm ?? '—'} mm bar / ${m.maxChuckDiaMm ?? '—'} mm chuck).`;
    } else if (!lenOk) {
      reason = `${r0(len)} mm long exceeds its ${m.maxTurnLengthMm} mm turning length.`;
    } else if (cross && !m.liveTooling) {
      reason = `Turns it, but has no live tooling — off-axis features need a separate milling op.`;
    } else {
      reason = barOk
        ? `Bar ⌀${r0(bar)} ≤ ${m.maxBarDiaMm} mm — runs bar-fed${cross ? '; driven tools cut off-axis features in-cycle' : ''}.`
        : `Too big to bar-feed, but chucks at ⌀${r0(od)} ≤ ${m.maxChuckDiaMm} mm.`;
    }
    return { id: m.id, name: m.name, capable, reason };
  });

  const capableIds = new Set(candidates.filter((c) => c.capable).map((c) => c.id));
  const capable = lathes.filter((m) => capableIds.has(m.id));

  // Bar-fed beats chucked (continuous feed, unattended). Within the bar-fed
  // group a SLIDING-HEAD wins even when a conventional lathe quotes a lower
  // rate: that is what sliding heads are for. A ⌀8 part on a ⌀38 lathe is not
  // cheaper in practice — the sliding head runs it unattended off the bar, holds
  // finer tolerance, and frees the lathe for work only it can hold. Rate alone
  // would send every small bar part to the cheapest big machine.
  const barFed = capable.filter((m) => bar <= (m.maxBarDiaMm ?? 0));
  const slidingHeads = barFed.filter((m) => m.kind === 'sliding-head');
  const pool = slidingHeads.length ? slidingHeads : barFed.length ? barFed : capable;
  const chosen = pool.slice().sort((a, b) => a.rateMultiplier - b.rateMultiplier)[0];

  const reasons: string[] = [];
  let secondOpNote: string | undefined;

  if (!chosen) {
    // Nothing on the floor can turn it — fall back to the largest lathe so the
    // quote still prices, and say plainly that it does not fit.
    const fallback = lathes.slice().sort((a, b) => (b.maxChuckDiaMm ?? 0) - (a.maxChuckDiaMm ?? 0))[0]
      ?? machines[0];
    return recommend(fallback, [
      `⌀${r0(od)} × ${r0(len)} mm does not fit any turning machine on the floor — confirm the route before quoting.`,
    ], candidates, { route: 'turn', stockForm: 'bar', barDiameterMm: input.barDiameterMm, effectiveSetups: cross ? 2 : 1 });
  }

  const isBarFed = bar <= (chosen.maxBarDiaMm ?? 0);
  reasons.push(isBarFed
    ? `Bar ⌀${r0(bar)} fits the ${chosen.maxBarDiaMm} mm capacity — bar-fed is the cheapest route: continuous feed, unattended.`
    : `Too large to bar-feed (⌀${r0(bar)} > ${chosen.maxBarDiaMm ?? 0} mm), but chucks at ⌀${r0(od)} within its ${chosen.maxChuckDiaMm} mm swing.`);
  if (chosen.kind === 'sliding-head' && slenderness > SLENDER_WARN) {
    reasons.push(`Slender part (L/D ${slenderness.toFixed(1)}:1) — the sliding-head guide bush supports it right at the cut.`);
  }
  if (cross) {
    if (chosen.liveTooling) reasons.push(`Off-axis features are cut in-cycle with driven tools — no separate operation.`);
    else secondOpNote = 'Off-axis features need a second milling operation on this route — add its setup/time separately.';
  }

  return recommend(chosen, reasons, candidates, {
    route: 'turn',
    stockForm: 'bar',
    barDiameterMm: input.barDiameterMm,
    effectiveSetups: (cross && chosen.liveTooling ? 1 : cross ? 2 : 1) + Math.max(0, input.angledSetups ?? 0),
  });
}

// ---------------------------------------------------------------------------
// Prismatic / milled parts — which may still be turning work
// ---------------------------------------------------------------------------

function selectMilledPartMachine(input: MachineSelectionInput): MachineRecommendation {
  const machines = availableMachines(input.ownedMachines);
  const setups = Math.max(1, input.setupCount ?? 1);
  const angled = Math.max(0, input.angledSetups ?? 0);
  const dims = input.partDimsMm;
  const fit = turnFit(input);

  const turnMills = machines.filter((m) => m.kind === 'turn-mill');
  const mills = machines.filter((m) => m.kind === 'mill');

  const candidates: MachineCandidate[] = [];

  // --- Can a turn-mill take it, bar-fed or chucked? ------------------------
  const barCapable: MachineSpec[] = [];
  const chuckCapable: MachineSpec[] = [];
  for (const m of turnMills) {
    const barOk = !!fit && fit.barSuitable && fit.barDiameterMm <= (m.maxBarDiaMm ?? 0);
    const lenOk = !fit || !m.maxTurnLengthMm || fit.lengthMm <= m.maxTurnLengthMm;
    // Chucked turning needs positive evidence of coaxial round features, not
    // just a volume ratio that a hollowed-out block also satisfies.
    const hasTurnedFeatures = (input.onAxisTurnedFeatures ?? 0) >= 1;
    const chuckOk = !!fit && fit.chuckSuitable && hasTurnedFeatures
      && fit.containDiaMm <= (m.maxChuckDiaMm ?? 0);
    const capable = (barOk || chuckOk) && lenOk;
    if (capable && barOk) barCapable.push(m);
    if (capable && !barOk && chuckOk) chuckCapable.push(m);

    let reason: string;
    if (!fit) {
      reason = 'No measured geometry — cannot judge turnability.';
    } else if (!fit.barLike) {
      reason = `Flat/slab cross-section (${Math.round(fit.balance * 100)}% square) — not turning work.`;
    } else if (!fit.roundEnough) {
      reason = `Prismatic solid — fills only ${Math.round(fit.cylFill * 100)}% of the ⌀${r0(fit.widthMm)} cylinder around it, so it is a block, not a body of revolution.`;
    } else if (!lenOk) {
      reason = `${r0(fit.lengthMm)} mm long exceeds its ${m.maxTurnLengthMm} mm turning length.`;
    } else if (!barOk && !hasTurnedFeatures) {
      reason = `Round enough to chuck, but no coaxial turned features were found — nothing for the spindle to cut, so this is milling work.`;
    } else if (barOk) {
      reason = `Round ⌀${r0(fit.widthMm)} × ${r0(fit.lengthMm)} mm → ⌀${fit.barDiameterMm} bar within its ${m.maxBarDiaMm} mm capacity; turned and milled in one clamp.`;
    } else if (chuckOk) {
      reason = `Too ${fit.elongated ? 'large' : 'short'} to bar-feed, but chucks at ⌀${r0(fit.containDiaMm)} ≤ ${m.maxChuckDiaMm} mm — turn the on-axis features, driven tools for the rest.`;
    } else {
      reason = `Needs ⌀${fit.barDiameterMm} stock — beyond its ${m.maxBarDiaMm} mm bar / ${m.maxChuckDiaMm} mm chuck capacity.`;
    }
    candidates.push({ id: m.id, name: m.name, capable, reason });
  }

  // --- Milling centres: envelope is a hard gate ----------------------------
  for (const m of mills) {
    const envOk = fitsEnvelope(m, dims);
    const reason = !envOk && m.envelopeMm && dims
      ? `Part ${[dims.x, dims.y, dims.z].map(r0).join('×')} mm exceeds its ${m.envelopeMm.x}×${m.envelopeMm.y}×${m.envelopeMm.z} mm envelope.`
      : m.axes >= 4
        ? `${setups} tool-access direction${setups === 1 ? '' : 's'} — its 4th axis indexes to some of them without a full re-fixture.`
        : `${setups} access direction${setups === 1 ? '' : 's'} → ${setups} setup${setups === 1 ? '' : 's'} on a 3-axis.`;
    candidates.push({ id: m.id, name: m.name, capable: envOk, reason });
  }

  const reasons: string[] = [];
  const cheapest = (list: MachineSpec[]) =>
    list.slice().sort((a, b) => a.rateMultiplier - b.rateMultiplier)[0];
  const barMachine = cheapest(barCapable);
  const chuckMachine = cheapest(chuckCapable);

  // --- Prefer a turn-mill when the part is genuinely turning work ----------
  if (barMachine && fit) {
    const eff = (setups >= 3 ? 2 : 1) + angled;
    reasons.push(`Round cross-section (⌀${r0(fit.widthMm)}, ${Math.round(fit.balance * 100)}% square) fits ⌀${fit.barDiameterMm} bar within the ${barMachine.name}'s ${barMachine.maxBarDiaMm} mm capacity → made from ROUND BAR, not a solid billet.`);
    reasons.push(`Turned to profile then milled with driven tools in ${eff === 1 ? 'a single clamp' : `${eff} clamps`} — replacing the ${setups} re-clamp${setups === 1 ? '' : 's'} a machining centre would need.`);
    return recommend(barMachine, reasons, candidates, {
      route: 'mill-turn', stockForm: 'bar', barDiameterMm: fit.barDiameterMm, effectiveSetups: eff,
    });
  }

  if (chuckMachine && fit) {
    // The flange case: too short to bar-feed, but a perfectly ordinary chucking
    // job. Its on-axis features are TURNED; only the off-axis ones are milled.
    const eff = Math.max(2, 1 + angled); // one chucking per end, plus angled work
    reasons.push(`⌀${r0(fit.containDiaMm)} × ${r0(fit.lengthMm)} mm is too ${fit.elongated ? 'large' : 'short'} to bar-feed, but chucks within the ${chuckMachine.name}'s ${chuckMachine.maxChuckDiaMm} mm swing.`);
    reasons.push(`On-axis features (bores, spigots, faces) are TURNED on the spindle — far faster than interpolating them with an end mill — and driven tools cut the off-axis work in the same clamp.`);
    return recommend(chuckMachine, reasons, candidates, {
      route: 'mill-turn', stockForm: 'billet', effectiveSetups: eff,
    });
  }

  // --- Otherwise a machining centre: cheapest capable that fits ------------
  const capableMills = mills.filter((m) => fitsEnvelope(m, dims));
  if (!capableMills.length) {
    const biggest = mills.slice().sort((a, b) => (b.envelopeMm?.x ?? 0) - (a.envelopeMm?.x ?? 0))[0] ?? machines[0];
    return recommend(biggest, [
      dims
        ? `Part ${[dims.x, dims.y, dims.z].map(r0).join('×')} mm exceeds every milling envelope on the floor — confirm the route before quoting.`
        : 'No measured geometry — confirm the route before quoting.',
    ], candidates, { route: 'mill', stockForm: 'billet', effectiveSetups: setups });
  }

  // More axes earn their rate only when there are setups to collapse.
  const wantsIndexing = setups >= 4;
  const chosen = capableMills.slice().sort((a, b) => {
    if (wantsIndexing && b.axes !== a.axes) return b.axes - a.axes;
    return a.rateMultiplier - b.rateMultiplier;
  })[0];

  if (wantsIndexing && chosen.axes >= 4) {
    reasons.push(`Features are approached from ${setups} directions. The ${chosen.name}'s 4th axis indexes to several of them without a full re-fixture, so the higher rate is repaid.`);
  } else {
    reasons.push(`Features are reachable in ${setups} setup${setups === 1 ? '' : 's'} — the ${chosen.name} is the lowest-cost route that fits.`);
  }
  if (fit && !fit.roundEnough) reasons.push(`Prismatic solid — not turning work, so it belongs on a machining centre.`);
  if ((input.pocketCount ?? 0) > 0) reasons.push(`${input.pocketCount} pocket(s) roughed and finished on the machining centre.`);

  // NOTE: no 4th-axis setup discount is applied. A rotary axis genuinely does
  // let one clamp reach the faces around it, so the real setup count is likely
  // lower than the measured access-direction count — but by how much depends on
  // this shop's fixturing, and inventing a divisor here would quietly re-create
  // the under-costing this model has repeatedly been caught doing. The measured
  // count stands until the shop calibrates it; the reasoning says the 4th axis
  // may reduce it so the estimator knows to look.
  if (chosen.axes >= 4 && setups > 2) {
    reasons.push(`Its 4th axis may let one clamp reach several of these ${setups} directions — CONFIRM the real setup count with the shop before quoting at low quantity.`);
  }
  return recommend(chosen, reasons, candidates, {
    route: 'mill', stockForm: 'billet', effectiveSetups: setups,
  });
}
