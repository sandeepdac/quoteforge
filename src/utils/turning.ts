/**
 * Turning cycle-time primitives.
 *
 * Pure, deterministic time estimates for the operations that make up a turned
 * part, from the material's cutting data and a simple axial profile. All times
 * are THEORETICAL (book values) in seconds — the estimator applies the shop
 * efficiency factor and adds load/handling time on top.
 *
 * Formulae (Machinery's Handbook / Sandvik):
 *   rpm            = Vc·1000 / (π·D)
 *   MRR (cm³/min)  = Vc · fn · ap
 *   turning time   = length / (fn · rpm)
 * These are approximations — a real toolpath is more complex — but applied
 * consistently they give a repeatable number the efficiency factor can calibrate.
 */
import type { MaterialProps } from './materials';
import { crossFeaturesSec, drillHoleSec, DEFAULT_CROSS_CONFIG, DEFAULT_DRILL_CONFIG } from './drilling';

/** A turned part reduced to the drivers a cycle-time model needs. */
export interface TurningProfile {
  /** Largest outer diameter (mm). */
  odMm: number;
  /** Overall turned length along the axis (mm). */
  lengthMm: number;
  /** Central bore diameter (mm); 0 = solid. */
  boreDiaMm: number;
  /** Bore depth (mm). */
  boreDepthMm: number;
  /** Number of grooves (parting-tool recesses). */
  grooveCount: number;
  /** Number of threaded features (from the drawing callout). */
  threadCount: number;
  /** End faces to face off (1 or 2). */
  faceCount: number;
  /** Off-axis holes / flats / keyways present → needs live tooling / 2nd op. */
  crossFeatures: boolean;
  /**
   * The measured ⌀ of each off-axis feature, when the geometry service found
   * them. A boolean alone could not say WHAT the second op is for, so the plan
   * showed an empty "Setup 2" costing nothing and a real feature — a ⌀1 drill
   * breaking through the OD — looked like something the engine had missed.
   * Diameters alone cannot be costed — a feature's time depends on how far the
   * tool has to travel — so this list is now only used to NAME the second op.
   * `crossFeatureList` carries the length as well and is what gets priced.
   */
  crossFeatureDiametersMm?: number[];
  /**
   * Off-axis features as OPERATIONS, each with the depth a tool has to travel.
   *
   * These used to cost nothing at all. The clearest evidence that they should
   * not is a pair of Lance's own parts: a 416 stainless guide rod with no cross
   * features runs 1.5 min a part, and an acetal drive dog of the same size, in a
   * far easier material, with nothing but cross features to distinguish it, runs
   * 15 min. Whatever else is missing from this model, off-axis work is real and
   * it is not free.
   */
  crossFeatureList?: Array<{ diameterMm: number; lengthMm: number; isBore?: boolean }>;
}

export interface TurningConfig {
  /** Spindle rpm ceiling (rpm) — small bar work often runs into this. */
  maxRpm: number;
  /** Turret index / tool-change time (s each). */
  toolChangeSec: number;
  /** Fraction of removal done at roughing feed (rest is the finish skin). */
  roughFraction: number;
  /**
   * Largest hole that can be produced by drilling from solid (mm). A bore wider
   * than this is drilled to this pilot size, then opened out with a boring bar —
   * you cannot drill a 45 mm hole in one shot. Governs how big bores are timed.
   */
  maxDrillDiaMm: number;
}

export interface TurningTimes {
  facingSec: number;
  roughSec: number;
  finishSec: number;
  drillSec: number;
  boreSec: number;
  grooveSec: number;
  threadSec: number;
  partingSec: number;
  /** Off-axis (live-tool / second-op) work — see `crossFeatureList`. */
  crossSec: number;
  /** Non-cutting: tool changes + rapids between cuts. */
  airSec: number;
  /** Sum of all cutting operations (excludes air). */
  cuttingSec: number;
  /** Distinct tools/operations engaged (drives tool-change count). */
  toolCount: number;
}

export const DEFAULT_TURNING_CONFIG: TurningConfig = {
  maxRpm: 6000,
  toolChangeSec: 3,
  roughFraction: 0.9,
  maxDrillDiaMm: 20,
};

/** Spindle speed for a cutting speed Vc (m/min) at diameter D (mm), rpm — clamped. */
export function rpm(vcMPerMin: number, diaMm: number, maxRpm: number): number {
  if (diaMm <= 0) return maxRpm;
  const n = (vcMPerMin * 1000) / (Math.PI * diaMm);
  return Math.min(maxRpm, n);
}

/** Roughing material-removal rate (cm³/min) = Vc · fn · ap. */
export function roughingMrrCm3PerMin(m: MaterialProps): number {
  return m.cuttingSpeedRough * m.feedRough * m.depthOfCutRough;
}

/**
 * Estimate the per-operation cutting/air times for a turned profile.
 * @param removalVolCm3 stock volume minus finished-part volume (the chips).
 */
