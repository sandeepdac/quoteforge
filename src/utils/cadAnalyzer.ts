import { StepParseResult, parseStepFile } from './stepParser';
import { CadPdfMetadata } from './sampleCadFiles';
import {
  tessellateCad,
  measureMesh,
  solidFormatFor,
  TessellatedMesh,
  MeshMeasurements,
} from './occtLoader';
import { analyzeDrawingWithAI, AiDrawingData } from './aiExtractor';
import { DfmReport } from './dfmTypes';
import { analyzeCncDfm } from './dfmCnc';
import { classifyPart, PartClass } from './partClass';
import { computeStock } from './cncEstimator';
import { TurningProfile } from './turning';
import { MilledProfile, contouredSetupCount, toBarStockProfile } from './milledEstimator';
import { selectMachine, MACHINE_CATALOG, MachineRecommendation, MachineId } from './machineSelection';
import { materialPropsFor, milledBilletMm, nextStandardBar } from './materials';
import { extractTurnedProfile, arrayBufferToBase64, GeometryResult } from './geometryService';
import { DEFAULT_CNC_SETTINGS } from '../constants';

export type MeasurementSource = 'solid' | 'estimated' | 'ai-drawing' | 'manual';

export interface ExtractedCadAnalysis {
  partName: string;
  fileType: 'STEP' | 'PDF' | 'DXF' | 'IMAGE';
  fileName: string;
  materialName: string;
  thicknessMm: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  perimeterMm: number;
  pierceCount: number;
  bendCount: number;
  isSimpleBending: boolean;
  holeCount: number;
  holeDetails: Array<{ diameterMm: number; count: number }>;
  weldLengthMm: number;
  weldCount: number;
  weightKg: number;
  surfaceAreaM2: number;
  finishCallout?: string;
  tolerances?: string;
  aiNotes: string[];
  confidenceScore: number;
  stepData?: StepParseResult;
  /** Raw STEP bytes (base64), in memory only — stripped before persistence.
   *  Lets the face-coverage audit re-request its mesh without a re-upload. */
  fileBase64?: string;
  stepMesh?: TessellatedMesh; // Tessellated B-Rep for the 3D viewer (reused, not re-computed)
  /** How dimensions/volume/weight were obtained. */
  measurementSource: MeasurementSource;
  /** True when detected operations (holes/bends/perimeter) are unreliable and need review. */
  featuresNeedReview?: boolean;
  /**
   * True when the solid is a FORMED (folded) sheet-metal part rather than a flat
   * blank. Retained for sheet-metal inputs; always false for machined solids.
   */
  formedPart?: boolean;
  /** Advisory Design-for-Manufacturing findings from the measured geometry. */
  dfm?: DfmReport;
  // --- CNC turning metrics ------------------------------------------------
  /** Turned (round bar) vs milled/prismatic. */
  partClass?: PartClass;
  /** Which machining route this part is costed on. */
  machineClass?: 'turn' | 'mill';
  /** True when the solid is rotationally symmetric and can be costed as a turned part. */
  isTurned?: boolean;
  /** Why a part was judged non-rotational — set when isTurned is false (informational). */
  notRotationalReason?: string;
  /** The turned profile used for the cycle-time estimate. */
  turningProfile?: TurningProfile;
  /** The milled/prismatic profile (the 3 AAG rules) — set for milled parts. */
  milledProfile?: MilledProfile;
  /** Recommended machine (sliding-head / 2-axis / turn-mill / mill) + reasoning. */
  machineRecommendation?: MachineRecommendation;
  /** Standard bar diameter selected (mm). */
  barDiameterMm?: number;
  /** Off-axis features present → needs a second op / live tooling. */
  crossFeatures?: boolean;
  /** Round-bar ⌀ (turned parts). */
  diameterMm?: number;
  /** Length along the turning axis (turned parts). */
  axisLengthMm?: number;
  /** Measured enclosed volume of the finished part (cm³). */
  volumeCm3?: number;
  /** Measured wetted surface area of the finished part (cm²). */
  surfaceAreaCm2?: number;
  /** Raw stock volume the part is machined from (cm³). */
  stockVolumeCm3?: number;
  /** Stock volume removed as chips (cm³). */
  removedVolumeCm3?: number;
  /** part volume ÷ stock volume — material yield (buy-to-fly), 0–1. */
  buyToFlyRatio?: number;
  /** Estimated number of machine setups (fixturings / re-orientations). */
  setups?: number;
  pdfData?: CadPdfMetadata;
  pdfUrl?: string; // Object URL / static path to the actual PDF/image for inline rendering
}

export interface CadFileInput {
  name: string;
  content?: string;
  buffer?: ArrayBuffer;
  base64?: string;
  mimeType?: string;
  fileType?: string;
  pdfUrl?: string;
}

const round = (v: number, d: number) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

const baseName = (fileName: string) => fileName.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');

function densityFor(materialName: string): number {
  if (/STAINLESS|INOX|\b304\b|\b316\b/i.test(materialName)) return 8.0;
  if (/ALUMINI?UM|\b6061\b|\b5052\b/i.test(materialName)) return 2.7;
  return 7.85; // steel default
}

/**
 * Strip the heavy tessellated mesh and raw STEP parse tree so a cadAnalysis can
 * be persisted in localStorage. The measured geometry, profiles, plan, features
 * and DFM are kept — enough to re-open the quote for editing and re-price it —
 * but the live 3D viewer will need the file re-uploaded (typed-array meshes do
 * not survive JSON and would blow the storage quota).
 */
export function stripCadForStorage(a: ExtractedCadAnalysis): ExtractedCadAnalysis {
  const { stepMesh, stepData, fileBase64, ...rest } = a;
  void stepMesh;
  void stepData;
  // The raw file is kept in memory only, to re-request the face-coverage mesh
  // without a re-upload. It must never reach localStorage — it is the largest
  // thing in the object and none of it is needed to re-price a saved quote.
  void fileBase64;
  return rest as ExtractedCadAnalysis;
}

