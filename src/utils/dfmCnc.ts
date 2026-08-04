/**
 * Design-for-Manufacturing (DFM) analysis for CNC-MACHINED parts
 * (turning / sliding-head + turn-mill), metals and plastics.
 *
 * These are ADVISORY checks derived from the measured geometry — never invented.
 * They target the cost/risk levers that actually matter for precision machining:
 *   • Material yield (buy-to-fly): how much of the bar/billet becomes chips.
 *   • Slenderness (L/D) of turned parts: deflection & chatter.
 *   • Bar-diameter / machine-envelope limits.
 *   • Small holes (micro-drilling risk).
 *   • Thin walls: deflection & chatter.
 *   • Tight tolerances / many setups: inspection & tolerance stack-up.
 *
 * Thresholds are conservative defaults a shop should tune to its own machines.
 * Reuses the DfmReport shape so the existing DfmPanel renders it unchanged.
 */
import type { DfmFinding, DfmReport, DfmSeverity } from './dfm';
import type { PartClass } from './partClass';

export interface CncDfmInput {
  partClass: PartClass;
  /** Measured mean wall thickness (2·V/S), mm. */
  thicknessMm: number;
  boundingBoxMm: { lengthMm: number; widthMm: number; heightMm: number };
  /** Round-bar ⌀ and length along the axis (turned parts). */
  diameterMm: number;
  axisLengthMm: number;
  holeDetails: Array<{ diameterMm: number; count: number }>;
  /** part volume ÷ stock volume (0–1). */
  buyToFlyRatio: number;
  setups: number;
  tolerances?: string;
  /** True when metrics come from a measured solid. */
  hasGeometry: boolean;
}

// --- thresholds --------------------------------------------------------------
const BUY_TO_FLY_FAIL = 0.07; // <7% of the bar survives → mostly chips
const BUY_TO_FLY_WARN = 0.15; // <15% → heavy stock removal
const SLENDER_WARN = 10;      // turned L/D above which deflection/chatter appears
const SLENDER_FAIL = 20;      // needs tailstock/steady or won't hold tolerance
const MAX_SLIDING_HEAD_DIA = 32; // typical sliding-head bar capacity (mm)
const MAX_MILL_ENVELOPE = 500;   // typical small-VMC working envelope (mm)
const MIN_HOLE_DIA_WARN = 1.0;
const MIN_HOLE_DIA_FAIL = 0.5;
const THIN_WALL_WARN = 0.8;      // walls thinner than this deflect under tool load
const MANY_SETUPS = 3;

const mm = (v: number) => `${Math.round(v * 10) / 10}mm`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Detect a tight tolerance callout (µm, ±0.01 or better, or a fine IT fit). */
function isTightTolerance(tol?: string): boolean {
  if (!tol) return false;
  const s = tol.toLowerCase();
  if (/µm|micron|\bum\b/.test(s)) return true;
  if (/\bh[567]\b|\bg6\b|\bk6\b|\bp7\b|it[567]\b/.test(s)) return true;
  const m = s.match(/±?\s*0?\.(\d+)/);
  if (m) {
    const val = parseFloat(`0.${m[1]}`);
    return val > 0 && val <= 0.01;
  }
  return false;
}

