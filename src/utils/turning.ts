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
import { crossFeaturesSec, drillHoleSec, tapThreadsSec, DEFAULT_CROSS_CONFIG, DEFAULT_DRILL_CONFIG } from './drilling';
import type { ThreadSpec } from './drilling';

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
  /**
   * TAPPED threads, as callouts. Separate from `threadCount` above, which is
   * single-point threading on the lathe — an external thread cut with a
   * threading tool. These are internal, cut with a tap, and they are the ones
   * that appear on every drawing in the calibration set and cost nothing until
   * now. See drilling.ts for why the two cannot share a time model.
   */
  threads?: ThreadSpec[];
  /** Round bar the part is cut from (mm) — sets how much there is to rough off. */
  barDiameterMm?: number;
  /**
   * How many distinct turned diameters the profile presents.
   *
   * A finish pass is per DIAMETER, not per part: each step is its own approach,
   * its own shoulder and its own chamfer. Without this a three-diameter stepped
   * register cost exactly what a plain shaft of the same length cost.
   */
  turnedStepCount?: number;
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
  /** Stock left on each end face for the facing cut (mm) — this is what facing removes. */
  facingAllowanceMm: number;
  /** Non-cutting time each lathe operation owes. See TurningOpOverhead. */
  opOverhead?: TurningOpOverhead;
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
  /** Tapping — internal threads, feed locked to the pitch. */
  tapSec: number;
  /** Non-cutting: tool changes + rapids between cuts. */
  airSec: number;
  /** Sum of all cutting operations (excludes air). */
  cuttingSec: number;
  /** Distinct tools/operations engaged (drives tool-change count). */
  toolCount: number;
}

/**
 * WHAT A TURNING OPERATION COSTS BEFORE IT CUTS ANYTHING.
 *
 * Every turning op here used to be timed as a single ideal pass: the tool
 * appeared at the start of the cut, moved at feed, and vanished. Facing a 36 mm
 * bar came out at 2.9 s, boring at 1.4 s, drilling at 1.7 s — numbers no
 * machinist would recognise, and the reason a quoter looking at the breakdown
 * could not believe any of it.
 *
 * Drilling and off-axis work were already modelled properly (see drilling.ts:
 * positioning travel, clearance feed, settle, index). Only the LATHE ops were
 * not, which is why they are the ones that read as one second.
 *
 * These are ordinary shop figures for a CNC lathe, not values fitted to anything.
 */
export interface TurningOpOverhead {
  /** Turret index to bring the tool round. */
  indexSec: number;
  /** Rapid from the index position to the approach point, and back off at the end. */
  rapidTravelMm: number;
  rapidMmPerMin: number;
  /** The last few mm before metal, taken at feed rather than rapid. */
  clearanceMm: number;
  /** Spindle speed change + settle before the cut starts. */
  settleSec: number;
}

export const DEFAULT_OP_OVERHEAD: TurningOpOverhead = {
  indexSec: 2,
  rapidTravelMm: 120,
  rapidMmPerMin: 10000,
  clearanceMm: 2,
  settleSec: 1.5,
};

/**
 * Non-cutting seconds owed by ONE turning operation, whatever it removes.
 *
 * Index, rapid in, settle, feed through the clearance gap, then rapid clear at
 * the end. About 5 s on a normal lathe — which is why an operation that removes
 * almost nothing still cannot cost one second.
 */
export function opOverheadSec(
  feedMmPerMin: number,
  cfg: TurningOpOverhead = DEFAULT_OP_OVERHEAD
): number {
  const rapidSec = (cfg.rapidTravelMm / Math.max(1, cfg.rapidMmPerMin)) * 60;
  const clearanceSec = (cfg.clearanceMm / Math.max(1, feedMmPerMin)) * 60;
  return cfg.indexSec + rapidSec + cfg.settleSec + clearanceSec;
}

