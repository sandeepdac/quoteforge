/**
 * LANCE'S ANSWERS.
 *
 * Every machine-selection rule in this project was written from reasoning about
 * kinematics and capacity: a sliding head is a bar machine, a 3-axis mill needs
 * one clamp per direction, a 5-axis turn-mill can collapse setups. The reasoning
 * is sound and it is all testable — but until now it was tested only against
 * itself, because nobody had said which machine actually cuts these parts.
 *
 * Lance wrote the machine on the top corner of ten drawings. This is that list.
 * It is the first external check the engine has ever had on the number that our
 * own sensitivity analysis says is worth ~24% of the price: which machine, and
 * therefore how many setups and at what rate.
 *
 * Treat these as FACTS, not preferences. Where the engine disagrees, the engine
 * is what changes.
 */

/** Catalog ids in machineSelection.ts. */
export type MachineId =
  | 'hanwha' | 'star-sr20' | 'star-sr32'
  | 'ntx-1000' | 'nl-2000' | 'hi-turner'
  | 'haas-vf2' | 'sabre' | 'h-mini-mill-300';

export interface GroundTruthPart {
  /** Drawing number as written in the title block. */
  drawing: string;
  /** Title-block description, for humans reading a failure. */
  title: string;
  /** Substring that identifies this part's STEP file in the corpus. */
  stepMatch?: string;
  material: string;
  /**
   * What Lance wrote. More than one means he named alternatives — any of them
   * is a correct answer, and picking one over another is not an error.
   */
  machines: MachineId[];
  /** Verbatim, so a reader can check the mapping to catalog ids themselves. */
  handwritten: string;
  /**
   * His actual ROUTER, where we have the quote. This outranks `handwritten`:
   * on 032736 the drawing corner says VF2 while the router runs NTX + MINI MILL,
   * and on NAUT_01695 the note says SR20 while the router runs XD10. A note
   * written on a drawing is what someone remembered; the router is what ran.
   */
  router?: string;
}

export const MACHINE_GROUND_TRUTH: GroundTruthPart[] = [
  {
    drawing: '035838', title: 'Bulkhead C Clamp — KF16/KF10 Vacuum Manifold',
    stepMatch: '035838', material: 'Aluminium 6082 (HE30)',
    machines: ['ntx-1000', 'nl-2000'], handwritten: 'NTX OR NL',
  },
  {
    drawing: '032736', title: 'Cold Stage Block',
    stepMatch: '032736', material: 'Copper C103',
    // SUPERSEDED BY THE ROUTER. The drawing corner says VF2; his router runs
    // Op10 NTX1000 + Op20 MINI MILL. The router is what the shop actually did.
    machines: ['ntx-1000', 'h-mini-mill-300'], handwritten: 'VF2 (note) / NTX1000 + MINI MILL (router)',
    router: 'Op10 NTX1000 setup 600 cycle 20; Op20 MINI MILL setup 210 cycle 5; Op25 SCPLAT gold; Op30 IN',
  },
  {
    drawing: '031581', title: 'Stage Spacer Block — PP3020',
    stepMatch: '031581', material: 'PEEK',
    machines: ['ntx-1000'], handwritten: 'NTX',
  },
  {
    drawing: '031169', title: 'VOC Carbsorb Housing',
    material: 'Brass BS2874 CZ121',
    machines: ['nl-2000'], handwritten: 'NL MORI',
  },
  {
    drawing: '031167', title: 'VOC Condenser Side Flange',
    stepMatch: '031167', material: 'Brass BS2874 CZ121',
    machines: ['nl-2000'], handwritten: 'NL MORI',
  },
  {
    drawing: '029068', title: 'Removable Collet Holding Block',
    stepMatch: '029068', material: 'Phosphor bronze PB102',
    machines: ['star-sr20'], handwritten: 'SR20',
  },
  {
    drawing: 'Kepler_00884', title: 'Fixture B — simplified re-design',
    stepMatch: 'Kepler_00884', material: '316 stainless',
    machines: ['haas-vf2'], handwritten: 'VF2',
  },
  {
    drawing: 'OLY014_01921', title: 'Hollow arm bulkhead, short',
    stepMatch: 'OLY014_01921', material: 'Stainless',
    machines: ['ntx-1000'], handwritten: 'NTX',
  },
  {
    drawing: 'NAUT_01695', title: 'Guide Rod',
    material: '416 stainless (Temper H)',
    // SUPERSEDED BY THE ROUTER. The note says SR20; the router runs XD10, which
    // is not a machine in MACHINE_CATALOG at all — we cannot pick it.
    machines: [], handwritten: 'SR20 (note) / XD10 (router) — XD10 NOT IN CATALOG',
    router: 'Op10 XD10 setup 180 cycle 1.5; Op20 CLEAN; Op25 SCHEAT harden; Op30 IN',
  },
  {
    drawing: 'OLY014_01297', title: 'Toolset Drive Unit — Drive Dog',
    stepMatch: 'OLY014_01297', material: 'POM-H',
    machines: ['star-sr32'], handwritten: 'SR32',
  },
];

