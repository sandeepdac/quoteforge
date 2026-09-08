/**
 * SCORING A MODEL AGAINST THE QUOTES.
 *
 * The number that matters is not the mean error. A model can sit within 10% on
 * average by being 3x low on half the parts and 3x high on the other half, and
 * that model is useless — it has no signal, only cancellation.
 *
 * So this reports:
 *   - the error on EVERY part, signed, never just the aggregate;
 *   - whether the errors share a direction (a missing or mis-scaled TERM) or
 *     scatter around zero (noise, or a driver we have not identified);
 *   - the spread, because a model that is uniformly 3x low is one constant away
 *     from correct, while one that ranges 1.5x to 12x low is structurally wrong.
 *
 * A model earns a change to the engine by beating the incumbent on SPREAD, not
 * on mean. Getting the mean right is what a multiplier does.
 */
import { QUOTED_PARTS, QuotedPart, totalSetupMin, cycleMinPerPart, machiningOps, impliedRatePerHour } from './quotes';

export interface PartScore {
  drawing: string;
  qty: number;
  /** Signed ratio: >1 means the model is HIGH, <1 means LOW. */
  setupRatio: number | null;
  cycleRatio: number | null;
  priceRatio: number | null;
  lanceSetupMin: number;
  modelSetupMin: number | null;
  impliedRate: number;
  machiningOps: number;
}

export interface ModelScore {
  modelId: string;
  parts: PartScore[];
  /** Geometric mean of the price ratios — the typical error. */
  centralRatio: number;
  /** Ratio of worst to best. 1.0 is a model with one constant left to fix. */
  spread: number;
  /** True when every part errs the same way: a missing term, not noise. */
  systematic: boolean;
}

const geoMean = (xs: number[]) =>
  xs.length ? Math.exp(xs.reduce((a, x) => a + Math.log(x), 0) / xs.length) : NaN;

export function scoreParts(
  rows: { drawing: string; qty: number; modelSetupMin: number | null; modelCycleMin: number | null; modelPrice: number | null }[],
  modelId: string,
): ModelScore {
  const byDrawing = new Map(QUOTED_PARTS.map((p) => [p.drawing, p]));
  const parts: PartScore[] = [];

  for (const r of rows) {
    const p: QuotedPart | undefined = byDrawing.get(r.drawing);
    if (!p) continue;
    const pricing = p.pricing.find((x) => x.qty === r.qty) ?? p.pricing[0];
    const lanceSetup = totalSetupMin(p);
    const lanceCycle = cycleMinPerPart(p);
    parts.push({
      drawing: p.drawing,
      qty: pricing.qty,
      lanceSetupMin: lanceSetup,
      modelSetupMin: r.modelSetupMin,
      setupRatio: r.modelSetupMin ? r.modelSetupMin / lanceSetup : null,
      cycleRatio: r.modelCycleMin && lanceCycle ? r.modelCycleMin / lanceCycle : null,
      priceRatio: r.modelPrice ? r.modelPrice / pricing.quotedPrice : null,
      impliedRate: impliedRatePerHour(p, p.pricing.indexOf(pricing)),
      machiningOps: machiningOps(p).length,
    });
  }

  const ratios = parts.map((x) => x.priceRatio).filter((x): x is number => !!x && x > 0);
  const central = geoMean(ratios);
  const spread = ratios.length ? Math.max(...ratios) / Math.min(...ratios) : NaN;
  // Every part on the same side of 1.0 means a term is missing or mis-scaled,
  // which is a fixable structural fault. Errors that straddle 1.0 are not.
  const systematic = ratios.length > 2 && (ratios.every((x) => x < 1) || ratios.every((x) => x > 1));

  return { modelId, parts, centralRatio: central, spread, systematic };
}

export function formatScore(s: ModelScore): string {
  const L: string[] = [];
  L.push(`MODEL: ${s.modelId}`);
  L.push('');
  L.push('part'.padEnd(17) + 'qty'.padStart(5) + 'ops'.padStart(5)
    + 'setup x'.padStart(10) + 'cycle x'.padStart(10) + 'price x'.padStart(10) + '  £/hr Lance');
  L.push('-'.repeat(72));
  for (const p of s.parts) {
    const f = (v: number | null) => (v === null ? '—' : v.toFixed(2)).padStart(10);
    L.push(p.drawing.padEnd(17) + String(p.qty).padStart(5) + String(p.machiningOps).padStart(5)
      + f(p.setupRatio) + f(p.cycleRatio) + f(p.priceRatio)
      + '  ' + p.impliedRate.toFixed(2).padStart(6));
  }
  L.push('-'.repeat(72));
  L.push(`typical price error  x${s.centralRatio.toFixed(2)}   (1.00 = correct, <1 = quoting LOW)`);
  L.push(`spread worst/best    x${s.spread.toFixed(1)}   <- the number a real model has to reduce`);
  L.push(s.systematic
    ? 'every part errs the SAME WAY: a term is missing or mis-scaled, not noise'
    : 'errors straddle 1.0: no single constant fixes this');
  return L.join('\n');
}
