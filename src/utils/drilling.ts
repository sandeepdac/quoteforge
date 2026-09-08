/**
 * DRILLING TIME — one hole at a time, from its own diameter and depth.
 *
 * Both estimators used to charge a flat ~12 seconds per hole, scaled by material
 * and by the smallest dimension of the stock. Two things were wrong with that,
 * and they compound:
 *
 *   1. DIAMETER did not appear at all. A ⌀0.65 drill and a ⌀20 drill cost the
 *      same. In reality a drill's feed rate is roughly proportional to its
 *      diameter — chip load scales with the tool, and below about 8 mm the
 *      spindle hits its rpm ceiling so there is nothing left to give back.
 *   2. DEPTH was assumed to be the thinnest wall of the billet, so every hole
 *      was a through hole. Lance's Cold Stage Block has a ⌀1.0 hole 32 mm deep
 *      (L/D of 32 — a gun-drilling job) that was being priced as 14 mm, and his
 *      VOC housing has two ⌀11 holes 125 mm deep priced as 29 mm.
 *
 * The depth now comes measured from the model. What follows is ordinary shop
 * arithmetic, not a fit to anything: rpm from surface speed capped by the
 * spindle, feed per rev proportional to diameter, and pecking once the hole is
 * deeper than a few diameters.
 *
 * WHAT THIS DELIBERATELY DOES NOT CLAIM. It is a cutting-time model. It does not
 * know that a machinist creeps a 0.65 mm drill in because snapping it scraps a
 * part that already has an hour in it. That caution is real and it is large, but
 * it is not drilling physics, so it does not belong in this file — see the
 * micro-feature discussion in calibration/candidates.ts.
 */
import type { MaterialProps } from './materials';

export interface HoleSpec {
  diameterMm: number;
  depthMm: number;
}

export interface DrillConfig {
  /** Spindle ceiling. A small drill wants more rpm than any machine will give. */
  maxRpm: number;
  /** Rapid traverse for peck retracts, mm/min. */
  rapidMmPerMin: number;
  /**
   * Rapid travel to get to one hole and back off it: index across the part, Z
   * down to clearance, Z clear at the end. About 90 mm on a small part.
   */
  positioningTravelMm: number;
  /** Gap above the face the drill FEEDS through before it touches metal. */
  clearanceMm: number;
  /** In-position settle / spindle dwell, seconds per hole. */
  settleSec: number;
}

export const DEFAULT_DRILL_CONFIG: DrillConfig = {
  maxRpm: 12000,
  rapidMmPerMin: 10000,
  positioningTravelMm: 90,
  clearanceMm: 2,
  settleSec: 0.3,
};

/**
 * Feed per revolution for a twist drill, mm/rev.
 *
 * Shop rule of thumb: about 1.5% of diameter in steel, less in gummy material.
 * The floor matters more than the slope — below ⌀1 the number is dominated by
 * how little the flute can carry, not by the book figure.
 */
export function drillFeedPerRev(diaMm: number, m: MaterialProps): number {
  const base = 0.015 * Math.max(0.1, diaMm);
  return Math.max(0.002, base * Math.min(1.5, Math.max(0.3, m.machinability)));
}

/**
 * Peck depth as a fraction of diameter. A shallow hole is drilled in one go; a
 * deep one is pecked, and the deeper it gets relative to its diameter the
 * shorter each peck has to be, because the flutes cannot clear the chips.
 */
export function peckDepthMm(diaMm: number, depthMm: number): number {
  const ld = depthMm / Math.max(0.05, diaMm);
  if (ld <= 3) return depthMm;            // one plunge, no pecking
  if (ld <= 8) return diaMm;              // conventional peck
  return 0.5 * diaMm;                     // deep hole: half-diameter bites
}

