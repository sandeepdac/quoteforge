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
import type { ShopTool, TurningToolAssembly } from '../types';
import { countToolSelections, resolveTurningTool, TURNING_SEQUENCE, type ToolAssignment, type EstimatedTurningOp } from './turningTools';

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
  /**
   * Surface finish the drawing asks for, Ra in micrometres.
   *
   * This is a CYCLE-TIME driver, not a note. The finishing feed a tool can take
   * is fixed by the finish it has to leave (see finishFeedForRaMmPerRev), so a
   * sealing face at Ra 0.4 is turned at a third of the feed of a plain Ra 3.2
   * surface with the same insert. Lance's VOC housing calls out
   * "Ra 0.4 sealing faces - free from scratches and chatter marks" and we were
   * costing it as an ordinary turned diameter.
   */
  surfaceFinishRaUm?: number;
  /**
   * Round bar the part is cut from (mm). Sets how much there is to rough off,
   * and so how many passes roughing takes — which is what decides its return
   * strokes. Absent on older payloads; the facing allowance then stands in.
   */
  barDiameterMm?: number;
}

export interface TurningConfig {
  toolLibrary?: ShopTool[];
  toolAssemblies?: TurningToolAssembly[];
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
  /** Stock left on each end face for the facing cut (mm) — what facing removes. */
  facingAllowanceMm?: number;
  /** Non-cutting time each operation occurrence owes. See OpApproach. */
  opApproach?: OpApproach;
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
  /** Distinct assemblies (unassigned operation groups are provisional tools). */
  toolCount: number;
  operationCount: number;
  toolChangeCount: number;
  rapidSec: number;
  toolAssignments: ToolAssignment[];
}

/** Ra (um) an ordinary turned surface gets with no special measures. */
export const DEFAULT_TURNED_RA_UM = 3.2;
/** At or below this Ra a single pass will not hold it: a spring pass follows. */
export const SPRING_PASS_RA_UM = 0.8;

/**
 * THE FEED A FINISH ALLOWS — the equation that ties a TOOL to a cycle time.
 *
 * Theoretical roughness left by a round-nosed turning tool:
 *
 *     Ra ~ fn^2 / (32 * r)        (Ra and fn in mm, r = nose radius in mm)
 *  => fn = sqrt(32 * r * Ra)
 *
 * Two consequences the model was blind to, both of them large:
 *
 *   A SMALLER NOSE RADIUS IS SLOWER. A 0.4 mm finishing insert must feed at
 *   0.7x the rate of an 0.8 mm one to leave the same finish. The tool library
 *   records the radius per operation and it reached nothing but a tool-change
 *   count, so the two cut identically.
 *
 *   A FINER FINISH IS SLOWER, steeply, because the relation is a square root:
 *   Ra 3.2 allows 0.29 mm/rev on an 0.8 insert, Ra 0.4 allows 0.10.
 *
 * Handbook relation, not a fitted constant. Real inserts with wiper geometry
 * beat it, which is why this is applied as a CAP on the material's feed rather
 * than as the feed itself: it can only slow a cut down, never speed one up.
 */
export function finishFeedForRaMmPerRev(noseRadiusMm: number, raUm: number): number {
  const r = Math.max(0.05, noseRadiusMm);
  const raMm = Math.max(0.05, raUm) / 1000;
  return Math.sqrt(32 * r * raMm);
}

/**
 * How much a boring bar has to be slowed for its overhang.
 *
 * A bar cutting four diameters deep is at the edge of chatter; past that, feed
 * and depth come off fast. Standard shop practice for a steel bar, expressed as
 * a multiplier on feed. The deep-bore parts in the calibration set are exactly
 * where the model reads fastest, and this is one reason why.
 */
export function boringOverhangDerate(lengthOverDiameter: number): number {
  if (lengthOverDiameter <= 3) return 1;
  if (lengthOverDiameter <= 4) return 0.8;
  if (lengthOverDiameter <= 6) return 0.6;
  if (lengthOverDiameter <= 8) return 0.4;
  return 0.25;
}

