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
import { crossFeaturesSplit, drillHoleSplit, spotDrillSplit, tapThreadsSplit, standardDrillMm, boringStockMm, DEFAULT_CROSS_CONFIG, DEFAULT_DRILL_CONFIG, THREAD_CATALOG } from './drilling';
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
  /**
   * The BAR the part is cut from. Absent means round bar, sized from the OD.
   *
   * A polygon bar (hex, square, octagon) keeps its flats: they are never turned,
   * and its "OD" is the corners. The geometry service recognises one when the
   * flats it counts put their corners exactly at the measured OD.
   */
  stock?: { shape: 'round' } | { shape: 'polygon'; flats: number; acrossFlatsMm: number };
  /**
   * The diameters actually TURNED, each over its own axial run, in order along
   * the axis. A `boss` is open to an end, so an OD tool reaches it; a `recess`
   * has something larger on both sides and is cut with a grooving insert.
   * Absent (an older geometry service, a drawing-only quote) falls back to one
   * round OD over the whole length.
   */
  odRegions?: Array<{ diameterMm: number; zStartMm: number; zEndMm: number; lengthMm: number; kind: 'boss' | 'recess' }>;
  /**
   * The NARROW hole a stepped bore is drilled through at, and its full depth.
   *
   * When a narrower hole runs on from the main bore, the shop drills the narrow
   * one the whole way — through the mouth's position too — and bores the mouth
   * up from it. On the VOC housing that is ⌀10 for 70 mm: the "10mm HSS drill
   * (70mm deep)" on the shop's sheet. The narrow runs it covers are not in
   * `additionalBores`, so they are not drilled twice. Only reported where a
   * boring bar can open the step (a few mm on diameter).
   */
  pilotHole?: { diameterMm: number; depthMm: number };
  /** Number of SINGLE-POINT threaded features (screwcut, not tapped). */
  threadCount: number;
  /**
   * Pitch of those screwcut threads (mm), from the drawing callout.
   *
   * It sets both the feed (a thread's feed IS its pitch) and the number of
   * infeeds, so it sets the whole operation — which is why it cannot stay the
   * hardcoded 1.5 mm it was. Its own field rather than borrowed from `threads`
   * below: those are TAPPED holes, a different feature, and an M2 x 0.4 tapped
   * hole must not decide the pitch of an unrelated screwcut thread.
   *
   * Absent falls back to 1.5 mm, a common coarse pitch.
   */
  threadPitchMm?: number;
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
  /**
   * On-axis holes BEYOND the main bore, as the geometry found them.
   *
   * The profile carried exactly one bore, so a part with two coaxial holes was
   * timed for one. Lance's VOC housing is the case: ⌀11.8 x 14 at the mouth AND
   * ⌀10 through 70 mm, which his sheet drills in two operations — a carbide
   * pilot to 40 mm and an HSS drill the rest of the way — for 72 s the model
   * could not see, because the second hole was not in the profile at all.
   *
   * The geometry service has always reported both (holeDiametersMm [11.8, 10]);
   * only the turned profile threw the rest away.
   */
  additionalBores?: Array<{ diameterMm: number; depthMm: number }>;
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

/**
 * ONE OPERATION, THE WAY A CYCLE SHEET WRITES IT.
 *
 * Turncircuit's sheets have two columns per line — cutting and idle — and total
 * them separately at the foot. The model used to have neither: an operation's
 * approach, settle and clearance were ADDED INTO its cutting seconds, and the
 * turret indexes were swept into one "Tool selections" row at the bottom
 * alongside a flat 5%-of-cutting rapid allowance that was never measured.
 *
 * That made three things impossible at once. The breakdown could not be read
 * next to a sheet, because one column of ours covered two of theirs. The
 * Feedrate override scaled rapids and spindle settles as though they were cuts.
 * And a comparison could not tell a cutting error from an idle error — an
 * operation 30% fast on metal and 30% slow on air reads as exactly right.
 *
 * So each operation now carries both, and the totals are the sum of the rows.
 */
export interface TurningOpTime {
  op: EstimatedTurningOp;
  /** Seconds the tool spends removing metal. */
  cuttingSec: number;
  /**
   * Seconds it spends not removing metal, and why: the turret index that brings
   * the tool round (charged to the operation that CAUSES the change, and only
   * when the tool actually changes), positioning rapids, spindle settle, the
   * clearance gap fed through before contact, and every pass or peck retract.
   */
  idleSec: number;
}

export interface TurningTimes {
  /** Spot/centre drilling — the operation before the drill. */
  spotSec: number;
  /** Breaking the edges a cutter leaves — see deburrSec. */
  deburrSec: number;
  /**
   * The drill actually used (mm) — a stocked size UNDER the finished bore, not
   * the bore's own diameter. Carried so the plan can name the tool that runs,
   * rather than labelling a ⌀10.5 drill with the ⌀11.8 it is drilling toward.
   */
  drillDiaMm: number;
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
  /** Non-cutting: tool changes + approaches + retracts. Sum of opTimes idle. */
  airSec: number;
  /** Sum of all cutting operations (excludes air). Sum of opTimes cutting. */
  cuttingSec: number;
  /** Same figure as `airSec`, named for what it is on a cycle sheet. */
  idleSec: number;
  /** Every operation that carries time, with its two columns. */
  opTimes: TurningOpTime[];
  /** Called-out threads this part SCREWCUTS rather than taps — see isScrewcutOnLathe. */
  screwcutCallouts: string[];
  /** Distinct assemblies (unassigned operation groups are provisional tools). */
  toolCount: number;
  operationCount: number;
  toolChangeCount: number;
  rapidSec: number;
  toolAssignments: ToolAssignment[];
}

/** Ra (um) an ordinary turned surface gets with no special measures. */
export const DEFAULT_TURNED_RA_UM = 3.2;
/**
 * How much of the theoretical feed is actually usable.
 *
 * Real turned roughness runs 20-50% above the theoretical Ra = f^2/(32r) value.
 * Since Ra goes as the SQUARE of feed, holding a called-out finish against a 35%
 * overshoot means feeding at about 1/sqrt(1.35) = 0.86 of what the formula says.
 */
export const ACHIEVABLE_RA_DERATE = 0.86;

/**
 * DEBURRING — an operation the model did not have, and the shop times.
 *
 * Both of Turncircuit's cycle sheets carry it explicitly: "deburr bore chamfer"
 * and "deburr thread" on the housing, "deburr 3.3mm dia slots thro" on the
 * hollow arm — where breaking the edges costs EXACTLY what cutting the slots
 * cost. Every drawing in the set says CLEAN AND BURR FREE. A drill that breaks
 * through leaves a burr on the far side; a thread leaves one at its mouth.
 *
 * WHAT DECIDES ITS TIME. On a lathe the work is spinning, so an edge chamfer is
 * a short feed across the chamfer face, not a traverse around the circumference.
 * The cut is therefore tiny and the operation is dominated by GETTING THERE —
 * which is the same rule as every other operation here: something that removes
 * almost nothing still costs its approach.
 *
 * The chamfer width is a shop figure. Nothing here is taken from the sheets;
 * they are what revealed the operation was missing, not what sets its length.
 */