/** The subset we hold STEP geometry for, i.e. what can actually be back-tested. */
export const GROUND_TRUTH_WITH_GEOMETRY = MACHINE_GROUND_TRUTH.filter((p) => p.stepMatch);

/**
 * FIRST SCORE — 5/8 (63%), run through the real app via scripts/machine-backtest.cjs.
 *
 *   035838        NTX or NL  ->  h-mini-mill-300   MISS
 *   032736        VF2        ->  haas-vf2          HIT
 *   031581        NTX        ->  ntx-1000          HIT
 *   031167        NL         ->  nl-2000           HIT
 *   029068        SR20       ->  star-sr20         HIT
 *   Kepler_00884  VF2        ->  haas-vf2          HIT
 *   OLY014_01921  NTX        ->  h-mini-mill-300   MISS
 *   OLY014_01297  SR32       ->  h-mini-mill-300   MISS
 *
 * All three misses are round parts Lance runs on a spindle, and all three went
 * to the cheapest machine on the floor (£40/hr). The cause is an ASYMMETRY OF
 * EVIDENCE in selectMilledPartMachine, not a bad rate:
 *
 *   - A turning machine must clear six gates to be considered capable —
 *     barSuitable, barLike, roundEnough, coaxial turned features, chuck ⌀,
 *     turn length. Any one of them disqualifies it.
 *   - A milling centre must clear ONE: fitsEnvelope. Which fails OPEN, returning
 *     true when the machine has no declared envelope or the part has no dims.
 *
 * So a ⌀8 × 13 mm hollow arm "fits" a 370 × 300 × 450 mm mini mill and wins on
 * rate, with nothing asking whether it could actually be held and reached. The
 * mill's true cost is understated (billet, workholding, manual handling, a
 * second op) rather than the turn's being overstated.
 *
 * Do not tune rates to close this gap — the rates are not what is wrong. Any fix
 * belongs at the capability gate, and must be re-scored here before it ships.
 */
export const BACKTEST_BASELINE = { correct: 7, total: 8, recordedOn: '2026-08-24' } as const;

/**
 * 5/8 -> 6/8. The Drive Dog now routes to the SR32, because turnFit stopped
 * letting a volume-fill PROXY veto direct evidence, and stopped demanding a
 * length-to-diameter ratio that small bar work never has.
 *
 * Getting there cost one regression, which is the whole reason this file exists:
 * relaxing the aspect rule on bounding-box shape alone bar-fed the Cold Stage
 * Block — a rectangular copper block — to a sliding head, because a box cannot
 * tell a ⌀20 disc from a 26x25 block. Both score ~1.0 on cross-section balance.
 * The short-part relaxation now requires coaxial evidence as well.
 *
 * 6/8 -> 7/8. The last two were a DETECTION problem, not a selection one: both
 * reported zero coaxial turned features, so no routing rule could reach them.
 * Two rules in milling.py were throwing away the parts' own outside diameters —
 * see the comments there on `turned_od_groups` and `boss_corner_dia_max`.
 *
 * WHAT IS STILL WRONG, precisely: OLY014_01921 goes to the Star SR-20; Lance
 * runs it on the NTX. That is no longer the old failure — the route, the stock
 * form and the setup count are now right, and it is a bar-fed spindle job rather
 * than billet on a 3-axis mill. What is left is the choice between two spindle
 * machines, and the engine has no evidence to make it: the part reports
 * angledSetups = 0, so nothing asks for five axes, and the SR-20 is both cheaper
 * (£52 vs £135) and the more accurate machine on paper (0.005 vs 0.01 mm).
 *
 * The likely reason is the compound-angle work the drawing shows — a 210° arc
 * feature and a ⌀1 H7 that a sliding head cannot reach — which our angled-setup
 * detection does not see. That detection feeds setupCount, the single most
 * price-sensitive number in the engine (+1 setup moves a quote ~24%), so it is
 * NOT something to adjust on a hunch to close a one-part gap. Ask Lance why the
 * NTX first; if it is the B-axis, fix the detection and re-score here.
 */