export const DEFAULT_TURNING_CONFIG: TurningConfig = {
  maxRpm: 6000,
  toolChangeSec: 3,
  roughFraction: 0.9,
  maxDrillDiaMm: 20,
  facingAllowanceMm: 2,
  opOverhead: DEFAULT_OP_OVERHEAD,
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
  // Settings are persisted, and a blob saved before a field existed comes back
  // without it. Every figure this function divides or rounds by is defaulted
  // here, because the failure mode otherwise is not a slightly wrong number —
  // it is NaN propagating silently all the way to a quoted price.
  const num = (v: number | undefined, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
  const faceAllowMm = num(cfg.facingAllowanceMm, DEFAULT_TURNING_CONFIG.facingAllowanceMm);
  const overhead = cfg.opOverhead ?? DEFAULT_OP_OVERHEAD;

  // Facing — spiral from OD to centre on each end face (rpm taken at a mid radius).
  //
  // A face is not one pass. There is facing allowance on the bar to take off,
  // which comes away in roughing depths of cut, and then a finish pass for the
  // surface the drawing asks for. Timing it as a single finish pass is what made
  // facing a ⌀36 bar come out at 2.9 s.
  const faceRpm = rpm(m.cuttingSpeedFinish, od * 0.5, cfg.maxRpm);
  const faceRoughFeed = m.feedRough * faceRpm;
  const faceFinishFeed = m.feedFinish * faceRpm;
  const facePassSec = (feed: number) => min((od / 2) / Math.max(1, feed));
  const faceRoughPasses = Math.max(0, Math.ceil(faceAllowMm / Math.max(0.1, m.depthOfCutRough)) - 1);
  const facingSec = profile.faceCount > 0
    ? profile.faceCount * (
        faceRoughPasses * facePassSec(faceRoughFeed)
        + facePassSec(faceFinishFeed)
        + opOverheadSec(faceFinishFeed, overhead)
      )
    : 0;

  // Roughing — remove the bulk at the roughing MRR.
  const mrr = roughingMrrCm3PerMin(m);
  const roughRpm = rpm(m.cuttingSpeedRough, od, cfg.maxRpm);
  const roughFeedMmPerMin = Math.max(1, m.feedRough * roughRpm);
  // Roughing is a SEQUENCE of passes, and between each one the tool retracts and
  // rapids back to start. Volume ÷ MRR times the metal-cutting part correctly and
  // then gives the return strokes away — on a part roughed in twelve passes that
  // is most of a minute nobody was charging for.
  const roughPasses = Math.max(1, Math.ceil(
    (num(profile.barDiameterMm, od + 2 * faceAllowMm) - od) / 2 / Math.max(0.1, m.depthOfCutRough)
  ));
  const roughReturnSec = removalVolCm3 > 0
    ? roughPasses * (overhead.rapidTravelMm
        / Math.max(1, overhead.rapidMmPerMin)) * 60
    : 0;
  const roughSec = removalVolCm3 > 0 && mrr > 0
    ? min((removalVolCm3 * cfg.roughFraction) / mrr) + roughReturnSec
      + opOverheadSec(roughFeedMmPerMin, overhead)
    : 0;

  // Finish turning — a pass along EACH turned diameter, not one pass over the
  // whole length. A stepped part presents a shoulder, a chamfer and a new
  // diameter at every step, and each is its own approach and its own pass; the
  // single-pass version charged a three-diameter part the same as a plain shaft.
  const finishRpm = rpm(m.cuttingSpeedFinish, od, cfg.maxRpm);
  const finishFeedMmPerMin = Math.max(1, m.feedFinish * finishRpm);
  const steps = Math.max(1, Math.round(profile.turnedStepCount ?? 1));
  const finishSec = min(profile.lengthMm / finishFeedMmPerMin)
    + steps * opOverheadSec(finishFeedMmPerMin, overhead);

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
    // A boring bar is a separate tool with its own approach down the bore, and
    // every roughing pass retracts the full depth before the next one.
    const boreFeed = Math.max(1, m.feedFinish * boreRpm);
    const borePassRetractSec = boreRoughSec > 0
      ? Math.ceil(radial / Math.max(0.3, m.depthOfCutRough * 0.6))
        * (depth / Math.max(1, overhead.rapidMmPerMin)) * 60
      : 0;
    boreSec = boreRoughSec + boreFinishSec + borePassRetractSec + opOverheadSec(boreFeed, overhead);
  }

  // Grooving — plunge a ~3 mm tool to ~10% of OD, per groove. EACH groove is its
  // own approach: position along Z, plunge, dwell to break the chip, retract.
  // Four grooves are four operations, not one operation four times as long.
  const grooveFeed = Math.max(1, 0.05 * rpm(m.cuttingSpeedFinish, od, cfg.maxRpm));
  const grooveSec = profile.grooveCount > 0
    ? profile.grooveCount * (min((od * 0.1) / grooveFeed) + opOverheadSec(grooveFeed, overhead))
    : 0;

  // Threading — multi-pass over the thread length, per threaded feature.
  const threadSec = profile.threadCount > 0
    ? profile.threadCount * (() => {
        const threadLen = Math.min(1.5 * od, profile.lengthMm * 0.3);
        const pitch = 1.5; // mm — typical; refined from the drawing callout later
        const passes = 6;
        const threadFeed = Math.max(1, pitch * rpm(m.cuttingSpeedFinish, od, cfg.maxRpm));
        // Every threading pass retracts to clear and rapids back to the start.
        const retractSec = passes * (overhead.rapidTravelMm
          / Math.max(1, overhead.rapidMmPerMin)) * 60;
        return min((passes * threadLen) / threadFeed) + retractSec
          + opOverheadSec(threadFeed, overhead);
      })()
    : 0;

  // Part-off — plunge to centre at a reduced speed.
  const partRpm = rpm(m.cuttingSpeedFinish * 0.6, od, cfg.maxRpm);
  const partFeed = Math.max(1, 0.08 * partRpm);
  const partingSec = min((od / 2) / partFeed) + opOverheadSec(partFeed, overhead);

  // Off-axis work: cross holes, flats, keyways. This used to be a boolean the
  // time model never read, so a cross-drilled part cost exactly what a plain one
  // did. See crossFeaturesSec for what each of these actually involves.
  const crossSec = crossFeaturesSec(profile.crossFeatureList, m, {
    ...DEFAULT_CROSS_CONFIG,
    maxRpm: cfg.maxRpm,
    maxDrillDiaMm: cfg.maxDrillDiaMm,
  });

  // Tapping. A thread is the one operation with no geometric signature — the
  // solid holds only the tap drill — so these arrive as callouts, measured or
  // proposed, never inferred from a face.
  const tapSec = tapThreadsSec(profile.threads, m);

  const cuttingSec =
    facingSec + roughSec + finishSec + drillSec + boreSec + grooveSec + threadSec + partingSec
    + crossSec + tapSec;

  const toolCount = [facingSec, roughSec, finishSec, drillSec, boreSec, grooveSec, threadSec, partingSec, crossSec, tapSec]
    .filter((t) => t > 0).length;

  // Non-cutting: a tool change per distinct tool + ~5% rapids between cuts.
  const airSec = toolCount * cfg.toolChangeSec + cuttingSec * 0.05;

  return { facingSec, roughSec, finishSec, drillSec, boreSec, grooveSec, threadSec, partingSec, crossSec, tapSec, airSec, cuttingSec, toolCount };
}