export const DEBURR_CHAMFER_MM = 0.3;

/** Grooving insert width (mm) — the floor a plunge leaves, and the finish path. */
export const GROOVE_TOOL_WIDTH_MM = 3;

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
  // THE FORMULA IS THE FLOOR, NOT THE ANSWER. Theoretical Ra assumes no tool
  // wear and perfectly stable cutting; published guidance is that real roughness
  // runs 20-50% above it once vibration, built-up edge and tearing are in play.
  // A shop aiming at a drawing's Ra therefore feeds SLOWER than the formula
  // allows, and using the theoretical feed directly quietly assumes every part
  // is cut on a new insert in a rigid setup.
  return Math.sqrt(32 * r * raMm) * ACHIEVABLE_RA_DERATE;
}

/**
 * How much a boring bar has to be slowed for its overhang.
 *
 * A bar cutting four diameters deep is at the edge of chatter; past that, feed
 * and depth come off fast. Standard shop practice for a steel bar, expressed as
 * a multiplier on feed. The deep-bore parts in the calibration set are exactly
 * where the model reads fastest, and this is one reason why.
 */
/**
 * SCREWCUTTING RUNS SLOWER THAN TURNING, and the model ran it faster.
 *
 * A single-point threading insert cuts with its WHOLE FORM engaged — both flanks
 * and the crown at once — not with a point. The chip is V-shaped, thick at the
 * root, and leaves along two faces that fight each other. Published thread-
 * turning data is consistently well below general turning data for the same
 * material and grade: where brass turns at 300-400 m/min, thread turning in
 * brass is quoted around 100-150.
 *
 * The model used the material's FINISH turning speed, so it screwcut a G1/4 in
 * brass at 4,300 rpm. No shop threads at 4,300 rpm; the cycle has to infeed and
 * retract inside a revolution at the end of every pass.
 *
 * A fraction of the finish speed rather than a second table: the ratio is what
 * the published data agrees on, while the absolute numbers vary by grade.
 */
export const THREAD_VC_FRACTION = 0.35;

/**
 * HOW MANY PASSES A THREAD TAKES — the term that was a hardcoded 6.
 *
 * You cannot cut a thread in one pass: the full form is removed in successive
 * infeeds, each taking a shallower bite than the last so the chip AREA stays
 * roughly constant as the flank engagement grows. Tooling catalogues publish the
 * count against pitch (Sandvik, Seco and Vardex all tabulate "number of
 * infeeds") and they agree closely:
 *
 *     pitch mm   0.5   1.0   1.5   2.0   2.5   3.0
 *     infeeds      5     7     9    11    13    15
 *
 * which is a straight line in pitch: 3 + 4p. That is the relation used here,
 * plus ONE spring pass at final depth, because a thread that has to gauge gets
 * a cleanup pass that removes nothing.
 *
 * So a G1/4 (1.337 mm pitch) takes 9 infeeds and a spring pass, not 6 — and the
 * 6 was the same number whatever the pitch, which is the real error: a 0.35 mm
 * pitch and a 3 mm pitch were the same amount of work.
 */
export function threadPassCount(pitchMm: number): number {
  const p = Math.max(0.1, pitchMm);
  const infeeds = Math.min(24, Math.max(4, Math.ceil(3 + 4 * p)));
  return infeeds + 1; // the spring pass
}

/**
 * Smallest major diameter a lathe single-points rather than taps (mm).
 *
 * A tap in a turret holder is routine for small coaxial threads. As the size
 * goes up the tap's torque, its cost and the risk of breaking it in a blind hole
 * all rise, and an internal threading bar — which cuts any pitch, holds a gauge
 * size by offset and never strips a part — takes over. Twelve is a common
 * changeover; it is stated here as a shop practice, not a physical limit.
 */
export const SCREWCUT_MIN_MAJOR_MM = 12;

/** Pipe-thread families: sealing threads, single-pointed on a lathe as routine. */
const PIPE_THREAD = /^(G|R|Rc|Rp|BSP|BSPT|BSPP|NPT|NPTF)\s?\d/i;

/** The coaxial hole a called-out thread sits in, if any — matched on tap drill. */
export function hostHoleFor(
  t: Pick<ThreadSpec, 'tapDrillMm'>,
  coaxialHoles: Array<{ diameterMm: number; depthMm: number }>,
): { diameterMm: number; depthMm: number } | undefined {
  const tol = (d: number) => Math.max(0.15, 0.02 * d);
  return coaxialHoles.find((h) => Math.abs(h.diameterMm - t.tapDrillMm) <= tol(h.diameterMm));
}

/**
 * IS THIS THREAD SCREWCUT ON A LATHE, OR TAPPED?
 *
 * Every confirmed thread used to be tapped. Turncircuit's own cycle sheet says
 * otherwise for the VOC housing: "screw cut internal G1/4 — SNVRC10U-5LK 5LKIR
 * 19 BSPT", an internal threading bar, followed by "deburr thread" with the
 * same tool. Two conditions, both from the part rather than a judgement:
 *
 *   COAXIAL. The thread sits in a hole on the turning axis — its tap drill
 *   matches the main bore or one of the other coaxial holes. Only then can the
 *   lathe's own spindle drive a single-point tool through it. An off-axis
 *   thread is a driven tool's job, and a driven tool taps.
 *
 *   A SIZE OR FAMILY A LATHE SINGLE-POINTS. Pipe threads (G, Rc, BSPT, NPT)
 *   are sealing threads and are screwcut as routine — a taper one cannot be
 *   held by a straight tap at all without a taper tap, and the threading bar
 *   generates the taper by interpolation. Otherwise anything with a major
 *   diameter of SCREWCUT_MIN_MAJOR_MM or more.
 *
 * What it changes is the OPERATION, not much of the time: modelled as an
 * internal thread at its own diameter, a G1/4 in brass screwcuts in about the
 * time it would tap. It does change the tool on the traveller and — because a
 * screwcut thread is deburred by running the threading tool along the helix
 * again, where a tapped hole gets a chamfer at its mouth — the deburr.
 */