/**
 * Main dispatcher. Routes any input to the most accurate path available:
 *   • 3D solids (STEP/IGES/BREP) → tessellate + measure exact geometry
 *   • 2D drawings (PDF/PNG/JPG)  → read dimensions with AI vision
 *   • anything else / failures   → honest manual-entry state (never fabricated data)
 */
/** Extra context for analysis — e.g. the machines the shop owns, so a part can be
 *  routed to a turn-mill (round bar) only when the shop actually has one. */
export interface AnalyzeOptions {
  /** Machines on the shop floor; omitted → the whole catalog is considered. */
  machines?: MachineId[];
  /**
   * Batch size, if known at analysis time. It decides the machine: setups
   * dominate at qty 1 (favouring the machine that needs fewest), the hourly rate
   * dominates at qty 500 (favouring the cheapest). Defaults to 1 — the
   * conservative reading, and the one that matters for a first quote.
   */
  quantity?: number;
}

export async function analyzeCadFile(file: CadFileInput, opts: AnalyzeOptions = {}): Promise<ExtractedCadAnalysis> {
  const fileName = file.name || 'part.step';
  const solidFormat = solidFormatFor(fileName) ?? (file.fileType === 'STEP' ? 'step' : null);
  const isPdf = /\.pdf$/i.test(fileName) || file.fileType === 'PDF';
  const isImage = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(fileName) || file.fileType === 'IMAGE';

  if (solidFormat) {
    return analyzeSolid(file, fileName, solidFormat, opts);
  }

  if (isPdf || isImage) {
    return analyzeDrawing(file, fileName, isPdf ? 'PDF' : 'IMAGE');
  }

  // DXF / unknown — we can't reliably measure this here; ask the user to confirm.
  return manualAnalysis(fileName, 'DXF', file.pdfUrl);
}

// ---------------------------------------------------------------------------
// 3D solids: STEP / IGES / BREP
// ---------------------------------------------------------------------------