/** Seconds to drill ONE hole, cutting plus peck retracts plus approach. */
export function drillHoleSec(
  hole: HoleSpec,
  m: MaterialProps,
  cfg: DrillConfig = DEFAULT_DRILL_CONFIG
): number {
  const d = Math.max(0.05, hole.diameterMm);
  const L = Math.max(0.1, hole.depthMm);

  // rpm from surface speed, capped by the machine. Drills run slower than the
  // turning finish speed — a twist drill's corner is its weakest point.
  const vc = Math.max(10, m.cuttingSpeedRough * 0.5);
  const rpm = Math.min(cfg.maxRpm, (vc * 1000) / (Math.PI * d));
  const feedMmPerMin = Math.max(1, drillFeedPerRev(d, m) * rpm);

  const cutMin = L / feedMmPerMin;

  // Pecking: EVERY peck pulls the drill clear of the hole and drives it back
  // down, and the trip gets longer as the hole deepens. Peck j travels about
  // 2·j·peck, so the whole sequence is roughly L·(n+1) — not 2·L. On a ⌀10 hole
  // 125 mm deep that is 3.2 metres of rapid, and it is most of the operation.
  const peck = peckDepthMm(d, L);
  const pecks = Math.max(1, Math.ceil(L / peck));
  const peckTravelMm = pecks > 1 ? L * (pecks + 1) : 0;
  const peckMin = pecks > 1 ? peckTravelMm / cfg.rapidMmPerMin + pecks * 0.004 : 0;

  // Getting to the hole: rapid across and down, then FEED through the clearance
  // gap before the drill touches metal. That last part is not a rounding error
  // on a small tool — a ⌀0.65 drill creeping through 2 mm of air at 53 mm/min
  // takes longer than a ⌀8 drill takes to go right through the part.
  const positionMin = cfg.positioningTravelMm / cfg.rapidMmPerMin;
  const clearanceMin = cfg.clearanceMm / feedMmPerMin;

  return (cutMin + peckMin + positionMin + clearanceMin) * 60 + cfg.settleSec;
}

/** Seconds to drill a list of holes. */
export function drillHolesSec(
  holes: HoleSpec[],
  m: MaterialProps,
  cfg: DrillConfig = DEFAULT_DRILL_CONFIG
): number {
  return holes.reduce((sec, h) => sec + drillHoleSec(h, m, cfg), 0);
}

export interface CrossFeature {
  diameterMm: number;
  lengthMm: number;
  isBore?: boolean;
}

/**
 * OFF-AXIS ("cross") FEATURES — the work a live tool does while the spindle is
 * held at an angle, or that a second op does on a plain lathe.
 *
 * Three costs, and the first is the one the old model missed entirely by
 * charging zero: getting there. Every one of these features needs the spindle
 * oriented and locked and the driven tool brought in and taken out again, and
 * that is the same handful of seconds whether the feature is large or small.
 *
 * Then the cut itself. A feature narrow enough to drill IS drilled, at the same
 * feeds as any other hole. One too wide to drill has to be interpolated — the
 * end mill walks a helix round the bore — which is much slower per unit depth,
 * and is why a ⌀24 cross bore is not simply a big ⌀6 hole.
 */
export interface CrossFeatureConfig extends DrillConfig {
  /** Spindle orient + lock, live tool in and out. Per feature. */
  indexSec: number;
  /** Largest cross feature that can be drilled from solid. Wider is milled. */
  maxDrillDiaMm: number;
  /** Feed of the interpolating end mill, mm/min. */
  interpolateFeedMmPerMin: number;
}

export const DEFAULT_CROSS_CONFIG: CrossFeatureConfig = {
  ...DEFAULT_DRILL_CONFIG,
  indexSec: 8,
  maxDrillDiaMm: 20,
  interpolateFeedMmPerMin: 600,
};

/** Seconds for ONE off-axis feature: index to it, then cut it. */
export function crossFeatureSec(
  f: CrossFeature,
  m: MaterialProps,
  cfg: CrossFeatureConfig = DEFAULT_CROSS_CONFIG
): number {
  const d = Math.max(0.05, f.diameterMm);
  const L = Math.max(0.1, f.lengthMm);

  if (d <= cfg.maxDrillDiaMm) {
    return cfg.indexSec + drillHoleSec({ diameterMm: d, depthMm: L }, m, cfg);
  }

  // Too wide to drill: pilot it, then helix the rest out with an end mill. The
  // cutter walks one lap per axial step, so path length grows with both the
  // circumference and the depth.
  const pilot = drillHoleSec({ diameterMm: cfg.maxDrillDiaMm, depthMm: L }, m, cfg);
  const toolDia = Math.max(3, Math.min(10, d / 3));
  const stepMm = Math.max(0.2, 0.25 * toolDia);
  const laps = Math.max(1, Math.ceil(L / stepMm));
  const pathMm = laps * Math.PI * Math.max(1, d - toolDia);
  const feed = cfg.interpolateFeedMmPerMin * Math.min(1.5, Math.max(0.3, m.machinability));
  return cfg.indexSec + pilot + (pathMm / feed) * 60;
}