/**
 * WHAT AN OPERATION COSTS BEFORE AND AFTER IT CUTS.
 *
 * Every lathe operation here was timed as a single ideal cut: the tool was
 * already at the metal, made one pass, and vanished. That is why facing two ends
 * of a ⌀36 bar came out at 1.0 s, boring a ⌀11.8 x 14 hole at 0.7 s, and four
 * grooves at 0.8 s each — numbers no machinist would sign.
 *
 * NOT THE TOOL CHANGE. The turret index is already charged once per CHANGE
 * (`toolChangeCount * toolChangeSec`). This is the part nobody was charging: for
 * EVERY operation, including two in a row on the same tool, the slide still has
 * to travel to the start point, the spindle still has to reach and hold speed,
 * the tool still feeds through a clearance gap before it touches metal, and it
 * still retracts clear at the end.
 *
 * Ordinary CNC lathe figures, and each is separately arguable:
 *   rapid   a slide moves at 10-24 m/min; 120 mm of positioning is typical on a
 *           small part, in and out again.
 *   settle  a spindle changing speed between operations needs a second or two
 *           before the cut is stable.
 *   clearance the last 2 mm before metal are taken at FEED, not rapid, so this
 *           term is larger exactly when the feed is fine — which is correct.
 */
export interface OpApproach {
  /** Positioning move to the start point and clear again (mm, total). */
  rapidTravelMm: number;
  rapidMmPerMin: number;
  /** Spindle speed change and stabilise. */
  settleSec: number;
  /** Gap above the metal taken at feed rather than rapid. */
  clearanceMm: number;
}

export const DEFAULT_OP_APPROACH: OpApproach = {
  rapidTravelMm: 120,
  rapidMmPerMin: 10000,
  settleSec: 1.5,
  clearanceMm: 2,
};

/**
 * Non-cutting seconds owed by ONE operation occurrence — per face, per groove,
 * per bore, not per part and not per tool. Around 3 s on a normal lathe, which
 * is why an operation removing almost nothing still cannot cost half a second.
 */
export function opApproachSec(feedMmPerMin: number, cfg: OpApproach = DEFAULT_OP_APPROACH): number {
  const rapidSec = (cfg.rapidTravelMm / Math.max(1, cfg.rapidMmPerMin)) * 60;
  const clearanceSec = (cfg.clearanceMm / Math.max(0.001, feedMmPerMin)) * 60;
  return rapidSec + cfg.settleSec + clearanceSec;
}