async function analyzeSolid(
  file: CadFileInput,
  fileName: string,
  format: 'step' | 'iges' | 'brep',
  opts: AnalyzeOptions = {}
): Promise<ExtractedCadAnalysis> {
  // STEP is ASCII, so we can also mine topology (holes/bends/material) from the text.
  let stepResult: StepParseResult | null = null;
  if (format === 'step') {
    let text = file.content || '';
    if (!text && file.buffer) text = new TextDecoder('utf-8').decode(file.buffer);
    stepResult = parseStepFile(text, fileName);
  }

  // Default when the STEP carries no material callout. This is a CNC machining
  // shop that runs mostly aluminium, so an unlabelled solid defaults to aluminium
  // (matching the AI-drawing path) rather than steel — costing an aluminium part
  // as steel roughly triples every cutting time. Always user-editable on Extract.
  const materialName = stepResult?.estimatedMaterialName || 'Aluminium 6082';
  const density = densityFor(materialName);

  // Ask the optional Python geometry service for the exact B-Rep turned profile
  // (OD steps, bore, grooves, cross features) + rotational-symmetry verdict. Falls
  // back to the built-in mesh approximation below when the service isn't running.
  let svc: GeometryResult | null = null;
  if (format === 'step' && (file.base64 || file.buffer)) {
    const b64 = file.base64 ?? (file.buffer ? arrayBufferToBase64(file.buffer) : '');
    svc = await extractTurnedProfile(b64, fileName);
  }

  // Measure exact geometry from the tessellated solid when we have the bytes.
  let mesh: TessellatedMesh | undefined;
  let meas: MeshMeasurements | undefined;
  if (file.buffer) {
    const tessellated = await tessellateCad(file.buffer, format);
    if (tessellated) {
      mesh = tessellated;
      meas = measureMesh(tessellated);
    }
  }

  if (meas && mesh) {
    // Prefer the geometry service's exact B-Rep volume/area when available.
    const useSvc = !!(svc && svc.ok);
    const volumeCm3 = useSvc ? svc!.measured.volumeCm3 : meas.volumeCm3;
    const surfaceAreaCm2 = useSvc ? svc!.measured.surfaceAreaCm2 : meas.surfaceAreaCm2;
    // 2 dp of a KILOGRAM is 10 grams, so anything under ~5 g rounded to zero and
    // the field read "0" on a small turned part. Precision costs nothing here.
    const weightKg = round((volumeCm3 * density) / 1000, 5);
    // 3 dp of a square METRE is 1000 mm², so a small turned part rounded to
    // zero and the field read "0". Keep enough digits that a 5 g part is still
    // a number; the UI shows cm²/g alongside so the value is legible at all.
    const surfaceAreaM2 = round(surfaceAreaCm2 / 10000, 6);
    const stepData = solidStepData(fileName, meas, stepResult);

    // Prefer holes and bends detected geometrically from the B-Rep faces — far more
    // reliable than counting STEP CIRCLE/PLANE entities, which also catch annotation
    // arcs, convex rounds and machining fillets. Fall back to text only if geometry fails.
    const geo = mesh.features;
    const holeCount = geo ? geo.holeCount : stepData.holeCount;
    const holeDetails = geo ? geo.holeDetails : stepData.holeDetails;
    const boreCount = geo ? geo.boreCount : 0;
    const bendCount = geo ? geo.bendCount : stepData.bendCount;
    const isSimpleBending = bendCount <= 4;
    stepData.holeCount = holeCount;
    stepData.holeDetails = holeDetails;
    stepData.bendCount = bendCount;
    stepData.isSimpleBending = isSimpleBending;

    // Perimeter (laser concept) = measured outline + hole circumferences. Recompute
    // from measured geometry; the text parser's value can be corrupted by PMI.
    const outerPerimeter = 2 * (meas.lengthMm + meas.widthMm);
    const holePerimeter = holeDetails.reduce((s, h) => s + Math.PI * h.diameterMm * h.count, 0);
    const perimeterMm = Math.round(outerPerimeter + holePerimeter);
    const pierceCount = holeCount + boreCount + 1;
    stepData.perimeterMm = perimeterMm;
    stepData.pierceCount = pierceCount;
    stepData.bounds = {
      minX: 0, maxX: meas.boundingBoxMm.x,
      minY: 0, maxY: meas.boundingBoxMm.y,
      minZ: 0, maxZ: meas.boundingBoxMm.z,
    };

    const holeSummary = holeDetails.length
      ? holeDetails.map((h) => `${h.count}×⌀${h.diameterMm}`).join(', ')
      : 'none';

    // Measure effective material thickness from the solid (mean wall = 2·V/S) rather
    // than assuming a value. For a plate/sheet this equals the gauge; for a chunky
    // part it's the honest effective thickness. Falls back only if area is unusable.
    const meanWallMm = surfaceAreaCm2 > 0 ? (20 * volumeCm3) / surfaceAreaCm2 : 0;
    const thicknessMm = meanWallMm > 0
      ? Math.round(Math.min(60, Math.max(0.4, meanWallMm)) * 10) / 10
      : (meas.heightMm < 12 ? Math.max(1.5, meas.heightMm) : 3.0);

    // Turned PROFILE + rotational-symmetry verdict. Prefer the geometry service's
    // exact B-Rep extraction (OD steps, bore, grooves, cross features); otherwise
    // approximate from the bounding box + detected holes.
    let isTurned: boolean;
    let partClass: PartClass;
    let diameterMm: number;
    let axisLengthMm: number;
    let pcConfidence: number;
    let pcReason: string;
    let crossFeatures: boolean;
    let turningProfile: TurningProfile;
    let profileSource: 'brep-service' | 'approximation';

    if (useSvc) {
      const p = svc!.profile;
      isTurned = svc!.is_turned;
      partClass = isTurned ? 'turned' : 'milled';
      diameterMm = p.odMm;
      axisLengthMm = p.lengthMm;
      pcConfidence = svc!.confidence;
      pcReason = svc!.reason;
      crossFeatures = p.crossFeatures;
      turningProfile = {
        odMm: p.odMm, lengthMm: p.lengthMm,
        boreDiaMm: p.boreDiaMm, boreDepthMm: p.boreDepthMm,
        grooveCount: p.grooveCount, threadCount: p.threadCount,
        faceCount: p.faceCount || 2, crossFeatures: p.crossFeatures,
        // The service reports each off-axis feature as a 'cross' segment with a
        // measured radius. Carrying the sizes through lets the plan say what the
        // second operation is actually for.
        crossFeatureDiametersMm: (svc!.segments ?? [])
          .filter((sg) => sg.type === 'cross')
          .map((sg) => Math.round(sg.radiusMm * 2 * 100) / 100),
      };
      profileSource = 'brep-service';
    } else {
      const pc = classifyPart({
        lengthMm: meas.lengthMm, widthMm: meas.widthMm, heightMm: meas.heightMm, volumeCm3,
      });
      partClass = pc.partClass;
      isTurned = pc.partClass === 'turned';
      diameterMm = pc.diameterMm;
      axisLengthMm = pc.axisLengthMm;
      pcConfidence = pc.confidence;
      pcReason = pc.reason;
      // Approximate the profile: largest hole = central bore; others = cross features.
      const sortedHoles = [...holeDetails].sort((a, b) => b.diameterMm - a.diameterMm);
      const bore = sortedHoles[0];
      const otherHoleCount = sortedHoles.slice(1).reduce((s, h) => s + h.count, 0)
        + (bore ? Math.max(0, bore.count - 1) : 0);
      crossFeatures = otherHoleCount > 0;
      turningProfile = {
        odMm: pc.diameterMm,
        lengthMm: pc.axisLengthMm,
        boreDiaMm: bore && bore.diameterMm < pc.diameterMm * 0.85 ? bore.diameterMm : 0,
        boreDepthMm: bore && bore.diameterMm < pc.diameterMm * 0.85 ? Math.round(pc.axisLengthMm * 0.8) : 0,
        grooveCount: 0, threadCount: 0, faceCount: 2, crossFeatures,
      };
      profileSource = 'approximation';
    }

    const machinability = materialPropsFor(materialName).machinability;

    // Milled/prismatic profile (the 3 AAG rules: setups from access-direction
    // clustering, pockets/bosses from edge concavity, deep-pocket reach). Built
    // from the geometry service when available; otherwise a bbox-billet approximation.
    let milledProfile: MilledProfile | undefined;
    if (!isTurned) {
      if (useSvc && svc!.milled) {
        const mm = svc!.milled;
        // Bill from a purchasable billet (allowance + standard plate), not the
        // raw bounding box — you cannot buy stock machined to the part's exact size.
        const billet = milledBilletMm(mm.stockMm);
        const billetVolCm3 = (billet.x * billet.y * billet.z) / 1000;
        const partVolCm3 = mm.partVolumeCm3 || volumeCm3;
        milledProfile = {
          stockMm: billet,
          stockVolumeCm3: Math.round(billetVolCm3 * 10) / 10,
          partVolumeCm3: partVolCm3,
          removedVolumeCm3: Math.round(Math.max(0, billetVolCm3 - partVolCm3) * 10) / 10,
          surfaceAreaCm2,
          setupCount: mm.setupCount,
          pocketCount: mm.pocketCount,
          bossCount: mm.bossCount,
          deepPocketCount: mm.deepPocketCount,
          holeCount: mm.holeCount,
          holeDiametersMm: mm.holeDiametersMm,
          sparseBillet: mm.sparseBillet,
          angledSetups: mm.angledSetups,
          axisAlignedSetups: mm.axisAlignedSetups,
          angledToolAxisDegs: (mm.angledToolAxes ?? []).map((a) => a.offAxisDeg),
          partialBoreDiametersMm: mm.partialBoreDiametersMm,
          steppedHoleCount: mm.steppedHoleCount,
          roundBossDiametersMm: mm.roundBossDiametersMm,
          // Conical work, measured rather than assumed. Drill points are
          // deliberately not carried through: the drill already paid for them.
          countersinks: mm.countersinks,
          chamfers: mm.chamfers,
          tapers: mm.tapers,
          turnedFeatures: (mm.turnedFeatures ?? []).map((f) => ({
            kind: f.kind, diameterMm: f.diameterMm, lengthMm: f.lengthMm ?? 0,
          })),
          facingCandidates: mm.facingCandidates,
        };
        // A contoured part is re-clamped to finish curved faces from more angles
        // than its geometric access-direction count — floor the setups upward.
        milledProfile.setupCount = contouredSetupCount(mm.setupCount, milledProfile);
      } else {
        // Approximation: billet = bbox + allowance on standard plate; setups guessed.
        const billet = milledBilletMm({ x: meas.lengthMm, y: meas.widthMm, z: meas.heightMm });
        const stockVolMm = (billet.x * billet.y * billet.z) / 1000;
        milledProfile = {
          stockMm: billet,
          stockVolumeCm3: Math.round(stockVolMm * 10) / 10,
          partVolumeCm3: volumeCm3,
          removedVolumeCm3: Math.round(Math.max(0, stockVolMm - volumeCm3) * 10) / 10,
          surfaceAreaCm2,
          setupCount: Math.min(3, 1 + (holeCount > 0 ? 1 : 0) + (bendCount > 0 ? 1 : 0)),
          pocketCount: 0,
          bossCount: 0,
          deepPocketCount: 0,
          holeCount,
          sparseBillet: stockVolMm > 0 && (stockVolMm - volumeCm3) / stockVolMm > 0.85,
        };
      }
    }
    // A part that fills only a small fraction of its bounding box is not made
    // from a solid billet — the solid-billet cost is an upper bound, not a quote.
    // (Refreshed after the mill-turn transform below, which clears it for bar stock.)
    let sparseBillet = !!milledProfile?.sparseBillet;

    // Setups: single op for a plain turned part; a second op (back-face /
    // turn-around) when off-axis features exist. Milled parts use the access-
    // direction count from the geometry analysis. (Refreshed after a mill-turn
    // transform collapses them to what a turn-mill actually needs.)
    let setups = milledProfile ? Math.max(1, milledProfile.setupCount) : (crossFeatures ? 2 : 1);

    // Stock (next standard bar) and material yield (buy-to-fly).
    const { barDiameterMm, stockVolumeCm3: stockVol } = computeStock(turningProfile, DEFAULT_CNC_SETTINGS);
    const removedVol = Math.max(0, stockVol - volumeCm3);
    const buyToFlyRatio = stockVol > 0 ? Math.round((volumeCm3 / stockVol) * 100) / 100 : 0;

    // Machine selection — the most efficient machine (sliding-head / 2-axis /
    // turn-mill / mill) that can make this part, and why. For a milled part we
    // also pass the measured box + volume so it can test round-bar fit and route
    // suitable parts to a turn-mill (round bar, one op) among the shop's machines.
    const machineRecommendation = selectMachine({
      isTurned,
      odMm: diameterMm,
      barDiameterMm,
      lengthMm: axisLengthMm,
      crossFeatures,
      setupCount: milledProfile?.setupCount,
      angledSetups: milledProfile?.angledSetups,
      // The part's access DEMAND, split so each machine can answer it with its
      // own kinematics: a compound angle is free on 5 axes and a fixture on 3.
      axisAlignedSetups: milledProfile?.axisAlignedSetups,
      quantity: opts.quantity,
      economics: {
        setupRatePerMin: DEFAULT_CNC_SETTINGS.setupRatePerMin,
        setupFirstOpMin: DEFAULT_CNC_SETTINGS.millSetupFirstOpMin ?? 60,
        setupPerExtraOpMin: DEFAULT_CNC_SETTINGS.millSetupPerExtraOpMin ?? 45,
        programmingMinPerSetup: DEFAULT_CNC_SETTINGS.programmingMinPerSetup ?? 25,
        flatChargePerSetup: DEFAULT_CNC_SETTINGS.flatSetupChargePerSetup ?? 0,
      },
      pocketCount: milledProfile?.pocketCount,
      bossCount: milledProfile?.bossCount,
      partDimsMm: { x: meas.lengthMm, y: meas.widthMm, z: meas.heightMm },
      partVolumeCm3: volumeCm3,
      // Coaxial round features are the evidence that a prismatic-looking part is
      // really chucking work — without them a hollowed block reads as "round".
      onAxisTurnedFeatures: milledProfile?.turnedFeatures?.length,
      ownedMachines: opts.machines,
    });

    // TURNED vs MILLED: the same coaxial bore exists whichever machine makes it,
    // but only a spindle can TURN it. What decides is whether the chosen machine
    // HAS a spindle that can — not what the stock is called.
    //
    // Keying this off `route === 'mill-turn'` was wrong, and quietly so: when a
    // prismatic part is routed to a mill-turn for soft-jaw milling the route is
    // 'mill', so the turning model switched off and the machine's own ⌀30 bore
    // came out as "bore / interpolate" — a lathe being driven like a VMC. The
    // machine's kind is the honest test.
    const chosenSpec = MACHINE_CATALOG[machineRecommendation.recommended];
    const spindleCanTurn = !!chosenSpec && chosenSpec.kind !== 'mill';
    if (milledProfile && spindleCanTurn && (milledProfile.turnedFeatures?.length ?? 0) > 0) {
      milledProfile = { ...milledProfile, turningRoute: true };
    }

    // MILL-TURN: when the chosen route runs from round bar, re-express the milled
    // profile as bar stock (⌀ + length) with collapsed setups. This is what makes
    // a round-ish part priced as "round bar, all faces in one op" rather than
    // hogged out of a rectangular billet on a machining centre.
    if (
      milledProfile &&
      machineRecommendation.route === 'mill-turn' &&
      machineRecommendation.barDiameterMm
    ) {
      milledProfile = toBarStockProfile(
        milledProfile,
        machineRecommendation.barDiameterMm,
        machineRecommendation.effectiveSetups ?? 1,
        DEFAULT_CNC_SETTINGS
      );
      // Bar is the right stock now: setups collapse and the sparse-billet warning
      // (which only applied to hogging a solid block) no longer holds.
      setups = Math.max(1, milledProfile.setupCount);
      sparseBillet = false;
    } else if (milledProfile && machineRecommendation.effectiveSetups != null) {
      // SETUPS BELONG TO THE (PART, MACHINE) PAIR, not to the part. The geometry
      // service counts tool-access DIRECTIONS — what the part demands — and the
      // selected machine turns that into physical clamps with its own kinematics:
      // six directions are six re-fixtures on a 3-axis, three on a 4-axis, two on
      // a 5-axis mill-turn holding it in soft jaws. Pricing the direction count
      // regardless of machine is what made a 5-setup VMC plan out of a job the
      // shop's mill-turn does in two.
      milledProfile = {
        ...milledProfile,
        setupCount: Math.max(1, Math.round(machineRecommendation.effectiveSetups)),
      };
      setups = milledProfile.setupCount;
    }

    // Sheet-metal concepts don't apply to machined parts.
    const formedPart = false;

    // Advisory DFM for turning (only meaningful for a turned part).
    const dfm = isTurned
      ? analyzeCncDfm({
          partClass: 'turned',
          thicknessMm,
          boundingBoxMm: { lengthMm: meas.lengthMm, widthMm: meas.widthMm, heightMm: meas.heightMm },
          diameterMm,
          axisLengthMm,
          holeDetails,
          buyToFlyRatio,
          setups,
          crossFeatures,
          boreDiaMm: turningProfile.boreDiaMm,
          boreDepthMm: turningProfile.boreDepthMm,
          maxDrillDiaMm: DEFAULT_CNC_SETTINGS.maxDrillDiaMm,
          tolerances: 'Standard ISO 2768-m (±0.2mm)',
          hasGeometry: !!geo,
        })
      : undefined;

    // Informational only — milled parts are now costed on the prismatic route,
    // not treated as out of scope.
    const notRotationalReason = isTurned ? undefined : pcReason;

    // Milled confidence: prefer the geometry service's, else a moderate default.
    const milledConfidence = useSvc && svc!.milled ? svc!.milled.confidence : 0.5;

    return {
      partName: baseName(fileName),
      fileType: 'STEP',
      fileName,
      materialName,
      thicknessMm,
      lengthMm: meas.lengthMm,
      widthMm: meas.widthMm,
      heightMm: meas.heightMm,
      perimeterMm,
      pierceCount,
      bendCount,
      isSimpleBending,
      holeCount,
      holeDetails,
      weldLengthMm: stepData.weldLengthMm,
      weldCount: stepData.weldCount,
      weightKg,
      surfaceAreaM2,
      finishCallout: 'Deburr & De-grease',
      tolerances: 'Standard ISO 2768-m (±0.2mm)',
      aiNotes: isTurned
        ? [
            `Measured directly from the solid — bounding box ${meas.lengthMm} × ${meas.widthMm} × ${meas.heightMm} mm.`,
            profileSource === 'brep-service'
              ? `Turned profile read from the B-Rep geometry service: ⌀${diameterMm} × ${axisLengthMm} mm (${Math.round(pcConfidence * 100)}% confidence). ${pcReason}`
              : `Classified as a TURNED part: ⌀${diameterMm} × ${axisLengthMm} mm (${Math.round(pcConfidence * 100)}% confidence, bbox approximation). ${pcReason}`,
            `Stock: ⌀${barDiameterMm} bar (next standard size) — ${stockVol.toFixed(1)} cm³, ${removedVol.toFixed(1)} cm³ removed (material yield ${Math.round(buyToFlyRatio * 100)}%). ${materialName}, machinability ${machinability}× medium-carbon steel.`,
            turningProfile.boreDiaMm > 0
              ? `Central bore ⌀${turningProfile.boreDiaMm} × ${turningProfile.boreDepthMm} mm → drill + bore.`
              : `Solid part — no central bore detected.`,
            crossFeatures
              ? `Off-axis feature(s) detected — flagged as requiring a second op / live tooling and NOT included in the cycle-time estimate.`
              : `No off-axis features detected.`,
            `Estimates cycle time only — this does not generate toolpaths (your CAM stays in place).`,
          ]
        : [
            `Measured directly from the solid — bounding box ${meas.lengthMm} × ${meas.widthMm} × ${meas.heightMm} mm.`,
            profileSource === 'brep-service'
              ? `Prismatic / MILLED part (${Math.round(milledConfidence * 100)}% confidence). ${pcReason}`
              : `Prismatic / MILLED part (bbox approximation). ${pcReason}`,
            milledProfile
              ? milledProfile.fromBarStock
                ? `Round bar ⌀${milledProfile.barDiameterMm} × ${Math.round(Math.max(milledProfile.stockMm.x, milledProfile.stockMm.y, milledProfile.stockMm.z))} mm on a turn-mill — ${milledProfile.removedVolumeCm3.toFixed(1)} cm³ removed (yield ${Math.round((milledProfile.partVolumeCm3 / Math.max(0.01, milledProfile.stockVolumeCm3)) * 100)}%). Turned to profile + driven-tool milling in ${setups === 1 ? 'one clamp' : `${setups} clamps`}.`
                : `Billet ${milledProfile.stockMm.x}×${milledProfile.stockMm.y}×${milledProfile.stockMm.z} mm — ${milledProfile.removedVolumeCm3.toFixed(1)} cm³ removed (yield ${Math.round((milledProfile.partVolumeCm3 / Math.max(0.01, milledProfile.stockVolumeCm3)) * 100)}%).`
              : '',
            milledProfile
              ? `${setups} setup${setups === 1 ? '' : 's'} (distinct tool-access directions), ${milledProfile.pocketCount} pocket${milledProfile.pocketCount === 1 ? '' : 's'}${milledProfile.deepPocketCount > 0 ? ` (${milledProfile.deepPocketCount} deep)` : ''}, ${milledProfile.holeCount} hole${milledProfile.holeCount === 1 ? '' : 's'}. Setups are the biggest cost lever.`
              : '',
            (milledProfile?.angledSetups ?? 0) > 0
              ? `⚠️ COMPOUND-ANGLE WORK: ${milledProfile!.angledSetups} hole/bore axis/axes sit ${(milledProfile!.angledToolAxisDegs ?? []).map((d) => `${Math.round(d)}°`).join(', ')} off a stock face. A hole can only be cut along its own axis, so reaching one tilted in two planes takes two rotations. ${
                  MACHINE_CATALOG[machineRecommendation.recommended]?.axes >= 5
                    ? `The ${machineRecommendation.recommendedName} tilts its head to them in-cycle, so they cost NO extra setups here — that capability is why it was chosen over a cheaper machine.`
                    : `The ${machineRecommendation.recommendedName} cannot reach them in one rotation, so each is priced with its own tilted fixture. A 5-axis machine would absorb them; CONFIRM how these are held before sending.`
                }`
              : '',
            (milledProfile?.partialBoreDiametersMm?.length ?? 0) > 0
              ? `${milledProfile!.partialBoreDiametersMm!.length} open/partial circular feature(s) (⌀${milledProfile!.partialBoreDiametersMm!.map((d) => d.toFixed(1)).join(', ⌀')} mm) are milled by interpolation rather than drilled.`
              : '',
            sparseBillet
              ? `⚠️ The part fills only ${Math.round((milledProfile!.partVolumeCm3 / Math.max(0.01, milledProfile!.stockVolumeCm3)) * 100)}% of its bounding box — machining it from a solid billet would hog away ${milledProfile!.removedVolumeCm3.toFixed(0)} cm³. Real stock is almost certainly plate / a weldment / a near-net casting or forging; this price is an UPPER BOUND and needs review.`
              : '',
            `Estimates cost and cycle time only — this does not generate toolpaths (your CAM stays in place).`,
          ].filter(Boolean),
      confidenceScore: isTurned
        ? (crossFeatures ? 70 : Math.round(70 + pcConfidence * 28))
        : sparseBillet ? 25 : Math.round(45 + milledConfidence * 40),
      stepData,
      // In memory only (stripped by stripCadForStorage) — lets the face-coverage
      // audit re-request its mesh without asking for the file again.
      fileBase64: file.base64 ?? (file.buffer ? arrayBufferToBase64(file.buffer) : undefined),
      stepMesh: mesh,
      measurementSource: 'solid',
      featuresNeedReview: isTurned
        ? crossFeatures
        : (sparseBillet || profileSource !== 'brep-service' || (milledProfile?.deepPocketCount ?? 0) > 0 || setups >= 3),
      formedPart,
      dfm,
      partClass,
      machineClass: isTurned ? 'turn' : 'mill',
      isTurned,
      notRotationalReason,
      turningProfile,
      milledProfile,
      machineRecommendation,
      diameterMm,
      axisLengthMm,
      volumeCm3,
      surfaceAreaCm2,
      stockVolumeCm3: Math.round(stockVol * 10) / 10,
      removedVolumeCm3: Math.round(removedVol * 10) / 10,
      barDiameterMm,
      buyToFlyRatio,
      setups,
      crossFeatures,
    };
  }

  // Geometry service down AND the solid wouldn't tessellate in-browser → last
  // automated resort before manual entry: read the STEP text with AI. This is an
  // estimate (fromAiData flags it 'ai-drawing' + a verify note), never mistaken
  // for the exact OCP measurement, but far better than fabricated defaults.
  if (format === 'step') {
    let stepText = file.content || '';
    if (!stepText && file.buffer) stepText = new TextDecoder('utf-8').decode(file.buffer);
    if (stepText.trim()) {
      const ai = await analyzeDrawingWithAI({ fileName, stepText });
      if (ai) return fromAiData(fileName, 'STEP', ai, file.pdfUrl);
    }
  }

  // Couldn't tessellate. STEP text still gives a usable estimate; other formats can't.
  if (stepResult) {
    const weightKg = round((stepResult.volumeCm3 * density) / 1000, 2) || 1.85;
    const surfaceAreaM2 = round(stepResult.surfaceAreaCm2 / 10000, 3) || 0.18;
    return {
      partName: baseName(fileName),
      fileType: 'STEP',
      fileName,
      materialName,
      thicknessMm: stepResult.heightMm < 12 ? Math.max(1.5, stepResult.heightMm) : 3.0,
      lengthMm: stepResult.lengthMm,
      widthMm: stepResult.widthMm,
      heightMm: stepResult.heightMm,
      perimeterMm: stepResult.perimeterMm,
      pierceCount: stepResult.pierceCount,
      bendCount: stepResult.bendCount,
      isSimpleBending: stepResult.isSimpleBending,
      holeCount: stepResult.holeCount,
      holeDetails: stepResult.holeDetails,
      weldLengthMm: stepResult.weldLengthMm,
      weldCount: stepResult.weldCount,
      weightKg,
      surfaceAreaM2,
      finishCallout: 'Deburr & De-grease',
      tolerances: 'Standard ISO 2768-m (±0.2mm)',
      aiNotes: [
        `Estimated bounding box from B-Rep control points: ${stepResult.lengthMm} × ${stepResult.widthMm} × ${stepResult.heightMm} mm.`,
        `Approximate volume ${stepResult.volumeCm3} cm³ → weight ${weightKg} kg. Verify before quoting.`,
        `Identified ${stepResult.holeCount} holes and ${stepResult.bendCount} bends from topology.`,
      ],
      confidenceScore: 90,
      stepData: stepResult,
      measurementSource: 'estimated',
    };
  }

  return manualAnalysis(fileName, 'STEP', file.pdfUrl);
}

