/**
 * Design-for-Manufacturing (DFM) analysis for TURNED parts (sliding-head / turn-mill),
 * metals and plastics.
 *
 * Advisory checks derived from the measured geometry — never invented. They target
 * the cost/risk levers that matter for precision turning:
 *   • Material yield (buy-to-fly): how much of the bar becomes chips.
 *   • Slenderness (L/D): deflection & chatter.
 *   • Bar-diameter / machine-envelope limits.
 *   • Deep bores (peck/gun-drilling), small/micro holes, thin walls.
 *   • Tight tolerance / fine finish → extra finishing or grinding.
 *   • Off-axis (cross) features → second op / live tooling.
 *
 * Thresholds are conservative defaults a shop should tune. Reuses DfmReport so the
 * existing DfmPanel renders it unchanged.
 */
import type { DfmFinding, DfmReport, DfmSeverity } from './dfmTypes';

export interface CncDfmInput {
  /** Measured mean wall thickness (2·V/S), mm. */
  thicknessMm: number;
  boundingBoxMm: { lengthMm: number; widthMm: number; heightMm: number };
  /** Round-bar ⌀ and length along the axis. */
  diameterMm: number;
  axisLengthMm: number;
  holeDetails: Array<{ diameterMm: number; count: number }>;
  /** part volume ÷ stock volume (0–1). */
  buyToFlyRatio: number;
  setups: number;
  /** Central bore, if detected. */
  boreDiaMm?: number;
  boreDepthMm?: number;
  /** Largest hole drillable from solid (mm) — bigger bores need boring. Default 20. */
  maxDrillDiaMm?: number;
  /** Off-axis holes / flats / keyways present. */
  crossFeatures?: boolean;
  tolerances?: string;
  /** Kept for call-site compatibility; turning-only. */
  partClass?: 'turned' | 'milled';
  /** True when metrics come from a measured solid. */
  hasGeometry: boolean;
}

// --- thresholds --------------------------------------------------------------
const BUY_TO_FLY_FAIL = 0.07;
const BUY_TO_FLY_WARN = 0.15;
const SLENDER_WARN = 10;
const SLENDER_FAIL = 20;
const MAX_SLIDING_HEAD_DIA = 32;
const MIN_HOLE_DIA_WARN = 1.0;
const MIN_HOLE_DIA_FAIL = 0.5;
const THIN_WALL_WARN = 0.8;
const DEEP_BORE_WARN = 3;  // depth : ⌀ above which pecking is needed
const DEEP_BORE_FAIL = 5;  // gun-drilling / special tooling territory
const DEFAULT_MAX_DRILL_DIA = 20; // largest hole drilled from solid (mm)
const MANY_SETUPS = 2;

const mm = (v: number) => `${Math.round(v * 10) / 10}mm`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Detect a tight tolerance / fine finish callout (µm, ±0.01 or better, fine IT fit, low Ra). */
function isTightTolerance(tol?: string): boolean {
  if (!tol) return false;
  const s = tol.toLowerCase();
  if (/µm|micron|\bum\b/.test(s)) return true;
  if (/\bh[567]\b|\bg6\b|\bk6\b|\bp7\b|it[567]\b/.test(s)) return true;
  const ra = s.match(/ra\s*0?\.(\d+)/);
  if (ra && parseFloat(`0.${ra[1]}`) <= 0.8) return true;
  const m = s.match(/±?\s*0?\.(\d+)/);
  if (m) {
    const val = parseFloat(`0.${m[1]}`);
    return val > 0 && val <= 0.025;
  }
  return false;
}

