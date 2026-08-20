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
 *   2. COST (the tie-break among capable machines) — a real bake-off, because
 *      the machine changes two things in OPPOSITE directions:
 *        • setups — a 5-axis mill-turn reaches in one holding what a 3-axis
 *          machining centre needs six clamps for;
 *        • hourly rate — that mill-turn costs two to three times as much an
 *          hour.
 *      Ranking by rate alone (what this module used to do) structurally cannot
 *      see that trade: it always picks the cheap machine and then pays for the
 *      setups. Ranking by TOTAL cost at the quoted quantity can, and flips with
 *      quantity the way real routing decisions do — setups dominate at qty 1,
 *      the spindle rate dominates at qty 500.
 *
 * Rates are per-machine hourly charge-outs, not nudges around a base rate. The
 * spread between the cheapest mill and the 5-axis mill-turn is a factor of ~3;
 * an earlier model expressed it as 100% vs 110%, which made the most capable
 * machine on the floor look like a rounding error. THE FIGURES BELOW ARE
 * DEFAULTS FOR A UK PRECISION SHOP — a shop must confirm its own before these
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
  /**
   * Charge-out rate per HOUR, in the shop's currency. This is a real cost
   * centre: a 5-axis mill-turn is not "10% more" than a VMC, it is a different
   * class of asset with a rate to match. DEFAULTS — confirm with the shop.
   */
  hourlyRate: number;
  /**
   * Relative charge-out vs the reference spindle rate — DERIVED from hourlyRate,
   * never hand-set. Kept because the cost models multiply the shop's base rate
   * by it; changing hourlyRate is what moves the quote.
   */
  rateMultiplier: number;
  note: string;
}

/**
 * The rate the shop's base `machineRatePerMin` setting is understood to mean
 * (≈£75/hr → 1.25/min). Per-machine rates are expressed against it, so a shop
 * that edits its base rate scales the whole floor proportionally.
 */
export const REFERENCE_HOURLY_RATE = 75;

/** Fill in the derived multiplier so a catalog entry only states real money. */
function spec(s: Omit<MachineSpec, 'rateMultiplier'>): MachineSpec {
  return { ...s, rateMultiplier: Math.round((s.hourlyRate / REFERENCE_HOURLY_RATE) * 1000) / 1000 };
}

/**
 * Turncircuit's plant. Five turning machines and four milling machines — this is
 * a turning shop, which is why per-feature turned-vs-milled routing matters so
 * much here.
 */