/** Builds a StepParseResult-shaped object from measurements (+ optional real topology). */
function solidStepData(
  fileName: string,
  meas: MeshMeasurements,
  base: StepParseResult | null
): StepParseResult {
  return {
    fileName,
    schema: base?.schema ?? 'AP214',
    originatingSystem: base?.originatingSystem ?? 'CAD',
    author: base?.author ?? 'Unknown',
    timestamp: base?.timestamp ?? '',
    unit: 'mm',
    unitScale: 1,
    lengthMm: meas.lengthMm,
    widthMm: meas.widthMm,
    heightMm: meas.heightMm,
    volumeCm3: meas.volumeCm3,
    surfaceAreaCm2: meas.surfaceAreaCm2,
    cartesianPointCount: base?.cartesianPointCount ?? 0,
    faceCount: base?.faceCount ?? 0,
    planeCount: base?.planeCount ?? 0,
    cylindricalSurfaceCount: base?.cylindricalSurfaceCount ?? 0,
    holeCount: base?.holeCount ?? 0,
    holeDetails: base?.holeDetails ?? [],
    bendCount: base?.bendCount ?? 0,
    isSimpleBending: base?.isSimpleBending ?? true,
    perimeterMm: base?.perimeterMm ?? Math.round(2 * (meas.lengthMm + meas.widthMm)),
    pierceCount: base?.pierceCount ?? 0,
    weldLengthMm: base?.weldLengthMm ?? 0,
    weldCount: base?.weldCount ?? 0,
    estimatedMaterialName: base?.estimatedMaterialName,
    meshPoints: [],
    bounds: {
      minX: 0,
      maxX: meas.boundingBoxMm.x,
      minY: 0,
      maxY: meas.boundingBoxMm.y,
      minZ: 0,
      maxZ: meas.boundingBoxMm.z,
    },
  };
}