export const DEFAULT_TURNING_CONFIG: TurningConfig = {
  maxRpm: 6000,
  // Editable provisional allowance, not a verified machine specification.
  toolChangeSec: 8,
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
  const num = (v: number | undefined, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;

  // TOOLS ARE RESOLVED BEFORE ANYTHING IS TIMED.
  //
  // They used to be resolved at the end, purely to count tool changes, which is
  // why the library's nose radii and insert geometry reached no cutting time at
  // all: an 0.4 mm finishing insert and an 0.8 mm rougher produced identical
  // seconds. What a tool can take is an INPUT to the cut, not a label on it.
  const toolFor = (op: EstimatedTurningOp) =>
    resolveTurningTool(op, cfg.toolLibrary ?? [], cfg.toolAssemblies);
  const noseRadiusFor = (op: EstimatedTurningOp, fallback: number) => {
    const r = toolFor(op).noseRadiusMm;
    return typeof r === 'number' && Number.isFinite(r) && r > 0 ? r : fallback;
  };

  // The finish the drawing asks for, and the feed it allows on each tool. This
  // can only ever SLOW a cut: a tool that could feed faster still has to leave
  // the surface the drawing wants.
  const raUm = Number.isFinite(profile.surfaceFinishRaUm) && (profile.surfaceFinishRaUm ?? 0) > 0
    ? (profile.surfaceFinishRaUm as number)
    : DEFAULT_TURNED_RA_UM;
  // FEED IS A PROPERTY OF THE TOOL AND THE FINISH, NOT OF THE MATERIAL.
  //
  // The material table carries feedFinish 0.10 mm/rev for fourteen of its
  // sixteen materials and 0.08 for the other two — a flat placeholder rather
  // than material data, and already below what an ordinary Ra 3.2 surface
  // allows. Capping the physics with it meant the tool's nose radius and the
  // drawing's finish callout could never move a cycle time at all.
  //
  // The honest split is the textbook one: the MATERIAL sets surface speed (Vc,
  // and so rpm, where the table really does vary 100-250 m/min); the TOOL and
  // the required finish set feed per rev. Both still price the cut.
  const feedForFinish = (op: EstimatedTurningOp, _materialFeed: number, fallbackRadius: number) =>
    finishFeedForRaMmPerRev(noseRadiusFor(op, fallbackRadius), raUm);
  // Below ~Ra 0.8 a single pass does not hold the finish — it is followed by a
  // spring pass at the same feed with no depth of cut.
  const finishPasses = raUm <= SPRING_PASS_RA_UM ? 2 : 1;

  // Non-cutting seconds owed by one operation occurrence. NOT the turret index —
  // that is charged separately, once per actual tool change.
  const approach = (feedMmPerMin: number) => opApproachSec(feedMmPerMin, cfg.opApproach);
  const faceAllowMm = Number.isFinite(cfg.facingAllowanceMm) && (cfg.facingAllowanceMm ?? 0) > 0
    ? (cfg.facingAllowanceMm as number) : 2;

  // Facing — spiral from OD to centre on each end face (rpm taken at a mid radius).
  const faceRpm = rpm(m.cuttingSpeedFinish, od * 0.5, cfg.maxRpm);
  // A SEALING FACE is the surface most often carrying the fine Ra callout, and
  // the facing tool's own nose radius decides what feed that allows.
  const faceFeed = feedForFinish('face', m.feedFinish, 0.8);
  // A face is not one pass. There is facing allowance on the bar to take off,
  // which comes away at roughing depth of cut, and then the finish pass(es) that
  // leave the surface the drawing asks for. Each face is its own approach.
  const faceRoughFeedMmPerMin = Math.max(0.001, m.feedRough * faceRpm);
  const faceFinishFeedMmPerMin = Math.max(0.001, faceFeed * faceRpm);
  const faceRoughPasses = Math.max(0, Math.ceil(faceAllowMm / Math.max(0.1, m.depthOfCutRough)) - 1);
  const facingSec = profile.faceCount > 0
    ? profile.faceCount * (
        faceRoughPasses * min((od / 2) / faceRoughFeedMmPerMin)
        + finishPasses * min((od / 2) / faceFinishFeedMmPerMin)
        + approach(faceFinishFeedMmPerMin)
      )
    : 0;

  // Roughing — remove the bulk at the roughing MRR.
  const mrr = roughingMrrCm3PerMin(m);
  // Roughing is a SEQUENCE of passes. Volume ÷ MRR times the metal being cut and
  // then gives away every return stroke: after each pass the tool retracts and
  // rapids back to start. On a part roughed in a dozen passes that is most of a
  // minute nobody was charging.
  const roughRpm = rpm(m.cuttingSpeedRough, od, cfg.maxRpm);
  const roughFeedMmPerMin = Math.max(0.001, m.feedRough * roughRpm);
  const radialStockMm = Math.max(0, (num(profile.barDiameterMm, od + 2 * faceAllowMm) - od) / 2);
  const roughPasses = Math.max(1, Math.ceil(radialStockMm / Math.max(0.1, m.depthOfCutRough)));
  const roughReturnSec = roughPasses
    * ((cfg.opApproach ?? DEFAULT_OP_APPROACH).rapidTravelMm
       / Math.max(1, (cfg.opApproach ?? DEFAULT_OP_APPROACH).rapidMmPerMin)) * 60;
  const roughSec = removalVolCm3 > 0 && mrr > 0
    ? min((removalVolCm3 * cfg.roughFraction) / mrr) + roughReturnSec + approach(roughFeedMmPerMin)
    : 0;

  // Finish turning — one pass along the OD, at the feed the FINISHING INSERT can
  // take for the finish the drawing asks for.
  const finishRpm = rpm(m.cuttingSpeedFinish, od, cfg.maxRpm);
  const finishFeed = feedForFinish('finish', m.feedFinish, 0.4);
  const finishFeedMmPerMin = Math.max(0.001, finishFeed * finishRpm);
  const finishSec = finishPasses * min(profile.lengthMm / finishFeedMmPerMin)
    + approach(finishFeedMmPerMin);

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
    // OVERHANG. A boring bar reaching four diameters into a hole is at the edge
    // of chatter, and past that feed and depth come off fast. The model ran every
    // bore at full feed however deep it was, which is one reason the deep-bore
    // parts are the ones it reads fastest on.
    const overhang = boringOverhangDerate(depth / Math.max(0.1, profile.boreDiaMm));
    let boreRoughSec = 0;
    if (radial > 0.1) {
      const ap = Math.max(0.3, m.depthOfCutRough * 0.6 * overhang); // internal cuts run lighter
      const boringPasses = Math.ceil(radial / ap);
      boreRoughSec = boringPasses * min(depth / Math.max(0.001, m.feedRough * overhang * boreRpm));
    }
    const boreFeed = feedForFinish('bore', m.feedFinish, 0.4) * overhang;
    const boreFeedMmPerMin = Math.max(0.001, boreFeed * boreRpm);
    const boreFinishSec = finishPasses * min(depth / boreFeedMmPerMin);
    // The bar travels the full depth back out of the hole between passes, and
    // the whole operation still has to reach the bore face to begin with.
    const borePassRetractSec = boreRoughSec > 0
      ? Math.ceil(radial / Math.max(0.3, m.depthOfCutRough * 0.6 * overhang))
        * (depth / Math.max(1, (cfg.opApproach ?? DEFAULT_OP_APPROACH).rapidMmPerMin)) * 60
      : 0;
    boreSec = boreRoughSec + boreFinishSec + borePassRetractSec + approach(boreFeedMmPerMin);
  }

  // Grooving — plunge a ~3 mm tool to ~10% of OD, per groove.
  // EACH groove is its own operation: position along Z, plunge, dwell to break
  // the chip, retract. Four grooves are four approaches, not one.
  const grooveFeedMmPerMin = Math.max(0.001, 0.05 * rpm(m.cuttingSpeedFinish, od, cfg.maxRpm));
  const grooveSec = profile.grooveCount > 0
    ? profile.grooveCount * (min((od * 0.1) / grooveFeedMmPerMin) + approach(grooveFeedMmPerMin))
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
  const partFeedMmPerMin = Math.max(0.001, 0.08 * partRpm);
  const partingSec = min((od / 2) / partFeedMmPerMin) + approach(partFeedMmPerMin);

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

  const times = { face: facingSec, rough: roughSec, finish: finishSec, drill: drillSec,
    bore: boreSec, groove: grooveSec, thread: threadSec, partoff: partingSec, cross: crossSec, tap: tapSec };
  const toolAssignments = TURNING_SEQUENCE.filter(op => times[op] > 0).map(toolFor);
  const { distinctTools: toolCount, selections: toolChangeCount } = countToolSelections(toolAssignments);
  const rapidSec = cuttingSec * 0.05;
  // Settings are PERSISTED. A blob saved before a field existed — or edited to
  // an empty string in the Settings form — comes back undefined, and the failure
  // mode here is not a slightly wrong number: NaN propagates silently out of
  // cycle time, through machineCost, and into a quoted price that renders as
  // "£NaN" or, worse, sums to nothing anyone notices. Default at the boundary.
  const toolChangeSec = Number.isFinite(cfg.toolChangeSec) && cfg.toolChangeSec > 0
    ? cfg.toolChangeSec
    : DEFAULT_TURNING_CONFIG.toolChangeSec;
  const airSec = toolChangeCount * toolChangeSec + rapidSec;

  return { facingSec, roughSec, finishSec, drillSec, boreSec, grooveSec, threadSec, partingSec, crossSec, tapSec,
    airSec, cuttingSec, toolCount, toolChangeCount, rapidSec, toolAssignments, operationCount: toolAssignments.length };
}