export const MACHINE_CATALOG: Record<MachineId, MachineSpec> = {
  hanwha: spec({
    id: 'hanwha', name: 'Hanwha Sliding-Head', kind: 'sliding-head',
    liveTooling: true, axes: 5, maxBarDiaMm: 10, maxChuckDiaMm: 45,
    accuracyMm: 0.01, hourlyRate: 48,
    note: 'Small bar-fed precision turning to ⌀10 bar (⌀45 turned). Driven tools: profiles, drilling, tapping, thread whirling.',
  }),
  'star-sr20': spec({
    id: 'star-sr20', name: 'Star SR-20 Sliding-Head', kind: 'sliding-head',
    liveTooling: true, axes: 5, maxBarDiaMm: 20, maxTurnLengthMm: 350,
    accuracyMm: 0.005, hourlyRate: 52,
    note: 'Bar-fed to ⌀20 × 350 mm. Tightest tolerance on the floor (0.005 mm). Driven tools + thread whirling.',
  }),
  'star-sr32': spec({
    id: 'star-sr32', name: 'Star SR-32 Sliding-Head', kind: 'sliding-head',
    liveTooling: true, axes: 5, maxBarDiaMm: 32, maxTurnLengthMm: 310,
    accuracyMm: 0.01, hourlyRate: 58,
    note: 'Bar-fed to ⌀32 × 310 mm. Driven tools: profiles, drilling, tapping, thread whirling.',
  }),
  'ntx-1000': spec({
    id: 'ntx-1000', name: 'DMG Mori NTX 1000 (5-axis Mill-Turn)', kind: 'turn-mill',
    liveTooling: true, axes: 5, maxBarDiaMm: 65, maxChuckDiaMm: 125, maxTurnLengthMm: 200,
    accuracyMm: 0.01, hourlyRate: 135,
    note: 'The only 5-axis machine on the floor: B-axis milling spindle, turning and milling in one clamp. Also mills PRISMATIC work done-complete in soft jaws — the reason a compound-angle part belongs here and not on a VMC. Premium rate, repaid by eliminating setups.',
  }),
  'nl-2000': spec({
    id: 'nl-2000', name: 'Mori NL 2000 Mill-Turn', kind: 'turn-mill',
    liveTooling: true, axes: 4, maxBarDiaMm: 65, maxChuckDiaMm: 430, maxTurnLengthMm: 450,
    accuracyMm: 0.01, hourlyRate: 88,
    note: 'Large-capacity mill-turn: ⌀65 bar, but chucks to ⌀430 × 450 mm. Driven tools with Y ±70 for off-axis work. One rotary axis, so a compound angle still needs fixturing.',
  }),
  'hi-turner': spec({
    id: 'hi-turner', name: 'Hi Turner CNC Lathe', kind: 'lathe',
    liveTooling: false, axes: 2, maxBarDiaMm: 38, maxChuckDiaMm: 250, maxTurnLengthMm: 250,
    hourlyRate: 42,
    note: 'Straightforward turning to ⌀250 × 250 mm. No live tooling — off-axis features need a separate milling op.',
  }),
  'haas-vf2': spec({
    id: 'haas-vf2', name: 'Haas VF-2 (4-axis VMC)', kind: 'mill',
    liveTooling: true, axes: 4, envelopeMm: { x: 762, y: 406, z: 508 },
    hourlyRate: 55,
    note: 'Vertical machining centre with a 4th axis — indexes around ONE axis to reach the faces about it without a re-fixture. A compound angle needs two rotations, so it still costs a tilted fixture here.',
  }),
  sabre: spec({
    id: 'sabre', name: 'Sabre Machining Centre', kind: 'mill',
    liveTooling: true, axes: 3, envelopeMm: { x: 2000, y: 500, z: 500 },
    hourlyRate: 58,
    note: 'Large-format milling to 2 m. Metals plus graphite, ABS, polycarbonate, nylon, POM and PEEK. Three axes: one clamp, one direction.',
  }),
  'h-mini-mill-300': spec({
    id: 'h-mini-mill-300', name: 'H Mini Mill 300', kind: 'mill',
    liveTooling: true, axes: 3, maxBarDiaMm: 60, envelopeMm: { x: 370, y: 300, z: 450 },
    accuracyMm: 0.01, hourlyRate: 40,
    note: 'Small machining centre with ⌀10–60 collet / bar workholding, billet to 370 mm. CONFIRM its exact classification with the shop.',
  }),
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
  /**
   * Tool-access directions square to a stock face. Together with `angledSetups`
   * this describes the part's ACCESS DEMAND — how many directions the cutter
   * must come from — which each machine then satisfies with a different number
   * of physical clamps depending on its kinematics.
   */
  axisAlignedSetups?: number;
  /** Batch size — decides whether setups or spindle rate dominates the choice. */
  quantity?: number;
  /**
   * First-order cutting minutes for the part. Used to weigh spindle rate against
   * setup labour. Approximate is fine: it is the same figure for every candidate,
   * so it scales the rate side of the trade without biasing which machine wins.
   */
  estimatedCutMinutes?: number;
  /** Shop economics, so the bake-off is in money rather than in proxies. */
  economics?: MachineEconomics;
  /** Machines the shop actually owns. Omit to consider the whole catalog. */
  ownedMachines?: MachineId[];
}

/** What a setup costs this shop — the other half of the machine trade-off. */
export interface MachineEconomics {
  /** Labour rate per minute for setting/fixturing. */
  setupRatePerMin: number;
  /** Minutes to set the first operation (clamp, tram, probe, touch-off). */
  setupFirstOpMin: number;
  /** Minutes for each subsequent re-clamp. */
  setupPerExtraOpMin: number;
  /** One-time CAM programming minutes per setup (NRE, amortised over the batch). */
  programmingMinPerSetup: number;
  /** Flat charge per setup, if the shop bills that way. */
  flatChargePerSetup?: number;
}