export function isScrewcutOnLathe(
  t: Pick<ThreadSpec, 'callout' | 'tapDrillMm' | 'pitchMm'>,
  coaxialHoles: Array<{ diameterMm: number; depthMm: number }>,
): boolean {
  if (!hostHoleFor(t, coaxialHoles)) return false;
  if (PIPE_THREAD.test(t.callout.trim())) return true;
  const major = THREAD_CATALOG[t.callout]?.majorMm ?? t.tapDrillMm + t.pitchMm;
  return major >= SCREWCUT_MIN_MAJOR_MM;
}

/**
 * WHERE A SCREWCUT THREAD STOPS, and how far the tool can coast past it.
 *
 * A lathe's Z axis cannot start or stop on the helix instantly: the servo lags
 * the spindle, so the lead is wrong for a short distance at each end of every
 * pass. Fanuc's threading-cycle manual gives the distances in terms of spindle
 * speed n (rpm) and lead L (mm) for the standard servo time constant:
 *
 *     end   δ2 ≈ n·L / 1800          start δ1 ≈ 3.605 · n·L / 1800
 *
 * The start is taken in air before the face; it costs δ1 at feed per pass,
 * which works out at a fixed ~0.12 s whatever the speed. The END is the
 * constraint: an internal thread that runs into a shoulder (a blind hole, or a
 * step down to a smaller bore) has only its run-out to stop in, so
 *
 *     n ≤ 1800 · run-out / L
 *
 * which is why a fine thread into a shoulder runs slower than an open one.
 */
export function threadServoLagMm(leadMm: number, n: number): { startMm: number; endMm: number } {
  const end = (Math.max(0, n) * Math.max(0, leadMm)) / 1800;
  return { startMm: 3.605 * end, endMm: end };
}

export function threadRunoutRpmCap(leadMm: number, runoutMm: number): number {
  if (!Number.isFinite(runoutMm)) return Infinity;
  return (1800 * Math.max(0, runoutMm)) / Math.max(0.05, leadMm);
}

/**
 * The run-out a thread ending at a shoulder needs — 1.5 pitches, the short end
 * of the incomplete-thread allowance in ISO 4755 / DIN 76 for an internal
 * thread with no undercut.
 */
export const THREAD_RUNOUT_PITCHES = 1.5;

/**
 * Usable length and available run-out of an internal thread in a host hole.
 *
 * A host that goes through the part leaves the tool free to run out into air:
 * the called-out depth is cut and nothing caps the speed. A host that ENDS
 * inside the part ends at a shoulder; if the callout runs the thread to that
 * shoulder it cannot be cut full-form all the way, so the full thread stops a
 * run-out short of it and that run-out is all the room the axis has to stop.
 */
export function threadInShoulder(
  pitchMm: number, threadDepthMm: number, hostDepthMm: number | undefined, partLengthMm: number,
): { lengthMm: number; runoutMm: number } {
  const host = hostDepthMm ?? threadDepthMm;
  const through = host >= partLengthMm * 0.95;
  if (through) return { lengthMm: Math.max(0.5, threadDepthMm), runoutMm: Infinity };
  const minRunout = THREAD_RUNOUT_PITCHES * Math.max(0.05, pitchMm);
  const lengthMm = Math.max(0.5, Math.min(threadDepthMm, host - minRunout));
  return { lengthMm, runoutMm: Math.max(0, host - lengthMm) };
}

/**
 * Thread form height — how deep the tool has to get, radially (mm).
 *
 * 60-degree ISO metric: h = 0.6134 * P. Kept as a named relation because it is
 * what makes a coarse thread more work than a fine one.
 */
export const threadFormHeightMm = (pitchMm: number) => 0.6134 * Math.max(0.05, pitchMm);

/**
 * HOW DEEP A CUT A BORING BAR CAN TAKE — a tool limit the model did not have.
 *
 * Internal depth of cut was taken from the MATERIAL (`depthOfCutRough * 0.6`),
 * so a 3 mm-deep roughing cut in brass was attempted through an 8 mm bar. It
 * cannot be: a boring bar is a cantilever, deflection goes as the cube of its
 * overhang and inversely as the FOURTH POWER of its diameter, and the cut simply
 * pushes the bar off line until it chatters.
 *
 * Standard shop practice for a steel bar at ordinary overhang is a depth of cut
 * of roughly a TENTH of the bar diameter — so an S08K (8 mm) bar takes 0.8 mm,
 * and that is the number that decides how many passes a bore needs. For the
 * housing's ⌀10.5 → ⌀11.8 that is still one roughing pass; on a bore with real
 * stock in it the pass count rises steeply, which is correct.
 *
 * The bar diameter comes from the shop's own tool assembly where it is recorded.
 * Where it is not, it is inferred from the bore: a bar has to fit down the hole
 * with room for the chip, which in practice means about 70% of the bore.
 */
export const BAR_DEPTH_OF_CUT_FRACTION = 0.1;
export const barDiameterForBore = (boreDiaMm: number) => 0.7 * Math.max(0.5, boreDiaMm);

export function boringDepthOfCutMm(barDiaMm: number, materialApMm: number): number {
  const barLimit = BAR_DEPTH_OF_CUT_FRACTION * Math.max(0.5, barDiaMm);
  return Math.max(0.05, Math.min(materialApMm, barLimit));
}

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
  /**
   * Short move to the NEXT identical feature with the same tool already loaded —
   * groove to groove along Z. No turret index, no spindle change, just a hop.
   */
  repositionTravelMm: number;
  /**
   * HOW FAR THE TURRET COMES OFF THE WORK BEFORE IT CAN INDEX (mm, one way).
   *
   * A turret cannot rotate where it cuts. Its tools stand out around its
   * periphery, and when it indexes every one of them sweeps a circle — so it
   * first has to withdraw far enough that the sweep misses the part, the chuck
   * and the tailstock. Then it indexes, and the new tool comes back in.
   *
   * The model charged a flat 120 mm of positioning per operation and nothing
   * else, which quietly assumed the next tool starts from wherever the last one
   * finished. It cannot: between them is a trip out to the index position and
   * back, and it is owed on every CHANGE — not on two operations that share a
   * tool, which never leave the work.
   *
   * The distance is set by the tool projection, which is what has to clear: on
   * a lathe of this class the tools stand roughly 100-150 mm off the turret
   * face. Charged out and back, so a change pays twice this.
   */
  indexRetractMm: number;
}

export const DEFAULT_OP_APPROACH: OpApproach = {
  rapidTravelMm: 120,
  rapidMmPerMin: 10000,
  settleSec: 1.5,
  clearanceMm: 2,
  repositionTravelMm: 25,
  indexRetractMm: 150,
};

/**
 * Seconds a tool CHANGE owes for the trip to the index position and back.
 *
 * Separate from the index itself (`TOOL_CHANGE_SEC`, the turret's own rotation
 * time): that is how long the turret takes to turn, this is how long the slides
 * take to get it somewhere it safely can. Charged only when the tool actually
 * changes.
 */
