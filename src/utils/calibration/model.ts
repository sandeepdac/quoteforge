/**
 * WHAT A COST MODEL HAS TO DECLARE.
 *
 * A model that returns one number cannot be pressure-tested. If it says 56
 * minutes and the shop took 210, the only available conclusion is "wrong", and
 * the only available fix is a multiplier. Multiply by 3.75 and the model is now
 * right about these seven parts and says nothing about the eighth.
 *
 * So a model here returns TERMS, not a total. Each term names a thing a person
 * actually does, states what drives it, and — the part that matters — declares
 * how well that driver is EVIDENCED. A term marked `assumed` that dominates the
 * residual is the next thing to go and ask Lance about; a term marked
 * `calibrated` that dominates the residual means the calibration is wrong. Those
 * are different problems and a single number cannot tell them apart.
 *
 * This also makes models comparable. Two models that disagree can be diffed term
 * by term rather than argued about, and a model that improves the total while
 * making a term worse is visible instead of lucky.
 */

/** How much we actually know about a term's driver. */
export type Evidence =
  /** Fitted to, or confirmed by, the quoted parts. Moving it needs re-scoring. */
  | 'calibrated'
  /** Derived from first principles (feeds, speeds, geometry). Falsifiable. */
  | 'derived'
  /** A plausible number nobody has checked. The honest default. */
  | 'assumed'
  /** Known to be missing. Present so the total is not silently short. */
  | 'unmodelled';

export interface Term {
  /** What a machinist would call this, not what the code calls it. */
  name: string;
  /** Minutes, for time terms. Money terms use `amount` instead. */
  minutes?: number;
  amount?: number;
  /** The quantity this term scales with, in words a person can check. */
  driver: string;
  evidence: Evidence;
  /** Why this number and not another. Read when the term is the residual. */
  note?: string;
}

export interface ModelEstimate {
  /** Setup, decomposed. Summing these must give the model's setup time. */
  setup: Term[];
  /** Per-part cutting and handling. */
  cycle: Term[];
  /** Money that is not time: material, subcontract, consumables. */
  money: Term[];
  /** The rate the model believes applies, and why. */
  ratePerHour: number;
  rateBasis: string;
}

export interface CostModel {
  id: string;
  /** One sentence a person can disagree with. */
  claim: string;
  estimate(input: ModelInput): ModelEstimate;
}

export interface ModelInput {
  /** Geometry from the analyser, shape-agnostic so models can use what they need. */
  geometry: Record<string, unknown>;
  /** Machining operations the route implies. */
  machiningOps: number;
  quantity: number;
  materialName: string;
}

export const sumMinutes = (ts: Term[]) => ts.reduce((a, t) => a + (t.minutes ?? 0), 0);
export const sumAmount = (ts: Term[]) => ts.reduce((a, t) => a + (t.amount ?? 0), 0);

/** Terms carrying the least evidence, worst first — the interview list. */
export function weakestTerms(e: ModelEstimate): Term[] {
  const rank: Record<Evidence, number> = { unmodelled: 0, assumed: 1, derived: 2, calibrated: 3 };
  return [...e.setup, ...e.cycle, ...e.money]
    .filter((t) => (t.minutes ?? t.amount ?? 0) !== 0 || t.evidence === 'unmodelled')
    .sort((a, b) => rank[a.evidence] - rank[b.evidence]
      || (b.minutes ?? b.amount ?? 0) - (a.minutes ?? a.amount ?? 0));
}