/** Seconds for a list of off-axis features. */
export function crossFeaturesSec(
  features: CrossFeature[] | undefined,
  m: MaterialProps,
  cfg: CrossFeatureConfig = DEFAULT_CROSS_CONFIG
): number {
  if (!features?.length) return 0;
  return features.reduce((sec, f) => sec + crossFeatureSec(f, m, cfg), 0);
}

/**
 * Pair diameters with depths, falling back to a through-hole when the geometry
 * service has not supplied depths (older payloads, or a hole whose axial extent
 * could not be read).
 */
export function pairHoles(
  diametersMm: number[] | undefined,
  depthsMm: number[] | undefined,
  fallbackDepthMm: number
): HoleSpec[] {
  if (!diametersMm?.length) return [];
  return diametersMm.map((diameterMm, i) => ({
    diameterMm,
    depthMm: depthsMm?.[i] && depthsMm[i] > 0 ? depthsMm[i] : fallbackDepthMm,
  }));
}

// --- Threads ---------------------------------------------------------------

export interface ThreadSpec {
  /** As the drawing writes it: 'M6', 'M0.9x0.225', 'G1/4'. */
  callout: string;
  /** Pitch in mm. Tapping feed is not a choice — it is one pitch per rev. */
  pitchMm: number;
  /** Tap drill ⌀ — what the solid actually contains. */
  tapDrillMm: number;
  /** Threaded depth. Falls back to the hole depth when the drawing is silent. */
  depthMm: number;
  count?: number;
}

export interface TapConfig {
  /**
   * Surface speed for tapping, m/min. Far below drilling: a tap is cutting on
   * its whole flank and cannot be hurried.
   */
  vcMPerMin: number;
  /** Reversing out is faster than going in, but not free. */
  retractSpeedFactor: number;
  /**
   * Orient the spindle, approach, synchronise, reverse at depth, retract clear.
   * A rigid-tapping cycle pays this whatever the size of the tap.
   */
  cycleOverheadSec: number;
}

export const DEFAULT_TAP_CONFIG: TapConfig = {
  vcMPerMin: 8,
  retractSpeedFactor: 1.5,
  cycleOverheadSec: 4,
};

/**
 * How much a machinist backs off for a small tap.
 *
 * This is a JUDGEMENT, not physics, and it is the one number in this file that
 * is not derived. A ⌀6 tap that binds costs a tap; a ⌀0.9 tap that binds costs
 * the part, and the part may already have an hour in it. Shops respond by
 * running small taps far below book speed, often pecking, sometimes by hand.
 *
 * The shape is deliberately conservative — full speed at ⌀6 and above, halving
 * by ⌀2, a fifth at ⌀0.9 — and it is stated here rather than buried so a
 * machinist can disagree with a number rather than with a black box. It is NOT
 * fitted to Lance's quotes; there is not enough evidence to fit it, and
 * pretending otherwise would make it unfalsifiable.
 */
export function tapSpeedDerate(tapDrillMm: number): number {
  if (tapDrillMm >= 5) return 1;
  if (tapDrillMm >= 2.5) return 0.7;
  if (tapDrillMm >= 1.6) return 0.5;
  if (tapDrillMm >= 1.0) return 0.35;
  return 0.2;
}

/** Seconds to cut ONE thread. */
export function tapThreadSec(
  t: ThreadSpec,
  m: MaterialProps,
  cfg: TapConfig = DEFAULT_TAP_CONFIG
): number {
  const d = Math.max(0.1, t.tapDrillMm);
  const pitch = Math.max(0.05, t.pitchMm);
  const depth = Math.max(0.2, t.depthMm);

  // rpm from surface speed, backed off for a small tap and for a material that
  // does not want to be tapped.
  const vc = cfg.vcMPerMin * tapSpeedDerate(d) * Math.min(1.4, Math.max(0.4, m.machinability));
  const rpm = Math.max(20, (vc * 1000) / (Math.PI * d));

  // The feed is the pitch. There is no chip-load choice to make here — the tap
  // advances exactly one pitch per revolution or it strips the thread.
  const feedMmPerMin = pitch * rpm;
  const inMin = depth / feedMmPerMin;
  const outMin = inMin / Math.max(1, cfg.retractSpeedFactor);

  return (inMin + outMin) * 60 + cfg.cycleOverheadSec;
}