export function indexRetractSec(cfg: OpApproach = DEFAULT_OP_APPROACH): number {
  const travel = Number.isFinite(cfg.indexRetractMm) && cfg.indexRetractMm > 0
    ? cfg.indexRetractMm : DEFAULT_OP_APPROACH.indexRetractMm;
  // Out and back: the old tool withdraws, the new one returns.
  return ((2 * travel) / Math.max(1, cfg.rapidMmPerMin)) * 60;
}

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

/**
 * Moving the SAME tool to the next identical feature.
 *
 * Four grooves were charged four full approaches — 120 mm of rapid and a 1.5 s
 * spindle settle each — when after the first one the tool is already at the
 * diameter and the spindle is already at speed. What actually happens between
 * groove one and groove two is a short index along Z and a plunge.
 *
 * So the first occurrence pays the approach and the rest pay this. No settle,
 * because nothing about the spindle changed; the clearance feed stays, because
 * the tool still has to come off the work and back into it.
 */
export function repositionSec(feedMmPerMin: number, cfg: OpApproach = DEFAULT_OP_APPROACH): number {
  const travel = Number.isFinite(cfg.repositionTravelMm) && cfg.repositionTravelMm > 0
    ? cfg.repositionTravelMm : DEFAULT_OP_APPROACH.repositionTravelMm;
  const rapidSec = (travel / Math.max(1, cfg.rapidMmPerMin)) * 60;
  const clearanceSec = (cfg.clearanceMm / Math.max(0.001, feedMmPerMin)) * 60;
  return rapidSec + clearanceSec;
}

export const DEFAULT_TURNING_CONFIG: TurningConfig = {
  maxRpm: 6000,
  // Editable provisional allowance, not a verified machine specification.
  toolChangeSec: 8,
  roughFraction: 0.9,
  maxDrillDiaMm: 20,
};

/**
 * THE BAR'S CROSS-SECTION (mm²) and the diameter the tool first meets.
 *
 * A regular n-gon with across-flats AF has area n·AF²/4·tan(π/n) — 0.866·AF²
 * for a hex — and its corners lie on a circle of AF/cos(π/n). Round bar is the
 * bar diameter already chosen for this part, or the OD with a turning allowance.
 */
