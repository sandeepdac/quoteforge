/**
 * Part-class detection: is this solid TURNED (a body of revolution, made from
 * round bar on a lathe / sliding-head) or MILLED (prismatic, made from a
 * rectangular billet on a machining centre)?
 *
 * The distinction drives the whole cost model: a turned part is priced from
 * round bar stock (⌀ + facing allowance) and lathe cycle time; a milled part is
 * priced from a rectangular billet and material-removal volume.
 *
 * We infer it from the bounding box and enclosed volume — no B-Rep face data
 * required — so it works from a simple measured mesh:
 *   • A body of revolution has two bounding-box dimensions nearly equal (the
 *     diameter) and fills ~π/4 (≈0.785) of its bounding box in the round plane.
 *   • A prismatic part tends to fill much more of its box, or has three
 *     distinct dimensions.
 */

export type PartClass = 'turned' | 'milled';

export interface PartClassResult {
  partClass: PartClass;
  /** 0–1 confidence in the classification. */
  confidence: number;
  /** Round-stock diameter (mm) when turned; largest cross-section otherwise. */
  diameterMm: number;
  /** Length along the turning axis (mm) when turned. */
  axisLengthMm: number;
  reason: string;
}

export interface PartClassInput {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  volumeCm3: number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function classifyPart(input: PartClassInput): PartClassResult {
  const dims = [input.lengthMm, input.widthMm, input.heightMm]
    .map((d) => Math.max(0, d))
    .sort((a, b) => b - a); // [a, b, c] descending
  const [a, b, c] = dims;
  const bboxVolCm3 = (a * b * c) / 1000;

  // Degenerate / unmeasured input → default to milled (safe: billet + removal).
  if (a <= 0 || bboxVolCm3 <= 0 || input.volumeCm3 <= 0) {
    return {
      partClass: 'milled',
      confidence: 0,
      diameterMm: round1(a),
      axisLengthMm: round1(a),
      reason: 'No usable geometry — defaulting to milled (billet).',
    };
  }

  // Find the most nearly-equal pair of dimensions: that pair is the candidate
  // diameter, and the remaining dimension is the length along the turning axis.
  const pairs: Array<{ d: number; axis: number; ratio: number }> = [
    { d: (a + b) / 2, axis: c, ratio: b / a },
    { d: (b + c) / 2, axis: a, ratio: c / b },
    { d: (a + c) / 2, axis: b, ratio: c / a },
  ];
  const best = pairs.reduce((m, p) => (p.ratio > m.ratio ? p : m), pairs[0]);
  const roundness = best.ratio; // 1.0 = perfectly square cross-section

  const diameterMm = best.d;
  const axisLengthMm = best.axis;

  // How full is the part relative to a perfect cylinder of that ⌀ and length?
  const cylVolCm3 = (Math.PI / 4) * diameterMm * diameterMm * axisLengthMm / 1000;
  const cylFill = cylVolCm3 > 0 ? input.volumeCm3 / cylVolCm3 : 0;
  // Fill relative to the bounding box (a solid cylinder fills ~0.785 of its box).
  const bboxFill = input.volumeCm3 / bboxVolCm3;

  // Turned when the cross-section is close to square (round bar) AND the solid
  // occupies a cylinder-like fraction of its box — i.e. material sits inside the
  // inscribed cylinder, not the box corners.
  const looksRound = roundness >= 0.82;
  const cylinderLike = cylFill >= 0.45 && cylFill <= 1.2 && bboxFill <= 0.9;

  if (looksRound && cylinderLike) {
    // Confidence grows with how square the cross-section is and how close bbox
    // fill sits to the ideal π/4 for a revolved solid.
    const roundScore = (roundness - 0.82) / 0.18; // 0..1 across [0.82, 1.0]
    const fillScore = 1 - Math.min(1, Math.abs(bboxFill - 0.785) / 0.4);
    const confidence = Math.max(0, Math.min(1, 0.5 * roundScore + 0.5 * fillScore));
    return {
      partClass: 'turned',
      confidence: round1(confidence),
      diameterMm: round1(diameterMm),
      axisLengthMm: round1(axisLengthMm),
      reason: `Body of revolution: ⌀${round1(diameterMm)} × ${round1(axisLengthMm)} mm (cross-section ${Math.round(roundness * 100)}% round, fills ${Math.round(bboxFill * 100)}% of its box) — round-bar turning.`,
    };
  }

  return {
    partClass: 'milled',
    confidence: round1(Math.min(1, Math.max(0.3, 1 - roundness * 0.5))),
    diameterMm: round1(diameterMm),
    axisLengthMm: round1(axisLengthMm),
    reason: `Prismatic solid ${round1(a)} × ${round1(b)} × ${round1(c)} mm (fills ${Math.round(bboxFill * 100)}% of its box) — milled from billet.`,
  };
}
