/**
 * WHAT A HANDBOOK SPEED ACTUALLY DELIVERS IN A JOB SHOP.
 *
 * Every cutting speed, feed and depth in `materials.ts` is a published figure,
 * and the audit against the literature found them fairly placed — brass at 400
 * m/min is mid-range against the Copper Development Association's demonstrated
 * 915, and our aluminium is at the LOW end of 500-1000. The table was not the
 * problem.
 *
 * What every one of those figures carries is a condition. Outokumpu states it
 * plainly for stainless, and the same sentence appears in every catalogue:
 *
 *   values "assume favorable cutting conditions: a well-matched insert grade,
 *   rigid tool and workpiece clamping, good-quality raw material, short tool
 *   overhang, and adequate coolant. Adjust down for interrupted cuts, poor
 *   rigidity, or thin-wall parts."
 *
 * Nobody publishes the adjustment. A shop cutting one-offs on mixed material
 * with general-purpose inserts meets almost none of those conditions, and the
 * result is the gap between a theoretical cycle and a measured one.
 *
 * THE CAR-MILEAGE SHAPE. A manufacturer quotes 20 km/l and the car returns
 * 10-12. Nobody says the 20 is wrong; nobody quotes fuel costs with it either.
 * The real figure is reached by multiplying named, separately arguable
 * allowances — traffic, air conditioning, stop-start, load — and the industry
 * publishes both numbers rather than pretending one is the other. That is
 * exactly the arrangement here: `materials.ts` keeps the book values, this file
 * holds the allowances, and the quote shows both.
 *
 * WHY A STACK AND NOT ONE NUMBER. A single fudge factor cannot be argued with,
 * and worse, it hides faults instead of exposing them. Applying this stack to the
 * VOC housing landed finish turning at x1.04 of the shop's measured time and
 * left deburring at x0.01 — which is how the five structural faults in
 * `turning.ts` were found. A factor big enough to close deburring would have made
 * finish turning a hundred times too slow, and nobody would have looked further.
 *
 * EVERY FACTOR IS THE SHOP'S TO SET. These are defaults for a job shop, each
 * with its reasoning attached so a machinist can disagree with a number rather
 * than with a black box. None of them is fitted to any shop's measured cycle
 * times; the measurements said a derate was needed, not what it should be.
 *
 * APPLIED TO CUTTING ONLY. A derate on surface speed and feed slows the time the
 * tool spends in metal. It does not slow a rapid, a turret index or a spindle
 * settling — those are the machine's, they are counted move by move in the idle
 * column, and multiplying them here would be charging the same allowance twice.
 */

export interface RealisationFactors {
  /**
   * TOOL LIFE. Handbook speeds are quoted at a reference tool life of about 15
   * minutes. A job shop wants one tool to last a whole job — call it an hour —
   * so it runs slower. Taylor's tool-life equation V*T^n = C with n ~ 0.25 for
   * carbide gives (15/60)^0.25 = 0.71 for that four-fold increase.
   */
  toolLife: number;
  /**
   * RIGIDITY AND OVERHANG. The published "adjust down" case: small parts, slender
   * boring bars, light work-holding, a part gripped in a collet with the cut at
   * the far end. Nothing here is a special condition — it is most of a job shop's
   * work.
   */
  rigidity: number;
  /**
   * ONE-OFF PROGRAMMING. A program that will run ten times is not optimised the
   * way one that will run ten thousand times is: depths and feeds are left
   * conservative because proving them out costs more than the time they save, and
   * air moves nobody trimmed stay in.
   */
  oneOffProgram: number;
  /**
   * MATERIAL CONDITION. Bar-to-bar hardness spread, mill scale, no premium
   * free-machining stock, and no certainty about what is actually in the rack.
   */
  materialCondition: number;
  /**
   * INTERRUPTED CUT AND THIN WALL — the one factor that is CONDITIONAL. It is
   * applied only to parts whose geometry says it applies, so a simple solid bar
   * job does not pay it. See `partNeedsInterruptedDerate`.
   */
  interruptedCut: number;
}

/**
 * Job-shop defaults. Deliberately NOT any one shop's numbers: a production shop
 * running proven programs on dedicated tooling sits much closer to book, and
 * should raise these.
 */
export const DEFAULT_REALISATION: RealisationFactors = {
  toolLife: 0.71,
  rigidity: 0.8,
  oneOffProgram: 0.8,
  materialCondition: 0.9,
  interruptedCut: 0.85,
};