// ---------------------------------------------------------------------------
// 2D drawings: PDF / images
// ---------------------------------------------------------------------------

async function analyzeDrawing(
  file: CadFileInput,
  fileName: string,
  fileType: 'PDF' | 'IMAGE'
): Promise<ExtractedCadAnalysis> {
  // 1. Real extraction: read the drawing's dimensions with the AI vision endpoint.
  if (file.base64 && file.mimeType) {
    const data = await analyzeDrawingWithAI({
      fileName,
      fileBase64: file.base64,
      mimeType: file.mimeType,
    });
    if (data) return fromAiData(fileName, fileType, data, file.pdfUrl);
  }

  // 2. No AI vision available and we can't reliably read dimensions off a drawing
  // here. Be honest — route to manual confirmation rather than inventing numbers.
  // (A folded/thin part is best quoted from its STEP solid or a flat-pattern DXF.)
  return manualAnalysis(fileName, fileType, file.pdfUrl);
}

const AI_VERIFY_NOTE =
  'Dimensions read from the 2D drawing by AI vision — an estimate, not a measured solid. Verify before quoting.';
const AI_STEP_VERIFY_NOTE =
  'The exact geometry service was unavailable, so this 3D part was read from the STEP by AI — an estimate, not an exact measurement. Start services/geometry and re-run for a measured quote; verify before quoting.';

