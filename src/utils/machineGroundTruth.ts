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
    machines: ['haas-vf2'], handwritten: 'VF2',
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
    machines: ['star-sr20'], handwritten: 'SR20',
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
export const BACKTEST_BASELINE = { correct: 5, total: 8, recordedOn: '2026-08-24' } as const;
