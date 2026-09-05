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