export function estimateTurningTimes(
  profile: TurningProfile,
  m: MaterialProps,
  removalVolCm3: number,
  cfg: TurningConfig = DEFAULT_TURNING_CONFIG
): TurningTimes {
  const od = Math.max(0.5, profile.odMm);
  const min = (v: number) => v * 60; // minutes → seconds

  // Facing — spiral from OD to centre on each end face (rpm taken at a mid radius).
  const faceRpm = rpm(m.cuttingSpeedFinish, od * 0.5, cfg.maxRpm);
  const facingSec = profile.faceCount > 0
    ? profile.faceCount * min((od / 2) / (m.feedFinish * faceRpm))
    : 0;

  // Roughing — remove the bulk at the roughing MRR.
  const mrr = roughingMrrCm3PerMin(m);
  const roughSec = removalVolCm3 > 0 && mrr > 0
    ? min((removalVolCm3 * cfg.roughFraction) / mrr)
    : 0;

  // Finish turning — one pass along the OD.
  const finishRpm = rpm(m.cuttingSpeedFinish, od, cfg.maxRpm);
  const finishSec = min(profile.lengthMm / (m.feedFinish * finishRpm));

  // Drilling + boring. A hole is drilled from solid only up to the max drill
  // size; anything larger is drilled to that pilot and then bored OUT to size
  // with a boring bar — you can't drill a 45 mm hole in one shot. Boring the
  // extra radius takes multiple roughing passes plus a finish pass, which is the
  // real cost driver on a big bore (the old model priced it as one finish pass).
  let drillSec = 0;
  let boreSec = 0;
  if (profile.boreDiaMm > 0 && profile.boreDepthMm > 0) {
    const depth = profile.boreDepthMm;
    const drillDia = Math.min(profile.boreDiaMm, cfg.maxDrillDiaMm);
    // Pilot / through drill to the drillable diameter, on the same arithmetic
    // the milling side uses (drilling.ts) so one hole does not cost two
    // different amounts depending on which estimator happens to see it.
    //
    // The old line here multiplied by a flat 1.4 whenever the hole was deeper
    // than three diameters, which is where Lance's VOC housing went wrong: its
    // two ⌀11 holes are 125 mm deep — an L/D of eleven — and the real cost is
    // the twenty-odd full retracts needed to clear the chips, not 40% on top of
    // a single plunge.
    drillSec = drillHoleSec({ diameterMm: drillDia, depthMm: depth }, m, {
      ...DEFAULT_DRILL_CONFIG,
      maxRpm: cfg.maxRpm,
    });

    // Boring: open from the drilled hole to the final bore. rpm taken at the
    // final diameter (conservative — the bar runs slower on a big bore).
    const boreRpm = rpm(m.cuttingSpeedFinish, profile.boreDiaMm, cfg.maxRpm);
    const radial = (profile.boreDiaMm - drillDia) / 2;
    let boreRoughSec = 0;
    if (radial > 0.1) {
      const ap = Math.max(0.3, m.depthOfCutRough * 0.6); // internal cuts run lighter
      const boringPasses = Math.ceil(radial / ap);
      boreRoughSec = boringPasses * min(depth / (m.feedRough * boreRpm));
    }
    const boreFinishSec = min(depth / (m.feedFinish * boreRpm));
    boreSec = boreRoughSec + boreFinishSec;
  }

  // Grooving — plunge a ~3 mm tool to ~10% of OD, per groove.
  const grooveSec = profile.grooveCount > 0
    ? profile.grooveCount * min((od * 0.1) / (0.05 * rpm(m.cuttingSpeedFinish, od, cfg.maxRpm)))
    : 0;

  // Threading — multi-pass over the thread length, per threaded feature.
  const threadSec = profile.threadCount > 0
    ? profile.threadCount * (() => {
        const threadLen = Math.min(1.5 * od, profile.lengthMm * 0.3);
        const pitch = 1.5; // mm — typical; refined from the drawing callout later
        const passes = 6;
        return min((passes * threadLen) / (pitch * rpm(m.cuttingSpeedFinish, od, cfg.maxRpm)));
      })()
    : 0;

  // Part-off — plunge to centre at a reduced speed.
  const partRpm = rpm(m.cuttingSpeedFinish * 0.6, od, cfg.maxRpm);
  const partingSec = min((od / 2) / (0.08 * partRpm));

  // Off-axis work: cross holes, flats, keyways. This used to be a boolean the
  // time model never read, so a cross-drilled part cost exactly what a plain one
  // did. See crossFeaturesSec for what each of these actually involves.
  const crossSec = crossFeaturesSec(profile.crossFeatureList, m, {
    ...DEFAULT_CROSS_CONFIG,
    maxRpm: cfg.maxRpm,
    maxDrillDiaMm: cfg.maxDrillDiaMm,
  });

  const cuttingSec =
    facingSec + roughSec + finishSec + drillSec + boreSec + grooveSec + threadSec + partingSec + crossSec;

  const toolCount = [facingSec, roughSec, finishSec, drillSec, boreSec, grooveSec, threadSec, partingSec, crossSec]
    .filter((t) => t > 0).length;

  // Non-cutting: a tool change per distinct tool + ~5% rapids between cuts.
  const airSec = toolCount * cfg.toolChangeSec + cuttingSec * 0.05;

  return { facingSec, roughSec, finishSec, drillSec, boreSec, grooveSec, threadSec, partingSec, crossSec, airSec, cuttingSec, toolCount };
}