/** Seconds for a list of threads, honouring each entry's count. */
export function tapThreadsSec(
  threads: ThreadSpec[] | undefined,
  m: MaterialProps,
  cfg: TapConfig = DEFAULT_TAP_CONFIG
): number {
  if (!threads?.length) return 0;
  return threads.reduce((sec, t) => sec + Math.max(1, t.count ?? 1) * tapThreadSec(t, m, cfg), 0);
}

/**
 * THE THREADS A QUOTER CAN TYPE IN.
 *
 * Detection gets internal threads right — a tapped hole is modelled at its
 * tap-drill ⌀, which is an odd size nothing else lands on. It cannot get
 * EXTERNAL ones at all, and that is not a tolerance that can be tightened: a
 * thread's major diameter is exactly the round number a plain shaft uses.
 * Lance's guide rod is the proof — its ⌀6 f7 ground body and an M6 thread are
 * the same number to four decimal places, so a detector would charge the shop
 * for tapping its own bearing surface.
 *
 * So this table exists to be chosen from rather than inferred. It is the same
 * data the geometry service matches against, kept here because the browser
 * cannot reach into Python, and it must stay in step with `TAP_TABLE_MM`.
 */
export const THREAD_CATALOG: Record<string, { pitchMm: number; tapDrillMm: number; majorMm: number }> = {
  'M1.6': { pitchMm: 0.35, tapDrillMm: 1.25, majorMm: 1.6 },
  'M2': { pitchMm: 0.4, tapDrillMm: 1.6, majorMm: 2 },
  'M2.5': { pitchMm: 0.45, tapDrillMm: 2.05, majorMm: 2.5 },
  'M3': { pitchMm: 0.5, tapDrillMm: 2.5, majorMm: 3 },
  'M4': { pitchMm: 0.7, tapDrillMm: 3.3, majorMm: 4 },
  'M5': { pitchMm: 0.8, tapDrillMm: 4.2, majorMm: 5 },
  'M6': { pitchMm: 1.0, tapDrillMm: 5.0, majorMm: 6 },
  'M8': { pitchMm: 1.25, tapDrillMm: 6.8, majorMm: 8 },
  'M10': { pitchMm: 1.5, tapDrillMm: 8.5, majorMm: 10 },
  'M12': { pitchMm: 1.75, tapDrillMm: 10.2, majorMm: 12 },
  // Fine and sub-miniature.
  'M0.9x0.225': { pitchMm: 0.225, tapDrillMm: 0.675, majorMm: 0.9 },
  'M1.2x0.25': { pitchMm: 0.25, tapDrillMm: 0.95, majorMm: 1.2 },
  'M1.6x0.35': { pitchMm: 0.35, tapDrillMm: 1.25, majorMm: 1.6 },
  'M2x0.4': { pitchMm: 0.4, tapDrillMm: 1.6, majorMm: 2 },
  'M3x0.5': { pitchMm: 0.5, tapDrillMm: 2.5, majorMm: 3 },
  'M5x0.35': { pitchMm: 0.35, tapDrillMm: 4.65, majorMm: 5 },
  'M6x0.75': { pitchMm: 0.75, tapDrillMm: 5.25, majorMm: 6 },
  'M8x1': { pitchMm: 1.0, tapDrillMm: 7.0, majorMm: 8 },
  // Pipe threads — anything that seals.
  'G1/8': { pitchMm: 0.907, tapDrillMm: 8.8, majorMm: 9.728 },
  'G1/4': { pitchMm: 1.337, tapDrillMm: 11.8, majorMm: 13.157 },
  'G3/8': { pitchMm: 1.337, tapDrillMm: 15.25, majorMm: 16.662 },
  'G1/2': { pitchMm: 1.814, tapDrillMm: 19.0, majorMm: 20.955 },
  'Rc1/8': { pitchMm: 0.907, tapDrillMm: 8.4, majorMm: 9.728 },
  'Rc1/4': { pitchMm: 1.337, tapDrillMm: 11.2, majorMm: 13.157 },
};

/** Turn a catalog callout into something costable. */
export function threadFromCallout(
  callout: string,
  depthMm: number,
  count = 1
): ThreadSpec | null {
  const spec = THREAD_CATALOG[callout];
  if (!spec) return null;
  return {
    callout,
    pitchMm: spec.pitchMm,
    tapDrillMm: spec.tapDrillMm,
    // A thread with no depth given runs about twice its diameter — the usual
    // rule of engagement, and far better than pricing it at nothing.
    depthMm: depthMm > 0 ? depthMm : 2 * spec.majorMm,
    count: Math.max(1, count),
  };
}