export function polygonSectionMm2(flats: number, acrossFlatsMm: number): number {
  return (flats * acrossFlatsMm * acrossFlatsMm / 4) * Math.tan(Math.PI / flats);
}
export function acrossCornersMm(flats: number, acrossFlatsMm: number): number {
  return acrossFlatsMm / Math.cos(Math.PI / flats);
}
export function barStockDiameterMm(p: Pick<TurningProfile, 'stock' | 'barDiameterMm' | 'odMm'>): number {
  if (p.stock?.shape === 'polygon') return acrossCornersMm(p.stock.flats, p.stock.acrossFlatsMm);
  return p.barDiameterMm && p.barDiameterMm > 0 ? p.barDiameterMm : p.odMm;
}
export function barStockSectionMm2(p: Pick<TurningProfile, 'stock' | 'barDiameterMm' | 'odMm'>): number {
  if (p.stock?.shape === 'polygon') return polygonSectionMm2(p.stock.flats, p.stock.acrossFlatsMm);
  const d = barStockDiameterMm(p);
  return (Math.PI / 4) * d * d;
}

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
  // The machine's OWN rapid rate. A flat 10 m/min is a standard Haas VF-2 and
  // nothing else: a Star SR-32 rapids at 24 m/min, an NTX 1000 at 40-50. Every
  // approach, retract and peck retract is timed from this.
  const rapid = cfg.opApproach?.rapidMmPerMin ?? DEFAULT_OP_APPROACH.rapidMmPerMin;
  // WHAT THE DRILL IS MADE OF, from the turret rather than assumed.
  //
  // DRILL_SUBSTRATE_VC existed but nothing reached it: every drill ran at
  // carbide speed because the tool library had no way to say otherwise. The spot
  // drill is asked separately — it is a different tool in a different station,
  // and a shop may well spot with carbide and drill deep with HSS.
  const drillCfg = (op: 'drill' | 'spot') => ({
    ...DEFAULT_DRILL_CONFIG,
    maxRpm: cfg.maxRpm,
    rapidMmPerMin: rapid,
    substrate: toolFor(op).substrate ?? DEFAULT_DRILL_CONFIG.substrate,
  });
  const approach = (feedMmPerMin: number) => opApproachSec(feedMmPerMin, cfg.opApproach);
  const reposition = (feedMmPerMin: number) => repositionSec(feedMmPerMin, cfg.opApproach);
  // n occurrences of the same feature with the same tool: one approach, then a
  // short hop to each of the rest.
  const repeated = (n: number, feedMmPerMin: number) =>
    n > 0 ? approach(feedMmPerMin) + (n - 1) * reposition(feedMmPerMin) : 0;
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
  const facingCutSec = profile.faceCount > 0
    ? profile.faceCount * (
        faceRoughPasses * min((od / 2) / faceRoughFeedMmPerMin)
        + finishPasses * min((od / 2) / faceFinishFeedMmPerMin)
      )
    : 0;
  // A full approach per face, deliberately: the two faces are at opposite ends
  // of the part, so the second is reached by re-gripping or by the sub-spindle
  // — never by hopping 25 mm along Z.
  const facingIdleSec = profile.faceCount > 0
    ? profile.faceCount * approach(faceFinishFeedMmPerMin)
    : 0;
  const facingSec = facingCutSec + facingIdleSec;

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
  // ---- WHAT IS ACTUALLY TURNED, when the geometry says (odRegions) ----------
  //
  // Without regions the model assumed the part was one round OD, turned along
  // its whole length from round bar, with its metal removed = bar - part. That
  // is wrong three ways on a part like the VOC housing: the bar is HEX, so the
  // "OD" is its corners and is never turned; bar - part includes the HOLES,
  // which a drill removes, not an OD tool; and the turned diameters sit at
  // their own sizes over their own lengths, not at the corners over 70 mm.
  //
  // So each turned region is timed by itself: the metal it removes is the BAR
  // SECTION minus its own circle, over its own length; it is roughed down from
  // the bar's outside in passes; and finished at its own diameter. Regions that
  // are RECESSES are cut by the grooving insert below, not here.
  const regions = profile.odRegions ?? [];
  const regionBased = regions.length > 0;
  const stockDia = barStockDiameterMm(profile);
  const stockSection = barStockSectionMm2(profile);
  const bosses = regions.filter((r) => r.kind === 'boss');
  const recesses = regions.filter((r) => r.kind === 'recess');
  const regionRemovalCm3 = (r: { diameterMm: number; lengthMm: number }) =>
    Math.max(0, stockSection - (Math.PI / 4) * r.diameterMm * r.diameterMm) * Math.max(0, r.lengthMm) / 1000;

  let roughCutSec = 0;
  let roughIdleSec = 0;
  let finishCutSec = 0;
  let finishIdleSec = 0;
  const finishFeed = feedForFinish('finish', m.feedFinish, 0.4);
  if (regionBased) {
    for (const b of bosses) {
      const vol = regionRemovalCm3(b);
      if (vol > 0 && mrr > 0) {
        const passes = Math.max(1, Math.ceil(((stockDia - b.diameterMm) / 2) / Math.max(0.1, m.depthOfCutRough)));
        roughCutSec += min((vol * cfg.roughFraction) / mrr);
        // Each pass returns along ITS region, not a fixed 120 mm.
        roughIdleSec += passes * ((b.lengthMm + 5) / Math.max(1, rapid)) * 60;
      }
      const fRpm = rpm(m.cuttingSpeedFinish, b.diameterMm, cfg.maxRpm);
      finishCutSec += finishPasses * min(b.lengthMm / Math.max(0.001, finishFeed * fRpm));
    }
    if (roughCutSec > 0) roughIdleSec += approach(roughFeedMmPerMin);
    if (finishCutSec > 0) {
      finishIdleSec = approach(Math.max(0.001, finishFeed * rpm(m.cuttingSpeedFinish, od, cfg.maxRpm)));
    }
  } else {
    const cuttingRough = removalVolCm3 > 0 && mrr > 0;
    roughCutSec = cuttingRough ? min((removalVolCm3 * cfg.roughFraction) / mrr) : 0;
    roughIdleSec = cuttingRough ? roughReturnSec + approach(roughFeedMmPerMin) : 0;
    // Finish turning — one pass along the OD, at the feed the FINISHING INSERT
    // can take for the finish the drawing asks for.
    const finishFeedMmPerMin = Math.max(0.001, finishFeed * rpm(m.cuttingSpeedFinish, od, cfg.maxRpm));
    finishCutSec = finishPasses * min(profile.lengthMm / finishFeedMmPerMin);
    finishIdleSec = approach(finishFeedMmPerMin);
  }
  const roughSec = roughCutSec + roughIdleSec;
  const finishSec = finishCutSec + finishIdleSec;

  // Drilling + boring. A hole is drilled from solid only up to the max drill
  // size; anything larger is drilled to that pilot and then bored OUT to size
  // with a boring bar — you can't drill a 45 mm hole in one shot. Boring the
  // extra radius takes multiple roughing passes plus a finish pass, which is the
  // real cost driver on a big bore (the old model priced it as one finish pass).
  let drillSec = 0;
  let spotSec = 0;
  let boreSec = 0;
  let drillDiaMm = 0;
  let drillCutSec = 0;
  let drillIdleSec = 0;
  let spotCutSec = 0;
  let spotIdleSec = 0;
  let boreCutSec = 0;
  let boreIdleSec = 0;
  if (profile.boreDiaMm > 0 && profile.boreDepthMm > 0) {
    const depth = profile.boreDepthMm;
    // DRILL UNDER, THEN BORE TO SIZE.
    //
    // This used to drill straight to the finished diameter — min(boreDia,
    // maxDrill) — which left the boring bar nothing to remove and made "Boring"
    // a finish pass over a hole already at size. It also assumed a drill exists
    // at whatever decimal the model measured: ⌀11.80 is not a drill, it is a
    // BORED dimension, and the nearest stocked sizes are 11.5 and 12.0.
    //
    // A drill cannot hold a dimensioned bore anyway — it cuts oversize, out of
    // round and rough — so anything the drawing dimensions is drilled under and
    // bored. Now the drill is a size a shop owns and the bore has real stock.
    // A STEPPED BORE is drilled through at its narrow diameter, the whole way,
    // and the mouth is bored up from that — see TurningProfile.pilotHole. The
    // drill is the narrow hole's own size and depth, not a separate pilot.
    const pilot = profile.pilotHole && profile.pilotHole.diameterMm > 0
      && profile.pilotHole.diameterMm < profile.boreDiaMm && profile.pilotHole.depthMm >= depth
      ? profile.pilotHole : undefined;
    const boreStock = boringStockMm(profile.boreDiaMm);
    const drillDia = pilot
      ? standardDrillMm(Math.min(pilot.diameterMm, cfg.maxDrillDiaMm))
      : standardDrillMm(Math.min(profile.boreDiaMm - boreStock, cfg.maxDrillDiaMm));
    const drillDepth = pilot ? pilot.depthMm : depth;
    drillDiaMm = drillDia;
    // Pilot / through drill to the drillable diameter, on the same arithmetic
    // the milling side uses (drilling.ts) so one hole does not cost two
    // different amounts depending on which estimator happens to see it.
    //
    // The old line here multiplied by a flat 1.4 whenever the hole was deeper
    // than three diameters, which is where Lance's VOC housing went wrong: its
    // two ⌀11 holes are 125 mm deep — an L/D of eleven — and the real cost is
    // the twenty-odd full retracts needed to clear the chips, not 40% on top of
    // a single plunge.
    const drillSplit = drillHoleSplit({ diameterMm: drillDia, depthMm: drillDepth }, m, drillCfg('drill'));
    drillCutSec = drillSplit.cuttingSec;
    drillIdleSec = drillSplit.idleSec;
    drillSec = drillCutSec + drillIdleSec;
    // Spot it first, or the drill wanders off the axis the drawing dimensions from.
    const spotSplit = spotDrillSplit(drillDia, m, drillCfg('spot'));
    spotCutSec = spotSplit.cuttingSec;
    spotIdleSec = spotSplit.idleSec;
    spotSec = spotCutSec + spotIdleSec;

    // Boring: open from the drilled hole to the final bore. rpm taken at the
    // final diameter (conservative — the bar runs slower on a big bore).
    const boreRpm = rpm(m.cuttingSpeedFinish, profile.boreDiaMm, cfg.maxRpm);
    const radial = (profile.boreDiaMm - drillDia) / 2;
    // OVERHANG. A boring bar reaching four diameters into a hole is at the edge
    // of chatter, and past that feed and depth come off fast. The model ran every
    // bore at full feed however deep it was, which is one reason the deep-bore
    // parts are the ones it reads fastest on.
    const overhang = boringOverhangDerate(depth / Math.max(0.1, profile.boreDiaMm));
    // The BAR decides the depth of cut, not the material — see
    // boringDepthOfCutMm. Its diameter comes from the shop's assembly where
    // recorded, otherwise from what fits down the hole.
    const barDiaMm = toolFor('bore').diameterMm ?? barDiameterForBore(profile.boreDiaMm);
    const boreApMm = boringDepthOfCutMm(barDiaMm, m.depthOfCutRough * 0.6) * overhang;
    let boreRoughSec = 0;
    let boringPasses = 0;
    if (radial > 0.1) {
      boringPasses = Math.ceil(radial / Math.max(0.05, boreApMm));
      boreRoughSec = boringPasses * min(depth / Math.max(0.001, m.feedRough * overhang * boreRpm));
    }
    const boreFeed = feedForFinish('bore', m.feedFinish, 0.4) * overhang;
    const boreFeedMmPerMin = Math.max(0.001, boreFeed * boreRpm);
    const boreFinishSec = finishPasses * min(depth / boreFeedMmPerMin);
    // The bar travels the full depth back out of the hole between passes, and
    // the whole operation still has to reach the bore face to begin with.
    const borePassRetractSec = boringPasses > 0
      ? boringPasses * (depth / Math.max(1, (cfg.opApproach ?? DEFAULT_OP_APPROACH).rapidMmPerMin)) * 60
      : 0;
    boreCutSec = boreRoughSec + boreFinishSec;
    boreIdleSec = borePassRetractSec + approach(boreFeedMmPerMin);
    boreSec = boreCutSec + boreIdleSec;
  }

  // Grooving — plunge a ~3 mm tool to ~10% of OD, per groove.
  // EACH groove is its own plunge, but only the FIRST pays a full approach: after
  // that the tool is at the diameter and the spindle is at speed, and what
  // happens between grooves is a short index along Z.
  const grooveFeedMmPerMin = Math.max(0.001, 0.05 * rpm(m.cuttingSpeedFinish, od, cfg.maxRpm));
  // A GROOVE IS ROUGHED AND THEN FINISHED, like every other dimensioned feature.
  //
  // It was one continuous plunge to depth, which is not how a groove is cut and
  // not how one holds a width or a floor radius:
  //
  //   THE PLUNGE IS PECKED. A grooving insert cutting a slot deeper than about
  //   its own width traps the chip — there is nowhere for it to go but back up
  //   the slot it came from — so the tool retracts to clear it, on the same
  //   reasoning as a deep hole. Standard practice is a peck every depth-of-cut.
  //
  //   THEN THE FLOOR AND THE FLANKS ARE FINISHED. A plunged groove leaves the
  //   insert's own form at the bottom and a torn wall on each side; a dimensioned
  //   recess gets a pass along the floor and up both flanks.
  //
  // Which is why Lance's sheet says "rough AND finish recess" and the model had
  // one number: it was pricing the roughing plunge alone.
  const grooveDepthMm = od * 0.1;
  const grooveFinishFeedMmPerMin = Math.max(
    0.001, feedForFinish('groove', m.feedFinish, 0.2) * rpm(m.cuttingSpeedFinish, od, cfg.maxRpm));
  const groovePecks = Math.max(1, Math.ceil(grooveDepthMm / Math.max(0.1, m.depthOfCutRough)));
  // Floor across the insert width, then up each flank to the OD.
  const grooveFinishPathMm = GROOVE_TOOL_WIDTH_MM + 2 * grooveDepthMm;
  let grooveCutSec = !regionBased && profile.grooveCount > 0
    ? profile.grooveCount * (
        min(grooveDepthMm / grooveFeedMmPerMin)
        + min(grooveFinishPathMm / grooveFinishFeedMmPerMin)
      )
    : 0;
  let grooveIdleSec = !regionBased && profile.grooveCount > 0
    ? repeated(profile.grooveCount, grooveFeedMmPerMin)
      // Each peck comes right out of the slot and goes back down it.
      + profile.grooveCount * (groovePecks - 1) * 2 * (grooveDepthMm / Math.max(1, rapid)) * 60
    : 0;

  // RECESSES, from the real geometry — and when regions are known these replace
  // the groove COUNT entirely. The count was a tally of cylindrical faces below
  // 85% of the OD, so on the housing it read "4 grooves" for two end lands each
  // made of two half-faces, and timed four 3 mm plunges to 10% of the OD. The
  // real feature is one ⌀21 recess 44 mm long between two hex collars.
  //
  // A recess wider than the insert is MULTI-PLUNGED: plunge to depth, step
  // along by 80% of the insert width (the overlap that keeps the floor free of
  // ridges), plunge again. Each plunge is pecked like any slot deeper than the
  // insert is wide. Then one finishing pass along the floor and up both flanks.
  // The depth is from the BAR's outside — on a polygon bar, its corners, which
  // the insert meets first and then repeatedly: an interrupted cut, priced as one
  // in the realisation stack.
  if (regionBased && recesses.length) {
    const w = GROOVE_TOOL_WIDTH_MM;
    const plungeRpm = rpm(m.cuttingSpeedRough, stockDia, cfg.maxRpm);
    const plungeFeed = Math.max(0.001, 0.05 * plungeRpm);
    const recessFinishFeed = Math.max(0.001,
      feedForFinish('groove', m.feedFinish, 0.2) * rpm(m.cuttingSpeedFinish, stockDia, cfg.maxRpm));
    let plungesTotal = 0;
    for (const r of recesses) {
      const depth = Math.max(0, (stockDia - r.diameterMm) / 2);
      const plunges = r.lengthMm <= w ? 1 : Math.ceil((r.lengthMm - w) / (0.8 * w)) + 1;
      const pecks = Math.max(1, Math.ceil(depth / Math.max(0.1, m.depthOfCutRough)));
      plungesTotal += plunges;
      grooveCutSec += plunges * min(depth / plungeFeed)
        + min((r.lengthMm + 2 * depth) / recessFinishFeed);
      grooveIdleSec += plunges * (pecks - 1) * 2 * (depth / Math.max(1, rapid)) * 60;
    }
    grooveIdleSec += repeated(plungesTotal, plungeFeed);
  }
  const grooveSec = grooveCutSec + grooveIdleSec;

  // WHICH CALLED-OUT THREADS ARE SCREWCUT, and which are tapped.
  //
  // Every confirmed thread used to be tapped. A coaxial pipe thread on a lathe
  // is not: Turncircuit's sheet for the VOC housing reads "screw cut internal
  // G1/4 — SNVRC10U-5LK 5LKIR 19 BSPT", an internal threading bar, and then
  // "deburr thread" with the SAME tool. See isScrewcutOnLathe for the rule.
  const coaxialHoles = [
    ...(profile.boreDiaMm > 0 ? [{ diameterMm: profile.boreDiaMm, depthMm: profile.boreDepthMm }] : []),
    ...(profile.additionalBores ?? []),
  ];
  const screwcutThreads = (profile.threads ?? []).filter((t) => isScrewcutOnLathe(t, coaxialHoles));
  const tappedThreads = (profile.threads ?? []).filter((t) => !isScrewcutOnLathe(t, coaxialHoles));

  // Threading — multi-pass over the thread length, per threaded feature.
  const threadLenMm = Math.min(1.5 * od, profile.lengthMm * 0.3);
  // THE PITCH COMES FROM THE CALLOUT when the drawing gave one. It was a
  // hardcoded 1.5 mm, so an M2 x 0.4 and a 3 mm-pitch trapezoidal thread cost
  // exactly the same — and the pitch is what sets both the feed and the number
  // of passes, which is to say it sets the whole operation.
  //
  // From the SCREWCUT thread's own field. It briefly read `profile.threads`,
  // which is the TAPPED-hole list: a different feature, so a tapped M2 x 0.4
  // would have set the pitch of an unrelated screwcut thread.
  const threadPitchMm = num(profile.threadPitchMm, 1.5);
  const threadPasses = threadPassCount(threadPitchMm);
  // Screwcutting has its own speed — see THREAD_VC_FRACTION. The thread is cut
  // on the OD for an external thread and in the bore for an internal one; the
  // bore is the smaller diameter and therefore the higher rpm, so the OD is the
  // conservative choice and the one a flange thread actually runs at.
  const threadRpm = rpm(m.cuttingSpeedFinish * THREAD_VC_FRACTION, od, cfg.maxRpm);

  // ONE SINGLE-POINT THREAD, timed at its own pitch, diameter and length.
  //
  // An EXTERNAL thread is cut at the OD. An INTERNAL one is cut at its own
  // major diameter, in the bore — and is no longer than the hole it sits in.
  const singlePoint = (pitchMm: number, diaMm: number, lengthMm: number, runoutMm = Infinity) => {
    const passes = threadPassCount(pitchMm);
    // A thread that ends at a shoulder must stop inside its run-out, and the
    // axis needs n·L/1800 mm to stop — so the run-out caps the speed.
    const n = Math.min(
      rpm(m.cuttingSpeedFinish * THREAD_VC_FRACTION, Math.max(0.5, diaMm), cfg.maxRpm),
      Math.max(50, threadRunoutRpmCap(pitchMm, runoutMm)),
    );
    const feed = Math.max(0.001, pitchMm * n);
    const lag = threadServoLagMm(pitchMm, n);
    return {
      n, feed, lengthMm,
      lagSec: min((lag.startMm + lag.endMm) / feed),
      cuttingSec: min((passes * lengthMm) / feed),
      // A THREADING CYCLE IS NOT CONTINUOUS PASSES. Between each one the tool
      // retracts clear, rapids the thread length back to the start and steps in
      // for the next depth.
      idleSec: approach(feed) + passes * min((lag.startMm + lag.endMm) / feed) + (passes - 1) * (
        ((lengthMm + lag.startMm) / Math.max(1, rapid)) * 60
        // THEN WAIT FOR THE SPINDLE. A thread pass cannot start anywhere: the
        // control has to see the one-per-revolution marker so every pass enters
        // the same helix. Taken as a full revolution, which is the figure that
        // matters at the low rpm screwcutting actually runs at.
        + 60 / Math.max(1, n)
      ),
    };
  };
  const singlePointThreads = [
    // Threads entered by count: external, at the OD, length from the part.
    ...Array.from({ length: Math.max(0, profile.threadCount) }, () =>
      singlePoint(threadPitchMm, od, threadLenMm)),
    // Called-out threads that a lathe screwcuts rather than taps: internal, at
    // their own major diameter, no longer than the hole they are in.
    ...screwcutThreads.flatMap((t) => {
      const host = hostHoleFor(t, coaxialHoles);
      const major = THREAD_CATALOG[t.callout]?.majorMm ?? t.tapDrillMm + t.pitchMm;
      const r = threadInShoulder(t.pitchMm, t.depthMm, host?.depthMm, profile.lengthMm);
      return Array.from({ length: Math.max(1, Math.round(t.count ?? 1)) }, () =>
        singlePoint(t.pitchMm, major, r.lengthMm, r.runoutMm));
    }),
  ];
  const threadCutSec = singlePointThreads.reduce((a, x) => a + x.cuttingSec, 0);
  const threadIdleSec = singlePointThreads.reduce((a, x) => a + x.idleSec, 0);
  const threadSec = threadCutSec + threadIdleSec;

  // Part-off — plunge to centre at a reduced speed.
  const partRpm = rpm(m.cuttingSpeedFinish * 0.6, od, cfg.maxRpm);
  const partFeedMmPerMin = Math.max(0.001, 0.08 * partRpm);
  const partingCutSec = min((od / 2) / partFeedMmPerMin);
  const partingIdleSec = approach(partFeedMmPerMin);
  const partingSec = partingCutSec + partingIdleSec;

  // Off-axis work: cross holes, flats, keyways. This used to be a boolean the
  // time model never read, so a cross-drilled part cost exactly what a plain one
  // did. See crossFeaturesSec for what each of these actually involves.
  // Every other on-axis hole: spotted and drilled like the main one. They are
  // drilled, not bored — only a dimensioned bore gets a boring bar.
  for (const h of profile.additionalBores ?? []) {
    const d = standardDrillMm(Math.min(h.diameterMm, cfg.maxDrillDiaMm));
    if (d <= 0 || h.depthMm <= 0) continue;
    const s = spotDrillSplit(d, m, drillCfg('spot'));
    spotCutSec += s.cuttingSec;
    spotIdleSec += s.idleSec;
    spotSec += s.cuttingSec + s.idleSec;
    const dr = drillHoleSplit({ diameterMm: d, depthMm: h.depthMm }, m, drillCfg('drill'));
    drillCutSec += dr.cuttingSec;
    drillIdleSec += dr.idleSec;
    drillSec += dr.cuttingSec + dr.idleSec;
  }

  // --- Deburring -----------------------------------------------------------
  // One edge per hole mouth, a second where the hole breaks through, and one per
  // thread. The cut is a chamfer's width at finishing feed; the cost is the
  // approach, because on a spinning part that is what the operation really is.
  const deburrEdges: number[] = [];
  if (profile.boreDiaMm > 0 && profile.boreDepthMm > 0) deburrEdges.push(profile.boreDiaMm);
  for (const h of profile.additionalBores ?? []) {
    deburrEdges.push(h.diameterMm);
    // Through the part: the far side gets a burr too.
    if (h.depthMm >= profile.lengthMm * 0.95) deburrEdges.push(h.diameterMm);
  }
  // A TAP leaves its burr at the mouth of the hole it went into — a chamfer
  // reaches that, so a tapped thread is deburred like any other edge.
  for (const th of tappedThreads) deburrEdges.push(th.tapDrillMm);

  let deburrCutSec = 0;
  let deburrIdleSec = 0;

  // A SCREWCUT THREAD'S BURR LIES ALONG THE HELIX, NOT AT A POINT.
  //
  // Screwcut threads were being deburred as though they were hole mouths: one
  // 0.3 mm chamfer, a fraction of a second. But single-point threading raises a
  // burr on the flank of EVERY TURN of the thread, the whole way along it, and
  // no chamfer cut at the mouth reaches that. What a shop does is run the thread
  // path AGAIN — the threading tool is still in the turret and still at depth —
  // so deburring a screwcut thread costs A PASS OVER THE THREAD. That is the
  // same arithmetic as a threading pass, and about a hundred times the chamfer
  // the model was charging.
  //
  // (A tap cannot be re-run this way, which is why tapped threads are handled
  // as mouth chamfers above and screwcut ones here.)
  // Every single-point thread — entered by count or screwcut from a callout —
  // at its OWN feed, length and speed.
  for (const th of singlePointThreads) {
    deburrCutSec += min(th.lengthMm / th.feed);
    deburrIdleSec += approach(th.feed) + 60 / Math.max(1, th.n) + th.lagSec;
  }

  for (const dia of deburrEdges) {
    const edgeRpm = rpm(m.cuttingSpeedFinish, Math.max(0.5, dia), cfg.maxRpm);
    const feedMmPerMin = Math.max(0.001, m.feedFinish * edgeRpm);
    // The chamfer face, taken at 45 degrees.
    deburrCutSec += min((DEBURR_CHAMFER_MM * Math.SQRT2) / feedMmPerMin);
    deburrIdleSec += approach(feedMmPerMin);
  }
  const deburrSec = deburrCutSec + deburrIdleSec;

  const cross = crossFeaturesSplit(profile.crossFeatureList, m, {
    ...DEFAULT_CROSS_CONFIG,
    maxRpm: cfg.maxRpm,
    maxDrillDiaMm: cfg.maxDrillDiaMm,
    rapidMmPerMin: rapid,
  });
  const crossSec = cross.cuttingSec + cross.idleSec;

  // Tapping. A thread is the one operation with no geometric signature — the
  // solid holds only the tap drill — so these arrive as callouts, measured or
  // proposed, never inferred from a face.
  // Only the threads that are actually TAPPED; screwcut ones are timed above.
  const tap = tapThreadsSplit(tappedThreads, m);
  const tapSec = tap.cuttingSec + tap.idleSec;

  const times = { face: facingSec, rough: roughSec, finish: finishSec, spot: spotSec, drill: drillSec,
    bore: boreSec, groove: grooveSec, thread: threadSec, partoff: partingSec, cross: crossSec,
    tap: tapSec, deburr: deburrSec };
  // The cutting half and the idle half of each of those, in the same keys.
  const cut: Record<EstimatedTurningOp, number> = {
    face: facingCutSec, rough: roughCutSec, finish: finishCutSec, spot: spotCutSec,
    drill: drillCutSec, bore: boreCutSec, groove: grooveCutSec, thread: threadCutSec,
    partoff: partingCutSec, cross: cross.cuttingSec, tap: tap.cuttingSec, deburr: deburrCutSec,
  };
  const idle: Record<EstimatedTurningOp, number> = {
    face: facingIdleSec, rough: roughIdleSec, finish: finishIdleSec, spot: spotIdleSec,
    drill: drillIdleSec, bore: boreIdleSec, groove: grooveIdleSec, thread: threadIdleSec,
    partoff: partingIdleSec, cross: cross.idleSec, tap: tap.idleSec, deburr: deburrIdleSec,
  };

  const liveOps = TURNING_SEQUENCE.filter(op => times[op] > 0);
  const toolAssignments = liveOps.map(toolFor);
  const { distinctTools: toolCount, selections: toolChangeCount } = countToolSelections(toolAssignments);
  // Settings are PERSISTED. A blob saved before a field existed — or edited to
  // an empty string in the Settings form — comes back undefined, and the failure
  // mode here is not a slightly wrong number: NaN propagates silently out of
  // cycle time, through machineCost, and into a quoted price that renders as
  // "£NaN" or, worse, sums to nothing anyone notices. Default at the boundary.
  const toolChangeSec = Number.isFinite(cfg.toolChangeSec) && cfg.toolChangeSec > 0
    ? cfg.toolChangeSec
    : DEFAULT_TURNING_CONFIG.toolChangeSec;

  // THE TURRET INDEX BELONGS TO THE OPERATION THAT CAUSES IT.
  //
  // It used to be counted globally and shown as one "Tool selections" row, so a
  // reader could see that eleven changes had been charged but not which
  // operation waited for one — and two operations sharing a tool looked exactly
  // as expensive as two that did not. The count is unchanged (the first
  // operation pays for its tool arriving; a run of operations on one tool pays
  // once), it is simply attributed.
  // A CHANGE COSTS THE INDEX PLUS THE TRIP TO WHERE IT IS SAFE TO INDEX.
  // Two operations sharing a tool pay neither: the tool never leaves the work.
  const changeSec = toolChangeSec + indexRetractSec(cfg.opApproach);
  const opTimes: TurningOpTime[] = liveOps.map((op, i) => ({
    op,
    cuttingSec: cut[op],
    idleSec: idle[op]
      // `identity`, the same key countToolSelections counts by — so the per-op
      // indexes still sum to exactly toolChangeCount × toolChangeSec.
      + (i === 0 || toolAssignments[i].identity !== toolAssignments[i - 1].identity ? changeSec : 0),
  }));

  // THE TOTALS ARE NOW THE SUM OF THE ROWS, which is the property that makes the
  // breakdown auditable: every second in the cycle sits on some operation's
  // line. What is deliberately GONE is `rapidSec = cuttingSec * 0.05` — a flat
  // allowance that was never measured travel, added on top of approaches and
  // retracts that ARE now counted move by move. Keeping both would charge the
  // same air twice, and a provisional lump is the wrong one to keep.
  const cuttingSec = opTimes.reduce((a, o) => a + o.cuttingSec, 0);
  const idleSec = opTimes.reduce((a, o) => a + o.idleSec, 0);

  return { spotSec, deburrSec, drillDiaMm, facingSec, roughSec, finishSec, drillSec, boreSec, grooveSec, threadSec, partingSec, crossSec, tapSec,
    airSec: idleSec, idleSec, cuttingSec, opTimes, toolCount, toolChangeCount, rapidSec: 0,
    screwcutCallouts: screwcutThreads.map((t) => t.callout),
    toolAssignments, operationCount: toolAssignments.length };
}