/** A factor outside this range is a typo, not a setting. */
const clampFactor = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) && v > 0.05 && v <= 1 ? v : fallback;

export function normaliseRealisation(f?: Partial<RealisationFactors>): RealisationFactors {
  return {
    toolLife: clampFactor(f?.toolLife, DEFAULT_REALISATION.toolLife),
    rigidity: clampFactor(f?.rigidity, DEFAULT_REALISATION.rigidity),
    oneOffProgram: clampFactor(f?.oneOffProgram, DEFAULT_REALISATION.oneOffProgram),
    materialCondition: clampFactor(f?.materialCondition, DEFAULT_REALISATION.materialCondition),
    interruptedCut: clampFactor(f?.interruptedCut, DEFAULT_REALISATION.interruptedCut),
  };
}

/**
 * Does this part's geometry earn the interrupted-cut derate?
 *
 * Two signals, both from the solid rather than from a judgement:
 *
 *   A HOLE THROUGH A TURNED SURFACE makes the cut interrupted by definition —
 *   the insert leaves metal and re-enters it once a revolution, which is the
 *   classic case the catalogues tell you to slow down for.
 *
 *   A THIN WALL cannot be held rigid: the part deflects under the cut and rings.
 *   Taken as a wall thinner than 15% of the diameter, i.e. a bore wider than 70%
 *   of the OD.
 *
 * Grooves are deliberately NOT a signal. Nearly every turned part has one, so
 * treating them as interruption would apply the factor to everything, which is
 * the same as folding it into the other four and calling it conditional.
 */
export function partNeedsInterruptedDerate(p: {
  odMm?: number; boreDiaMm?: number; crossFeatureCount?: number;
}): boolean {
  if ((p.crossFeatureCount ?? 0) > 0) return true;
  const od = p.odMm ?? 0;
  const bore = p.boreDiaMm ?? 0;
  return od > 0 && bore > 0.7 * od;
}

export interface RealisationResult {
  /** The product. Multiply CUTTING time by 1/this. */
  factor: number;
  /** 1 / factor — what cutting time is multiplied by. Easier to read in a quote. */
  multiplier: number;
  /** Was the conditional interrupted-cut factor included? */
  interruptedApplied: boolean;
  /** Each factor that was applied, named, for the quote to show. */
  applied: Array<{ name: string; value: number; why: string }>;
  explanation: string;
}

const WHY: Record<keyof RealisationFactors, string> = {
  toolLife: 'book speeds assume ~15 min tool life; a job wants an hour (Taylor, n=0.25)',
  rigidity: 'small parts, slender bars, light work-holding',
  oneOffProgram: 'a program that runs ten times is not optimised like one that runs ten thousand',
  materialCondition: 'bar-to-bar hardness spread, scale, no premium stock',
  interruptedCut: 'the cut leaves metal and re-enters it, or the wall is too thin to hold',
};

const LABEL: Record<keyof RealisationFactors, string> = {
  toolLife: 'Tool life',
  rigidity: 'Rigidity / overhang',
  oneOffProgram: 'One-off programming',
  materialCondition: 'Material condition',
  interruptedCut: 'Interrupted cut / thin wall',
};

/**
 * The realisation factor for one part.
 *
 * `interrupted` decides whether the conditional factor joins the product; pass
 * what `partNeedsInterruptedDerate` says about the geometry.
 */
export function realisation(
  factors?: Partial<RealisationFactors>,
  interrupted = false,
): RealisationResult {
  const f = normaliseRealisation(factors);
  const keys: Array<keyof RealisationFactors> = interrupted
    ? ['toolLife', 'rigidity', 'oneOffProgram', 'materialCondition', 'interruptedCut']
    : ['toolLife', 'rigidity', 'oneOffProgram', 'materialCondition'];
  const applied = keys.map((k) => ({ name: LABEL[k], value: f[k], why: WHY[k] }));
  const factor = applied.reduce((a, x) => a * x.value, 1);
  return {
    factor,
    multiplier: 1 / factor,
    interruptedApplied: interrupted,
    applied,
    explanation:
      applied.map((x) => `${x.name} ${x.value}`).join(' × ')
      + ` = ${factor.toFixed(3)} → cutting time ×${(1 / factor).toFixed(2)}`
      + (interrupted ? '' : ' (interrupted-cut factor not applied — geometry does not call for it)'),
  };
}
