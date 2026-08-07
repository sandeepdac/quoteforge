/**
 * Milling cutting-data primitives.
 *
 * Milling removes material fundamentally differently from turning: a turning
 * insert takes a continuous cut at Vc·fn·ap, whereas an end mill sweeps a
 * radial width (ae) at an axial depth (ap) while the table feeds at vf. Using
 * the turning MRR for milling over-states bulk removal by roughly an order of
 * magnitude, because it ignores the fact that a small end mill can only engage
 * a fraction of its diameter.
 *
 * Metric milling MRR (mm³/min) = ae · ap · vf
 *   vf (mm/min) = n · z · fz          feed rate
 *   n  (rpm)    = Vc·1000 / (π·D)     clamped by the machine's rpm ceiling
 *   ae (mm)     = radialFactor · D    radial width of cut
 *   ap (mm)     = axialFactor  · D    axial depth of cut
 *
 * The rpm clamp matters: aluminium's book Vc of 400 m/min on a 10 mm cutter
 * calls for ~12,700 rpm, so a 6,000 rpm envelope halves the achievable feed —
 * exactly the kind of real-world limit the old formula ignored.
 *
 * Defaults describe a general-purpose roughing end mill taking a moderate cut
 * (between light high-speed adaptive and heavy conventional). They are starting
 * points a shop tunes; the global efficiency factor corrects what's left.
 */
import type { MaterialProps } from './materials';

export interface MillingToolConfig {
  /** Roughing end-mill diameter (mm). */
  toolDiaMm: number;
  /** Number of flutes/teeth. */
  flutes: number;
  /** Radial width of cut as a fraction of tool ⌀ (ae/D). */
  radialFactor: number;
  /** Axial depth of cut as a fraction of tool ⌀ (ap/D). */
  axialFactor: number;
  /** Spindle rpm ceiling. */
  maxRpm: number;
}

export const DEFAULT_MILLING_TOOL: MillingToolConfig = {
  toolDiaMm: 10,
  flutes: 3,
  radialFactor: 0.35,
  axialFactor: 0.8,
  maxRpm: 12000,
};

/**
 * Roughing cutter diameter for a part of a given size (mm).
 *
 * Tool choice is the single biggest lever on milling MRR, and it is dictated by
 * the part: nobody roughs an 800 mm plate with a 10 mm end mill, and nobody fits
 * a 20 mm cutter into a small contoured part. Scaling with the SMALLEST overall
 * dimension (the tightest envelope the cutter has to live in), bounded by the
 * sizes shops actually keep for roughing, tracks both ends: a ~23 mm-thick part
 * lands on a 6 mm cutter, a 150 mm-thick plate on a 20 mm one.
 */
export function roughingToolDiaMm(minBboxDimMm: number): number {
  return Math.max(6, Math.min(20, minBboxDimMm / 4));
}

/** Spindle speed for a cutting speed Vc (m/min) at tool ⌀ D (mm), rpm — clamped. */
export function millingRpm(vcMPerMin: number, toolDiaMm: number, maxRpm: number): number {
  if (toolDiaMm <= 0) return maxRpm;
  return Math.min(maxRpm, (vcMPerMin * 1000) / (Math.PI * toolDiaMm));
}

/**
 * Roughing material-removal rate for MILLING (cm³/min) = ae·ap·vf.
 *
 * Sanity check: aluminium (Vc 400, fz 0.09) with a 10 mm 3-flute at 12,000 rpm
 * gives ae 3.5 × ap 8 × vf 3,240 ≈ 91 cm³/min flat out; on a 6,000 rpm machine
 * roughly half that. Real programs average well below the peak because of
 * ramping, repositioning and corner slow-downs — that residual gap is what the
 * shop efficiency factor absorbs.
 */
export function millingMrrCm3PerMin(
  m: MaterialProps,
  cfg: MillingToolConfig = DEFAULT_MILLING_TOOL
): number {
  const d = Math.max(0.5, cfg.toolDiaMm);
  const n = millingRpm(m.cuttingSpeedRough, d, cfg.maxRpm);
  const vf = n * Math.max(1, cfg.flutes) * Math.max(0.005, m.feedPerToothMm);
  const ae = Math.max(0.05, cfg.radialFactor) * d;
  const ap = Math.max(0.05, cfg.axialFactor) * d;
  return (ae * ap * vf) / 1000; // mm³/min → cm³/min
}

/**
 * Finishing surface rate (cm²/min) — how fast a finishing pass sweeps wall and
 * floor area. Area rate = swath · vf, where the swath is the width of surface
 * each pass covers.
 *
 * The swath differs sharply by surface: a WALL is finished at full flute depth,
 * so one pass covers many millimetres of height, whereas a FLOOR is finished at
 * a light radial stepover (~0.15·D). A real part mixes both, so an effective
 * blended swath of ~0.4·D represents a mixed wall/floor finish. (Treating
 * everything as a floor-style stepover under-states finishing badly.)
 *
 * Rate rises with FEED, not with cutting speed directly — the old linear-in-Vc
 * scaling handed fast-cutting materials an unrealistic finishing bonus.
 */
export function finishingRateCm2PerMin(
  m: MaterialProps,
  cfg: MillingToolConfig = DEFAULT_MILLING_TOOL
): number {
  const d = Math.max(0.5, cfg.toolDiaMm);
  const n = millingRpm(m.cuttingSpeedFinish, d, cfg.maxRpm);
  // Finishing runs a lighter chip than roughing.
  const vf = n * Math.max(1, cfg.flutes) * Math.max(0.005, m.feedPerToothMm * 0.6);
  const swath = 0.4 * d; // mm — blended wall (full-depth) + floor (stepover) finish
  return (swath * vf) / 100; // mm²/min → cm²/min
}
