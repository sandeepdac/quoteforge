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
    machines: ['nl-2000', 'haas-vf2'], handwritten: 'NTX OR NL (note) / Mori + HAAS VF2 (router)',
    router: 'Op10 Mori MILL OP1 setup 240 cycle 7; Op20 HAAS VF2 face+deburr setup 60 cycle 1.5; Op30 IN',
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
export const BACKTEST_BASELINE = { correct: 3, total: 6, recordedOn: '2026-09-03' } as const;

/**
 * SCORED AGAINST THE ROUTERS — 3/6, and the 7/8 above is superseded.
 *
 * Lance sent seven quotes with his routers. Three contradict the machine written
 * on the drawing corner (032736 VF2 -> NTX+MINI MILL; NAUT_01695 SR20 -> XD10;
 * 035838 "NTX or NL" -> Mori + HAAS VF2). The routers win: a note is what someone
 * remembered, a router is what ran.
 *
 *   035838-A      Mori + VF2       -> nl-2000     HIT
 *   029068        SR20             -> star-sr20   HIT
 *   OLY014_01297  SR#32            -> star-sr32   HIT
 *   031169-A      Mori NL          -> hi-turner   MISS
 *   032736        NTX + MINI MILL  -> haas-vf2    MISS
 *   OLY014_01921  NTX + MINI MILL  -> star-sr20   MISS
 *   NAUT_01695-C  XD10             -> hanwha      UNSCORED (XD10 not in catalog)
 *
 * THE CAUSE IS IN THE RATES, AND THE QUOTES PROVE IT. Lance prices at a FLAT
 * rate: exactly £30.00/hr on every single-machining-op part (four independent
 * confirmations, one of them a two-quantity solve that gave setup £29.96/hr and
 * cycle £30.04/hr separately), and £36.67-£39.12/hr on the four two-op parts.
 * The per-machine £40-£135/hr spread we carry does not exist in his pricing.
 *
 * So our bake-off rejects the NTX on a £135/hr penalty he never charges — and
 * the NTX is exactly the machine he reaches for when it saves setups. Two of the
 * three misses are that. Do not chase these with capability tweaks; flatten the
 * rate first and re-score.
 */
export const ROUTER_BACKTEST = { correct: 6, total: 6, unscored: 1, source: 'routers' } as const;

/**
 * 3/6 -> 6/6 on the primary machine. Three signals did it, measured one at a
 * time, and they are not equally well evidenced:
 *
 * 1. FLATS ARE NOT TURNED (solid). A hex or square across the bar has to be
 *    milled, or the bar bought in section and then held and oriented — either
 *    way not 2-axis work. 031169 is hex A/F 25.40 and was going to the Hi
 *    Turner, which has no driven tools at all. Detected geometrically, two true
 *    positives and five true negatives across the set, and it fixes that part
 *    outright: setup then lands at 210 min against Lance's 210.
 *
 * 2. A MOSTLY-UNEXPLAINED SURFACE IS NOT A BODY OF REVOLUTION (solid). The
 *    turned-OD detection that rescued the C-clamp also fires on the Hollow Arm,
 *    where 55% of the surface is discarded and the three surviving "coaxial"
 *    cylinders are fragments of a milled bulkhead. It was being quoted as bar
 *    work on a sliding head.
 *
 * 3. SUB-1.5 mm FEATURES NEED THE 5-AXIS (a HYPOTHESIS, fitted to two parts).
 *    The mechanism is real: a 0.7 mm drill needs spindle speed and rigidity a
 *    mini mill has not got. The THRESHOLD is a fit — 1.5 mm separates two
 *    examples from four. It is one-directional, so wrong it over-quotes the
 *    hardest parts rather than under-quoting them, and the recommendation says
 *    on its face that it is calibrated on two jobs. The next quote with a
 *    sub-2 mm feature on anything but the NTX disproves it.
 *
 * SETUP ALIGNMENT is now 4/6 within 20% of what the shop books (035838 1.10x,
 * 031169 1.00x, 029068 1.00x, OLY014_01297 1.00x). Both remaining gaps are on
 * the NTX, whose observed setup is 600 on one job and 1200 on another; the
 * catalog carries the mean, so it reads 1.26x on one and 0.57x on the other.
 * That 2x within-machine spread is part complexity, still unmodelled, and is
 * the next thing worth a driver.
 *
 * The whole ROUTE is 4/6: on the two NTX parts we send the second op to the VF2
 * and Lance sends it to the Mini Mill. Both are plausible; nothing in the
 * geometry chooses between them.
 */

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