export function analyzeCncDfm(input: CncDfmInput): DfmReport {
  const findings: DfmFinding[] = [];
  const { lengthMm, widthMm, heightMm } = input.boundingBoxMm;
  const maxSpan = Math.max(lengthMm, widthMm, heightMm);

  // 1) Buy-to-fly — how much of the stock ends up as chips.
  if (input.buyToFlyRatio > 0) {
    const yieldPct = input.buyToFlyRatio;
    if (yieldPct < BUY_TO_FLY_FAIL) {
      findings.push({
        id: 'buy-to-fly',
        severity: 'fail',
        title: `Only ${pct(yieldPct)} of the stock becomes the part`,
        detail: `Over ${pct(1 - yieldPct)} of the bar/billet is machined into chips. For volumes, a near-net form (casting, forging, or a closer-section bar) would cut both material cost and cycle time dramatically. As drawn, this is machining-heavy.`,
        rule: 'Material yield (buy-to-fly) ≥ 15%',
      });
    } else if (yieldPct < BUY_TO_FLY_WARN) {
      findings.push({
        id: 'buy-to-fly',
        severity: 'warn',
        title: `Low material yield — ${pct(yieldPct)} of stock becomes the part`,
        detail: `Roughly ${pct(1 - yieldPct)} of the stock is removed. Manufacturable, but roughing time and scrap dominate the price. A closer-section bar or billet would help on repeat orders.`,
        rule: 'Material yield (buy-to-fly) ≥ 15%',
      });
    } else {
      findings.push({
        id: 'buy-to-fly',
        severity: 'pass',
        title: `Reasonable material yield (${pct(yieldPct)})`,
        detail: `The part uses ${pct(yieldPct)} of its stock — a sensible amount of removal for a machined part.`,
        rule: 'Material yield (buy-to-fly) ≥ 15%',
      });
    }
  }

  // 2) Slenderness of a turned part (length : diameter).
  if (input.partClass === 'turned' && input.diameterMm > 0 && input.axisLengthMm > 0) {
    const ld = input.axisLengthMm / input.diameterMm;
    if (ld > SLENDER_FAIL) {
      findings.push({
        id: 'slenderness',
        severity: 'fail',
        title: `Very slender turned part (L/D ${ld.toFixed(1)}:1)`,
        detail: `At ⌀${mm(input.diameterMm)} × ${mm(input.axisLengthMm)} long, the workpiece will deflect and chatter under the tool. It needs a tailstock/steady or a guide bushing, light finishing passes, and will be hard to hold tolerance along its length.`,
        rule: 'Turned L/D ≤ 20:1 (≤10:1 unsupported)',
      });
    } else if (ld > SLENDER_WARN) {
      findings.push({
        id: 'slenderness',
        severity: 'warn',
        title: `Slender turned part (L/D ${ld.toFixed(1)}:1)`,
        detail: `⌀${mm(input.diameterMm)} × ${mm(input.axisLengthMm)} is slender enough that unsupported turning risks deflection. Sliding-head with a guide bushing handles this well; plan reduced depths of cut on finishing.`,
        rule: 'Turned L/D ≤ 20:1 (≤10:1 unsupported)',
      });
    }
  }

  // 3) Bar-diameter / machine-envelope fit.
  if (input.partClass === 'turned' && input.diameterMm > 0) {
    if (input.diameterMm > MAX_SLIDING_HEAD_DIA) {
      findings.push({
        id: 'bar-capacity',
        severity: 'info',
        title: `⌀${mm(input.diameterMm)} exceeds typical sliding-head bar capacity`,
        detail: `Above ~⌀${MAX_SLIDING_HEAD_DIA} mm this won't run on a sliding-head lathe — route it to a fixed-head/chucker. Check bar stock availability at this diameter.`,
        rule: `Bar ⌀ ≤ ${MAX_SLIDING_HEAD_DIA}mm for sliding-head`,
      });
    }
  } else if (maxSpan > MAX_MILL_ENVELOPE) {
    findings.push({
      id: 'envelope',
      severity: 'warn',
      title: `Part exceeds a typical small-mill envelope`,
      detail: `Longest side is ${mm(maxSpan)} (> ${MAX_MILL_ENVELOPE} mm). Confirm it fits the machine's travels and work-holding before quoting.`,
      rule: `Fits ≤ ${MAX_MILL_ENVELOPE}mm working envelope`,
    });
  }

  // 4) Small holes — micro-drilling risk (works from diameters alone).
  const diameters = input.holeDetails.map((h) => h.diameterMm).filter((d) => d > 0);
  if (diameters.length) {
    const smallest = Math.min(...diameters);
    if (smallest < MIN_HOLE_DIA_FAIL) {
      findings.push({
        id: 'small-holes',
        severity: 'fail',
        title: `⌀${mm(smallest)} hole needs micro-drilling`,
        detail: `Drills below ⌀${MIN_HOLE_DIA_FAIL} mm are fragile and prone to breakage — they need peck cycles, tight runout and often a specialist. Expect slow, high-risk drilling and added cost.`,
        rule: `Hole ⌀ ≥ ${MIN_HOLE_DIA_WARN}mm for reliable drilling`,
      });
    } else if (smallest < MIN_HOLE_DIA_WARN) {
      findings.push({
        id: 'small-holes',
        severity: 'warn',
        title: `Smallest hole ⌀${mm(smallest)} is small`,
        detail: `Below ~⌀${MIN_HOLE_DIA_WARN} mm, drilling slows and tool life drops. Manufacturable with peck drilling; confirm the tolerance and depth.`,
        rule: `Hole ⌀ ≥ ${MIN_HOLE_DIA_WARN}mm for reliable drilling`,
      });
    }
  }

  // 5) Thin walls — deflection / chatter under tool load.
  if (input.hasGeometry && input.thicknessMm > 0 && input.thicknessMm < THIN_WALL_WARN) {
    findings.push({
      id: 'thin-wall',
      severity: 'warn',
      title: `Thin wall (${mm(input.thicknessMm)} mean section)`,
      detail: `A mean wall of ${mm(input.thicknessMm)} will deflect and chatter under cutting forces, hurting finish and tolerance. Expect light finishing passes and possibly extra fixturing — both add cost.`,
      rule: 'Mean wall ≥ 0.8mm for machining',
    });
  }

  // 6) Tight tolerances → inspection & finishing cost.
  if (isTightTolerance(input.tolerances)) {
    findings.push({
      id: 'tolerance',
      severity: 'info',
      title: `Tight tolerance callout`,
      detail: `"${input.tolerances}" requires finish passes, tool-wear compensation and formal inspection. Achievable on precision equipment, but it adds cycle and QA time — priced into finishing and inspection.`,
      rule: 'Tolerances ≤ ±0.01mm add inspection cost',
    });
  }

  // 7) Multiple setups → tolerance stack-up.
  if (input.setups >= MANY_SETUPS) {
    findings.push({
      id: 'setups',
      severity: 'info',
      title: `${input.setups} setups required`,
      detail: `Features on multiple faces/orientations mean ${input.setups} setups. Each adds load/touch-off time and a tolerance stack between setups — turn-mill in one hit reduces both where possible.`,
      rule: 'Fewer setups = lower cost & tighter stack-up',
    });
  }

  const order: Record<DfmSeverity, number> = { fail: 0, warn: 1, pass: 2, info: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  const counts = {
    fail: findings.filter((f) => f.severity === 'fail').length,
    warn: findings.filter((f) => f.severity === 'warn').length,
    pass: findings.filter((f) => f.severity === 'pass').length,
    info: findings.filter((f) => f.severity === 'info').length,
  };
  const score = Math.max(0, 100 - counts.fail * 25 - counts.warn * 10);

  return { findings, counts, score, hasGeometry: input.hasGeometry };
}