const DEFAULT_ECONOMICS: MachineEconomics = {
  setupRatePerMin: 0.8,
  setupFirstOpMin: 60,
  setupPerExtraOpMin: 45,
  programmingMinPerSetup: 25,
  flatChargePerSetup: 0,
};

export interface MachineCandidate {
  id: MachineId;
  name: string;
  capable: boolean;
  reason: string;
  /** Costed comparison, when the candidate was capable enough to price. */
  cost?: MachineCostEstimate;
}

/** One machine's costed offer for this part — the currency of the bake-off. */
export interface MachineCostEstimate {
  id: MachineId;
  name: string;
  hourlyRate: number;
  setups: number;
  setupReason: string;
  /** Recurring per batch: clamping/fixturing labour. */
  setupCost: number;
  /** One-time per batch: CAM programming (NRE). */
  programmingCost: number;
  /** Per part: spindle time at THIS machine's rate. */
  cycleCost: number;
  /** Per part, all in, at the quoted quantity. */
  totalPerPart: number;
  quantity: number;
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
  /**
   * Every capable machine, costed and ranked — the trade made visible. Setups
   * and hourly rate pull in opposite directions, so the runner-up is often
   * cheaper at a different quantity; showing the whole table is what lets an
   * estimator argue with the answer.
   */
  bakeOff?: MachineCostEstimate[];
  /** How the winner compares with the cheapest-rate machine that could do it. */
  bakeOffNote?: string;
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

/**
 * SETUPS ARE A PROPERTY OF (PART, MACHINE) — NOT OF THE PART ALONE.
 *
 * The same geometry costs a different number of clamps on every machine, and
 * that number is the single biggest lever on a low-quantity price. Counting
 * tool-access directions describes what the PART demands; how many physical
 * re-fixtures that becomes depends entirely on how the machine can move.
 *
 *   3 axes — the cutter only ever points one way. Every access direction is a
 *            re-clamp, and a compound angle needs a tilted fixture on top.
 *   4 axes — one rotary. It sweeps the faces AROUND that axis into a single
 *            clamp, but the two ends still need holding separately, and a
 *            compound angle (tilted in two planes at once) is out of reach of a
 *            single rotation, so it still costs its own fixture.
 *   5 axes — the head can point anywhere in the hemisphere above the work. Every
 *            direction the part presents is reachable in one holding; only the
 *            face being GRIPPED needs a second. Compound angles are free — this
 *            is precisely what the extra two axes were bought for.
 *
 * This is why a compound-angle part belongs on the 5-axis machine even at three
 * times the hourly rate: it converts six clamps into two.
 */
export interface MachineSetupPlan {
  setups: number;
  reason: string;
}

export function setupsOnMachine(
  machine: MachineSpec,
  axisAlignedFaces: number,
  angledAxes: number
): MachineSetupPlan {
  const faces = Math.max(1, Math.round(axisAlignedFaces));
  const angled = Math.max(0, Math.round(angledAxes));
  const s = (n: number) => (n === 1 ? '' : 's');

  if (machine.axes >= 5) {
    // One holding reaches everything except what the jaws are covering.
    const setups = Math.min(faces, 2);
    return {
      setups,
      reason: angled > 0
        ? `5-axis: the head tilts to all ${faces} direction${s(faces)} plus ${angled} compound angle${s(angled)} in ${setups === 1 ? 'a single holding' : 'one holding, plus one to reach the gripped face'} — the compound angles cost nothing here.`
        : `5-axis: all ${faces} direction${s(faces)} reached in ${setups === 1 ? 'a single holding' : 'one holding, plus one to reach the gripped face'}.`,
    };
  }

  if (machine.axes === 4) {
    // The rotary sweeps up to four faces around it; the ends are separate, and a
    // compound angle needs a second rotation this machine does not have.
    const aroundRotary = Math.min(faces, 4);
    const ends = Math.max(0, faces - 4);
    // Floor of 2 whenever the part presents more than one direction: the rotary
    // sweeps the faces around it, but the jaws still cover one, and that face
    // needs a second holding whatever the kinematics.
    const setups = Math.max(1 + ends, Math.min(faces, 2)) + angled;
    const parts = [`its rotary indexes ${aroundRotary} face${s(aroundRotary)} in one clamp`];
    if (ends > 0) parts.push(`${ends} end face${s(ends)} held separately`);
    if (angled > 0) parts.push(`${angled} compound angle${s(angled)} needing a tilted fixture (one rotation cannot reach a two-plane angle)`);
    return { setups, reason: `4-axis: ${parts.join(', ')} → ${setups} setup${s(setups)}.` };
  }

  const setups = faces + angled;
  return {
    setups,
    reason: angled > 0
      ? `3-axis: one clamp per direction — ${faces} face${s(faces)} plus ${angled} tilted fixture${s(angled)} for the compound angle${s(angled)} → ${setups} setup${s(setups)}.`
      : `3-axis: one clamp per direction → ${setups} setup${s(setups)}.`,
  };
}

/**
 * Price one machine's offer for this part.
 *
 * The cutting-minutes figure is the same for every candidate. That is on
 * purpose: it is a first-order proxy, and holding it constant means the bake-off
 * compares the two things that genuinely differ between machines — how many
 * clamps the part needs, and what an hour on the spindle costs. (A mill-turn
 * also cuts on-axis features faster, which the cost model applies later; that
 * only strengthens the case for the machine this already picks.)
 */
function costOnMachine(
  machine: MachineSpec,
  opts: { faces: number; angled: number; cutMin: number; qty: number; econ: MachineEconomics; setupsOverride?: number; setupReason?: string }
): MachineCostEstimate {
  const plan = opts.setupsOverride != null
    ? { setups: Math.max(1, Math.round(opts.setupsOverride)), reason: opts.setupReason ?? '' }
    : setupsOnMachine(machine, opts.faces, opts.angled);
  const { econ } = opts;
  const setupMin = econ.setupFirstOpMin + Math.max(0, plan.setups - 1) * econ.setupPerExtraOpMin;
  const setupCost = setupMin * econ.setupRatePerMin + plan.setups * (econ.flatChargePerSetup ?? 0);
  const programmingCost = plan.setups * econ.programmingMinPerSetup * econ.setupRatePerMin;
  const cycleCost = (opts.cutMin * machine.hourlyRate) / 60;
  const qty = Math.max(1, Math.round(opts.qty));
  return {
    id: machine.id,
    name: machine.name,
    hourlyRate: machine.hourlyRate,
    setups: plan.setups,
    setupReason: plan.reason,
    setupCost: Math.round(setupCost * 100) / 100,
    programmingCost: Math.round(programmingCost * 100) / 100,
    cycleCost: Math.round(cycleCost * 100) / 100,
    totalPerPart: Math.round((cycleCost + (setupCost + programmingCost) / qty) * 100) / 100,
    quantity: qty,
  };
}

/**
 * A first-order cutting-time proxy for when the caller has not run the cost
 * model yet. Roughly: material removed at a mid-range milling MRR, plus a floor
 * so a near-net part still carries some spindle time.
 */
function fallbackCutMinutes(input: MachineSelectionInput): number {
  const dims = input.partDimsMm;
  if (!dims) return 10;
  const boxCm3 = (dims.x * dims.y * dims.z) / 1000;
  const removedCm3 = Math.max(0, boxCm3 - (input.partVolumeCm3 ?? boxCm3 * 0.6));
  return Math.max(2, removedCm3 / 40); // ~40 cm³/min mid-range milling MRR
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

/** One machine's costed proposal for making this part, and how. */
interface Offer {
  machine: MachineSpec;
  route: MachiningRoute;
  stockForm: StockForm;
  barDiameterMm?: number;
  setups: number;
  setupReason: string;
  /** Why this machine, in the estimator's language. */
  reasons: string[];
  cost: MachineCostEstimate;
}

/**
 * Setups for a TURN-MILL running the part as turning work.
 *
 * Bar-fed, the sub-spindle takes the part from the main spindle and finishes the
 * back end in-cycle, so the base is a single holding. Chucked, you get one per
 * end. Compound angles are free on the 5-axis machine and cost a fixture on the
 * 4-axis one, exactly as for milling.
 */
function turnMillSetups(m: MachineSpec, barFed: boolean, angled: number): MachineSetupPlan {
  const base = barFed ? 1 : 2;
  if (m.axes >= 5) {
    return {
      setups: base,
      reason: barFed
        ? `Bar-fed with sub-spindle pick-off: turned, milled and parted in one holding${angled > 0 ? `, and the B-axis reaches the ${angled} compound angle${angled === 1 ? '' : 's'} in the same cycle` : ''}.`
        : `Chucked one end then the other — 2 holdings${angled > 0 ? `, with the ${angled} compound angle${angled === 1 ? '' : 's'} reached by the B-axis in-cycle` : ''}.`,
    };
  }
  const setups = base + angled;
  return {
    setups,
    reason: angled > 0
      ? `${barFed ? 'Bar-fed with sub-spindle pick-off' : 'Chucked each end'} (${base}), plus ${angled} tilted fixture${angled === 1 ? '' : 's'} — one rotary cannot reach a two-plane angle.`
      : `${barFed ? 'Bar-fed with sub-spindle pick-off: one holding' : 'Chucked each end — 2 holdings'}.`,
  };
}

function selectMilledPartMachine(input: MachineSelectionInput): MachineRecommendation {
  const machines = availableMachines(input.ownedMachines);
  const requested = Math.max(1, input.setupCount ?? 1);
  const angled = Math.max(0, input.angledSetups ?? 0);
  // The part's ACCESS DEMAND, split into the two things machines answer
  // differently: square-to-a-face directions, and compound angles.
  const faces = Math.max(1, Math.round(input.axisAlignedSetups ?? Math.max(1, requested - angled)));
  const dims = input.partDimsMm;
  const fit = turnFit(input);
  const econ = input.economics ?? DEFAULT_ECONOMICS;
  const qty = Math.max(1, Math.round(input.quantity ?? 1));
  const cutMin = input.estimatedCutMinutes ?? fallbackCutMinutes(input);
  const price = (m: MachineSpec, plan: MachineSetupPlan) =>
    costOnMachine(m, { faces, angled, cutMin, qty, econ, setupsOverride: plan.setups, setupReason: plan.reason });

  const turnMills = machines.filter((m) => m.kind === 'turn-mill');
  const mills = machines.filter((m) => m.kind === 'mill');

  const candidates: MachineCandidate[] = [];
  const offers: Offer[] = [];

  // --- Turn-mills: three different ways they can take the work -------------
  // Bar-fed turning, chucked turning, or — the case this model used to miss
  // entirely — holding a PRISMATIC block in soft jaws and milling it with the
  // B-axis head. A 5-axis mill-turn is a 5-axis milling machine that happens to
  // have a spindle; excluding it from milled parts because they are "not round"
  // threw away the most capable machine on the floor.
  for (const m of turnMills) {
    const barOk = !!fit && fit.barSuitable && fit.barDiameterMm <= (m.maxBarDiaMm ?? 0);
    const lenOk = !fit || !m.maxTurnLengthMm || fit.lengthMm <= m.maxTurnLengthMm;
    const hasTurnedFeatures = (input.onAxisTurnedFeatures ?? 0) >= 1;
    const chuckOk = !!fit && fit.chuckSuitable && hasTurnedFeatures
      && fit.containDiaMm <= (m.maxChuckDiaMm ?? 0);
    // Soft-jaw milling: the workholding limit is the chuck, not roundness.
    const gripOk = !!fit && fit.containDiaMm <= (m.maxChuckDiaMm ?? 0) && lenOk;
    // It only earns its rate as a milling machine if it can actually collapse
    // setups — i.e. it has the axes a machining centre lacks.
    const millOk = gripOk && m.axes >= 5;

    let reason: string;
    if (barOk && lenOk) {
      const plan = turnMillSetups(m, true, angled);
      offers.push({
        machine: m, route: 'mill-turn', stockForm: 'bar', barDiameterMm: fit!.barDiameterMm,
        setups: plan.setups, setupReason: plan.reason, cost: price(m, plan),
        reasons: [
          `Round cross-section (⌀${r0(fit!.widthMm)}, ${Math.round(fit!.balance * 100)}% square) fits ⌀${fit!.barDiameterMm} bar within the ${m.name}'s ${m.maxBarDiaMm} mm capacity → made from ROUND BAR, not a solid billet.`,
          `Turned to profile then milled with driven tools — ${plan.reason}`,
        ],
      });
      reason = `Round ⌀${r0(fit!.widthMm)} × ${r0(fit!.lengthMm)} mm → ⌀${fit!.barDiameterMm} bar within its ${m.maxBarDiaMm} mm capacity; turned and milled in one clamp.`;
    } else if (chuckOk && lenOk) {
      const plan = turnMillSetups(m, false, angled);
      offers.push({
        machine: m, route: 'mill-turn', stockForm: 'billet',
        setups: plan.setups, setupReason: plan.reason, cost: price(m, plan),
        reasons: [
          `⌀${r0(fit!.containDiaMm)} × ${r0(fit!.lengthMm)} mm is too ${fit!.elongated ? 'large' : 'short'} to bar-feed, but chucks within the ${m.name}'s ${m.maxChuckDiaMm} mm swing.`,
          `On-axis features (bores, spigots, faces) are TURNED on the spindle — far faster than interpolating them with an end mill — and driven tools cut the off-axis work in the same clamp.`,
        ],
      });
      reason = `Too ${fit!.elongated ? 'large' : 'short'} to bar-feed, but chucks at ⌀${r0(fit!.containDiaMm)} ≤ ${m.maxChuckDiaMm} mm — turn the on-axis features, driven tools for the rest.`;
    } else if (millOk) {
      const plan = setupsOnMachine(m, faces, angled);
      offers.push({
        machine: m, route: 'mill', stockForm: 'billet',
        setups: plan.setups, setupReason: plan.reason, cost: price(m, plan),
        reasons: [
          `Prismatic part, but held in soft jaws on the ${m.name} it is milled DONE-COMPLETE: ${plan.reason}`,
          `Its B-axis head reaches directions a machining centre can only get to by re-fixturing — which is what makes the higher rate worth paying at low quantity.`,
        ],
      });
      reason = `Not turning work, but grips at ⌀${r0(fit!.containDiaMm)} ≤ ${m.maxChuckDiaMm} mm in soft jaws and mills done-complete on 5 axes — ${plan.setups} setup${plan.setups === 1 ? '' : 's'} vs ${faces + angled} on a 3-axis.`;
    } else if (!fit) {
      reason = 'No measured geometry — cannot judge turnability.';
    } else if (!lenOk) {
      reason = `${r0(fit.lengthMm)} mm long exceeds its ${m.maxTurnLengthMm} mm turning length.`;
    } else if (!gripOk) {
      reason = `⌀${r0(fit.containDiaMm)} exceeds its ${m.maxChuckDiaMm} mm chuck — cannot be held here at all.`;
    } else if (!fit.barLike) {
      reason = `Flat/slab cross-section (${Math.round(fit.balance * 100)}% square) — not turning work, and with ${m.axes} axes it has no setup advantage over a machining centre.`;
    } else if (!fit.roundEnough) {
      reason = `Prismatic solid — fills only ${Math.round(fit.cylFill * 100)}% of the ⌀${r0(fit.widthMm)} cylinder around it, so it is a block, not a body of revolution; with ${m.axes} axes it has no setup advantage as a mill.`;
    } else {
      reason = `Round enough to chuck, but no coaxial turned features were found — nothing for the spindle to cut, so this is milling work.`;
    }
    candidates.push({
      id: m.id, name: m.name, capable: offers.some((o) => o.machine.id === m.id), reason,
      cost: offers.find((o) => o.machine.id === m.id)?.cost,
    });
  }

  // --- Milling centres: envelope is a hard gate ----------------------------
  for (const m of mills) {
    const envOk = fitsEnvelope(m, dims);
    if (envOk) {
      const plan = setupsOnMachine(m, faces, angled);
      offers.push({
        machine: m, route: 'mill', stockForm: 'billet',
        setups: plan.setups, setupReason: plan.reason, cost: price(m, plan),
        reasons: [`Milled from billet on the ${m.name} — ${plan.reason}`],
      });
    }
    const reason = !envOk && m.envelopeMm && dims
      ? `Part ${[dims.x, dims.y, dims.z].map(r0).join('×')} mm exceeds its ${m.envelopeMm.x}×${m.envelopeMm.y}×${m.envelopeMm.z} mm envelope.`
      : setupsOnMachine(m, faces, angled).reason;
    candidates.push({
      id: m.id, name: m.name, capable: envOk, reason,
      cost: offers.find((o) => o.machine.id === m.id)?.cost,
    });
  }

  if (!offers.length) {
    const biggest = mills.slice().sort((a, b) => (b.envelopeMm?.x ?? 0) - (a.envelopeMm?.x ?? 0))[0] ?? machines[0];
    return recommend(biggest, [
      dims
        ? `Part ${[dims.x, dims.y, dims.z].map(r0).join('×')} mm exceeds every milling envelope on the floor — confirm the route before quoting.`
        : 'No measured geometry — confirm the route before quoting.',
    ], candidates, { route: 'mill', stockForm: 'billet', effectiveSetups: requested });
  }

  // --- The bake-off --------------------------------------------------------
  // Rank on what the part actually costs to make: setups × setup labour, spread
  // over the batch, plus spindle time at THIS machine's rate. That is the only
  // comparison that can see a premium machine paying for itself by deleting four
  // clamps — and it correctly flips back to the cheap machine at high quantity,
  // where the setups amortise away and the hourly rate is all that is left.
  const ranked = offers.slice().sort((a, b) => a.cost.totalPerPart - b.cost.totalPerPart);
  let winner = ranked[0];
  const reasons: string[] = [];

  // Two things the bake-off structurally cannot see, both favouring turning.
  //
  // The cut-time proxy is deliberately machine-blind, but a spindle removes
  // on-axis material several times faster than an end mill interpolating the
  // same feature — so a turning route's cycle cost is overstated here. And bar
  // work buys round bar instead of a sawn billet (far better yield) and runs
  // unattended off the feeder, neither of which appears in a per-part cost.
  //
  // Rather than bury a correction inside the numbers, prefer a turning route
  // openly when one exists and is close, and SAY that the bake-off had another
  // machine marginally cheaper. The full table ships with the recommendation, so
  // an estimator who disagrees can see exactly what was traded away.
  const TURN_ROUTE_TOLERANCE = 1.5;
  const turnOffer = ranked.find((o) => o.route === 'mill-turn');
  if (turnOffer && turnOffer !== winner && turnOffer.cost.totalPerPart <= winner.cost.totalPerPart * TURN_ROUTE_TOLERANCE) {
    reasons.push(
      `Costed against the ${winner.machine.name} at ${winner.cost.totalPerPart.toFixed(2)}/part, but routed to the ${turnOffer.machine.name} at ${turnOffer.cost.totalPerPart.toFixed(2)}: this part has coaxial features a spindle TURNS, which the comparison above prices as milling. Turning them is several times faster, and the round part chucks far more easily than it clamps.`
    );
    winner = turnOffer;
  }

  reasons.unshift(...winner.reasons);
  const cheapestRate = offers.slice().sort((a, b) => a.machine.hourlyRate - b.machine.hourlyRate)[0];
  let bakeOffNote: string | undefined;
  if (cheapestRate.machine.id !== winner.machine.id) {
    const saved = Math.round((cheapestRate.cost.totalPerPart - winner.cost.totalPerPart) * 100) / 100;
    if (saved > 0) {
      bakeOffNote =
        `The ${cheapestRate.machine.name} is cheaper per hour (${cheapestRate.machine.hourlyRate} vs ${winner.machine.hourlyRate}) but needs ${cheapestRate.cost.setups} setup${cheapestRate.cost.setups === 1 ? '' : 's'} against ${winner.cost.setups} — at qty ${qty} that costs ${saved.toFixed(2)}/part more, so the faster-to-set machine wins.`;
      reasons.push(bakeOffNote);
    } else {
      bakeOffNote =
        `Chosen on total cost at qty ${qty}. Note the ${cheapestRate.machine.name} is close behind and cheaper per hour — at a larger batch, where setups amortise away, it likely takes over.`;
      reasons.push(bakeOffNote);
    }
  }
  if ((input.pocketCount ?? 0) > 0 && winner.route === 'mill') {
    reasons.push(`${input.pocketCount} pocket(s) roughed and finished in these setups.`);
  }

  return recommend(winner.machine, reasons, candidates, {
    route: winner.route,
    stockForm: winner.stockForm,
    barDiameterMm: winner.barDiameterMm,
    effectiveSetups: winner.setups,
    bakeOff: ranked.map((o) => o.cost),
    bakeOffNote,
  });
}