/**
 * Map a vision-model drawing response onto a MACHINING analysis: a turned or
 * milled profile the CNC estimator can price, not the legacy sheet-metal fields.
 * A 2D drawing gives us the drawing's stated dimensions but no measured solid, so
 * volumes are derived from those dimensions and everything is flagged for review.
 * Exported for tests (deterministic; no network).
 */
export function fromAiData(
  fileName: string,
  fileType: 'PDF' | 'IMAGE' | 'STEP',
  d: AiDrawingData,
  pdfUrl?: string
): ExtractedCadAnalysis {
  const materialName = d.materialName || 'Aluminium 6082';
  const density = materialPropsFor(materialName).densityGCm3;
  const cnc = DEFAULT_CNC_SETTINGS;
  const notes = d.aiNotes && d.aiNotes.length ? d.aiNotes : [];
  const tolerances = d.toleranceCallout || d.tolerances;
  const verifyNote = fileType === 'STEP' ? AI_STEP_VERIFY_NOTE : AI_VERIFY_NOTE;

  const base = {
    partName: d.partName || baseName(fileName),
    fileType,
    fileName,
    materialName,
    thicknessMm: 0,
    perimeterMm: 0,
    pierceCount: 0,
    bendCount: 0,
    isSimpleBending: true,
    weldLengthMm: 0,
    weldCount: 0,
    finishCallout: d.finishCallout,
    tolerances,
    aiNotes: [verifyNote, ...notes],
    confidenceScore: d.confidenceScore ?? 55,
    measurementSource: 'ai-drawing' as MeasurementSource,
    pdfUrl,
  };

  const turned = d.turned || undefined;
  const milled = d.milled || undefined;

  // ---- TURNED: rotationally-symmetric part read from a shaft/bushing drawing ----
  if (d.partClass === 'turned' && turned && (turned.odMm ?? 0) > 0 && (turned.lengthMm ?? 0) > 0) {
    const od = turned.odMm!;
    const len = turned.lengthMm!;
    const boreDia = Math.max(0, turned.boreDiaMm ?? 0);
    const boreDepth = Math.max(0, turned.boreDepthMm ?? 0);
    const turningProfile: TurningProfile = {
      odMm: od,
      lengthMm: len,
      boreDiaMm: boreDia,
      boreDepthMm: boreDepth,
      grooveCount: Math.max(0, turned.grooveCount ?? 0),
      threadCount: Math.max(0, turned.threadCount ?? 0),
      faceCount: Math.min(2, Math.max(1, turned.faceCount ?? 2)),
      crossFeatures: false,
    };
    // Finished volume: solid cylinder minus the bore.
    const cylMm3 = (Math.PI / 4) * od * od * len;
    const boreMm3 = boreDia > 0 && boreDepth > 0 ? (Math.PI / 4) * boreDia * boreDia * boreDepth : 0;
    const volumeCm3 = Math.max(0.01, (cylMm3 - boreMm3) / 1000);
    const weightKg = d.weightKg && d.weightKg > 0 ? d.weightKg : (volumeCm3 * density) / 1000;
    const barDiameterMm = nextStandardBar(od + 2 * cnc.radialStockAllowanceMm);

    return {
      ...base,
      lengthMm: round(len, 2),
      widthMm: round(od, 2),
      heightMm: round(od, 2),
      holeCount: boreDia > 0 ? 1 : 0,
      holeDetails: boreDia > 0 ? [{ diameterMm: boreDia, count: 1 }] : [],
      weightKg: round(weightKg, 5),
      surfaceAreaM2: 0,
      partClass: 'turned',
      machineClass: 'turn',
      isTurned: true,
      turningProfile,
      barDiameterMm,
      diameterMm: round(od, 2),
      axisLengthMm: round(len, 2),
      volumeCm3: round(volumeCm3, 2),
      setups: 1,
    };
  }

  // ---- MILLED (or "unknown" with a usable bounding box) ----
  const L = milled?.lengthMm ?? d.lengthMm ?? 0;
  const W = milled?.widthMm ?? d.widthMm ?? 0;
  const H = milled?.heightMm ?? d.heightMm ?? 0;
  if (L > 0 && W > 0 && H > 0) {
    const billet = milledBilletMm({ x: L, y: W, z: H });
    const stockVolCm3 = (billet.x * billet.y * billet.z) / 1000;
    // Part volume from the stated weight if we have it, else a rough fraction of the
    // billet (a drawing does not give the true solid volume) — flagged for review.
    const partVolCm3 =
      d.weightKg && d.weightKg > 0
        ? Math.min(stockVolCm3, (d.weightKg * 1000) / density)
        : stockVolCm3 * 0.6;
    const removedVolCm3 = Math.max(0, stockVolCm3 - partVolCm3);
    const surfaceAreaCm2 = (2 * (L * W + L * H + W * H)) / 100; // bbox proxy
    const holeDetails = milled?.holeDetails ?? d.holeDetails ?? [];
    const holeCount = milled?.holeCount ?? holeDetails.reduce((a, h) => a + (h.count || 0), 0);
    const milledProfile: MilledProfile = {
      stockMm: billet,
      stockVolumeCm3: round(stockVolCm3, 1),
      partVolumeCm3: round(partVolCm3, 1),
      removedVolumeCm3: round(removedVolCm3, 1),
      surfaceAreaCm2: round(surfaceAreaCm2, 1),
      setupCount: Math.min(6, Math.max(1, milled?.setupCount ?? 1)),
      pocketCount: Math.max(0, milled?.pocketCount ?? 0),
      bossCount: Math.max(0, milled?.bossCount ?? 0),
      deepPocketCount: 0,
      holeCount,
      // Expand the drawing's hole schedule into one diameter per hole.
      holeDiametersMm: holeDetails.flatMap((h) => Array(Math.max(0, h.count || 0)).fill(h.diameterMm)),
      sparseBillet: stockVolCm3 > 0 && removedVolCm3 / stockVolCm3 > 0.85,
    };
    const weightKg = d.weightKg && d.weightKg > 0 ? d.weightKg : (partVolCm3 * density) / 1000;

    return {
      ...base,
      lengthMm: round(L, 2),
      widthMm: round(W, 2),
      heightMm: round(H, 2),
      holeCount,
      holeDetails,
      weightKg: round(weightKg, 3),
      surfaceAreaM2: round(surfaceAreaCm2 / 10000, 3),
      partClass: 'milled',
      machineClass: 'mill',
      isTurned: false,
      milledProfile,
      volumeCm3: round(partVolCm3, 2),
      surfaceAreaCm2: round(surfaceAreaCm2, 1),
      stockVolumeCm3: round(stockVolCm3, 1),
      removedVolumeCm3: round(removedVolCm3, 1),
      setups: milledProfile.setupCount,
    };
  }

  // ---- Not enough read off the drawing to machine-cost it → manual entry. ----
  return {
    ...base,
    lengthMm: 0,
    widthMm: 0,
    heightMm: 0,
    holeCount: 0,
    holeDetails: [],
    weightKg: 0,
    surfaceAreaM2: 0,
    confidenceScore: 0,
    aiNotes: [
      'AI vision could not read enough of this drawing to size the part.',
      'Enter or confirm the dimensions on the right before quoting.',
      ...notes,
    ],
  };
}

// ---------------------------------------------------------------------------
// Honest fallback: no fabricated numbers
// ---------------------------------------------------------------------------

function manualAnalysis(
  fileName: string,
  fileType: ExtractedCadAnalysis['fileType'],
  pdfUrl?: string
): ExtractedCadAnalysis {
  return {
    partName: baseName(fileName),
    fileType,
    fileName,
    materialName: 'Aluminium 6082',
    thicknessMm: 3.0,
    lengthMm: 0,
    widthMm: 0,
    heightMm: 0,
    perimeterMm: 0,
    pierceCount: 0,
    bendCount: 0,
    isSimpleBending: true,
    holeCount: 0,
    holeDetails: [],
    weldLengthMm: 0,
    weldCount: 0,
    weightKg: 0,
    surfaceAreaM2: 0,
    aiNotes: [
      'We could not automatically measure this file.',
      'Enter or confirm the dimensions on the right before quoting.',
    ],
    confidenceScore: 0,
    measurementSource: 'manual',
    pdfUrl,
  };
}