export function analyzeCncDfm(input: CncDfmInput): DfmReport {
  const findings: DfmFinding[] = [];

  // 1) Buy-to-fly — how much of the bar becomes chips.
  if (input.buyToFlyRatio > 0) {
    const y = input.buyToFlyRatio;
    if (y < BUY_TO_FLY_FAIL) {
      findings.push({ id: 'buy-to-fly', severity: 'fail', title: `Only ${pct(y)} of the bar becomes the part`, detail: `Over ${pct(1 - y)} of the bar is turned into swarf. For volume, a closer-section bar, a casting or a near-net form would cut material cost and cycle time sharply.`, rule: 'Material yield (buy-to-fly) ≥ 15%' });
    } else if (y < BUY_TO_FLY_WARN) {
      findings.push({ id: 'buy-to-fly', severity: 'warn', title: `Low material yield — ${pct(y)} of the bar becomes the part`, detail: `Roughly ${pct(1 - y)} of the bar is removed. Manufacturable, but roughing time and stock dominate the price. A closer-section bar helps on repeat orders.`, rule: 'Material yield (buy-to-fly) ≥ 15%' });
    } else {
      findings.push({ id: 'buy-to-fly', severity: 'pass', title: `Reasonable material yield (${pct(y)})`, detail: `The part uses ${pct(y)} of its bar stock — a sensible amount of turning.`, rule: 'Material yield (buy-to-fly) ≥ 15%' });
    }
  }

  // 2) Slenderness (L/D) — deflection & chatter.
  if (input.diameterMm > 0 && input.axisLengthMm > 0) {
    const ld = input.axisLengthMm / input.diameterMm;
    if (ld > SLENDER_FAIL) {
      findings.push({ id: 'slenderness', severity: 'fail', title: `Very slender part (L/D ${ld.toFixed(1)}:1)`, detail: `⌀${mm(input.diameterMm)} × ${mm(input.axisLengthMm)} will deflect and chatter. It needs a guide bushing / tailstock / steady, light finishing cuts, and will be hard to hold size along its length.`, rule: 'Turned L/D ≤ 20:1 (≤10:1 unsupported)' });
    } else if (ld > SLENDER_WARN) {
      findings.push({ id: 'slenderness', severity: 'warn', title: `Slender part (L/D ${ld.toFixed(1)}:1)`, detail: `⌀${mm(input.diameterMm)} × ${mm(input.axisLengthMm)} is slender enough that unsupported turning risks deflection. A sliding-head guide bushing handles this; plan reduced finishing depths.`, rule: 'Turned L/D ≤ 20:1 (≤10:1 unsupported)' });
    }
  }

  // 3) Bar capacity.
  if (input.diameterMm > MAX_SLIDING_HEAD_DIA) {
    findings.push({ id: 'bar-capacity', severity: 'info', title: `⌀${mm(input.diameterMm)} exceeds typical sliding-head capacity`, detail: `Above ~⌀${MAX_SLIDING_HEAD_DIA} mm this won't run on a sliding-head lathe — route to a fixed-head/chucker and confirm bar availability at this diameter.`, rule: `Bar ⌀ ≤ ${MAX_SLIDING_HEAD_DIA}mm for sliding-head` });
  }

  // 4) Deep bore — pecking / gun-drilling.
  if (input.boreDiaMm && input.boreDepthMm && input.boreDiaMm > 0) {
    const ld = input.boreDepthMm / input.boreDiaMm;
    if (ld > DEEP_BORE_FAIL) {
      findings.push({ id: 'deep-bore', severity: 'fail', title: `Deep bore (depth/⌀ ${ld.toFixed(1)}:1)`, detail: `⌀${mm(input.boreDiaMm)} × ${mm(input.boreDepthMm)} deep needs gun-drilling or heavy pecking with swarf-clearance dwells — slow and tooling-sensitive. Priced with a peck penalty; confirm feasibility.`, rule: 'Bore depth/⌀ ≤ 5:1 (peck > 3:1)' });
    } else if (ld > DEEP_BORE_WARN) {
      findings.push({ id: 'deep-bore', severity: 'warn', title: `Deep bore (depth/⌀ ${ld.toFixed(1)}:1)`, detail: `⌀${mm(input.boreDiaMm)} × ${mm(input.boreDepthMm)} deep needs peck drilling to clear swarf, adding cycle time (included in the estimate).`, rule: 'Bore depth/⌀ ≤ 5:1 (peck > 3:1)' });
    }
  }

  // 4b) Wide bore — cannot be drilled from solid; needs a boring bar.
  if (input.boreDiaMm && input.boreDiaMm > 0) {
    const maxDrill = input.maxDrillDiaMm ?? DEFAULT_MAX_DRILL_DIA;
    const wall = input.diameterMm > 0 ? (input.diameterMm - input.boreDiaMm) / 2 : Infinity;
    if (input.diameterMm > 0 && input.boreDiaMm >= input.diameterMm) {
      findings.push({ id: 'bore-vs-od', severity: 'fail', title: `Bore ⌀${mm(input.boreDiaMm)} ≥ part ⌀${mm(input.diameterMm)}`, detail: `The bore is as large as (or larger than) the outside diameter — there is no wall left to turn. Re-check the extracted bore/OD; this isn't a producible turned part as measured.`, rule: 'Bore ⌀ must be smaller than part ⌀' });
    } else if (input.boreDiaMm > maxDrill) {
      const sev: DfmSeverity = wall < THIN_WALL_WARN ? 'warn' : 'info';
      findings.push({ id: 'wide-bore', severity: sev, title: `⌀${mm(input.boreDiaMm)} bore exceeds the ⌀${maxDrill}mm max drill`, detail: `A ⌀${mm(input.boreDiaMm)} hole can't be drilled in one shot — it's drilled to a ⌀${maxDrill}mm pilot and then bored out with a boring bar (several roughing passes + a finish pass). Those boring passes are now included in the cycle-time estimate.${wall < THIN_WALL_WARN ? ` Note the resulting ~${mm(wall)} wall is thin and may deflect.` : ''} Confirm the shop has a boring bar that reaches ${mm(input.boreDepthMm || 0)} deep.`, rule: `Bore ⌀ > ${maxDrill}mm ⇒ drill + bore out` });
    }
  }

  // 5) Small / micro holes.
  const diameters = input.holeDetails.map((h) => h.diameterMm).filter((d) => d > 0);
  if (diameters.length) {
    const smallest = Math.min(...diameters);
    if (smallest < MIN_HOLE_DIA_FAIL) {
      findings.push({ id: 'small-holes', severity: 'fail', title: `⌀${mm(smallest)} hole needs micro-drilling`, detail: `Drills below ⌀${MIN_HOLE_DIA_FAIL} mm are fragile — peck cycles, tight runout, breakage risk, often a specialist. Slow and high-risk.`, rule: `Hole ⌀ ≥ ${MIN_HOLE_DIA_WARN}mm for reliable drilling` });
    } else if (smallest < MIN_HOLE_DIA_WARN) {
      findings.push({ id: 'small-holes', severity: 'warn', title: `Smallest hole ⌀${mm(smallest)} is small`, detail: `Below ~⌀${MIN_HOLE_DIA_WARN} mm, drilling slows and tool life drops. Manufacturable with peck drilling; confirm tolerance and depth.`, rule: `Hole ⌀ ≥ ${MIN_HOLE_DIA_WARN}mm for reliable drilling` });
    }
  }

  // 6) Thin walls.
  if (input.hasGeometry && input.thicknessMm > 0 && input.thicknessMm < THIN_WALL_WARN) {
    findings.push({ id: 'thin-wall', severity: 'warn', title: `Thin wall (${mm(input.thicknessMm)} mean section)`, detail: `A mean wall of ${mm(input.thicknessMm)} deflects and chatters under cutting load, hurting finish and tolerance. Expect light finishing passes and possibly extra work-holding.`, rule: 'Mean wall ≥ 0.8mm for turning' });
  }

  // 7) Tight tolerance / fine finish → grinding flag.
  if (isTightTolerance(input.tolerances)) {
    findings.push({ id: 'tolerance', severity: 'warn', title: `Tight tolerance / fine finish callout`, detail: `"${input.tolerances}" may not be reliably held by turning alone — it can require a dedicated finish pass or a secondary GRINDING operation, plus formal inspection. Confirm the process and price the extra op.`, rule: 'Tolerances ≤ ±0.025mm or Ra ≤ 0.8 may need grinding' });
  }

  // 8) Cross features → second op / live tooling.
  if (input.crossFeatures) {
    findings.push({ id: 'cross-features', severity: 'info', title: `Off-axis features require a second op / live tooling`, detail: `Cross-holes, flats or keyways can't be produced in a single turning cycle. On a turn-mill they run with driven tools; otherwise a second op is needed. Each one is measured off the solid and priced as driven-tool work — spindle orient, tool in, cut, retract — and appears in the breakdown as "Off-axis features".`, rule: 'Off-axis features = live tooling or 2nd op' });
  } else if (input.setups >= MANY_SETUPS) {
    findings.push({ id: 'setups', severity: 'info', title: `${input.setups} setups required`, detail: `Features at both ends mean a turn-around (second op), adding setup time and a tolerance stack between setups.`, rule: 'Fewer setups = lower cost & tighter stack-up' });
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
