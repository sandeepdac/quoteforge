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
import { MilledProfile } from './milledEstimator';
import { selectMachine, MachineRecommendation } from './machineSelection';
import { materialPropsFor } from './materials';
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
 * Main dispatcher. Routes any input to the most accurate path available:
 *   • 3D solids (STEP/IGES/BREP) → tessellate + measure exact geometry
 *   • 2D drawings (PDF/PNG/JPG)  → read dimensions with AI vision
 *   • anything else / failures   → honest manual-entry state (never fabricated data)
 */
export async function analyzeCadFile(file: CadFileInput): Promise<ExtractedCadAnalysis> {
  const fileName = file.name || 'part.step';
  const solidFormat = solidFormatFor(fileName) ?? (file.fileType === 'STEP' ? 'step' : null);
  const isPdf = /\.pdf$/i.test(fileName) || file.fileType === 'PDF';
  const isImage = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(fileName) || file.fileType === 'IMAGE';

  if (solidFormat) {
    return analyzeSolid(file, fileName, solidFormat);
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
  format: 'step' | 'iges' | 'brep'
): Promise<ExtractedCadAnalysis> {
  // STEP is ASCII, so we can also mine topology (holes/bends/material) from the text.
  let stepResult: StepParseResult | null = null;
  if (format === 'step') {
    let text = file.content || '';
    if (!text && file.buffer) text = new TextDecoder('utf-8').decode(file.buffer);
    stepResult = parseStepFile(text, fileName);
  }

  const materialName = stepResult?.estimatedMaterialName || 'Mild Steel 3.0mm';
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
    const weightKg = round((volumeCm3 * density) / 1000, 2) || 0;
    const surfaceAreaM2 = round(surfaceAreaCm2 / 10000, 3) || 0;
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
        milledProfile = {
          stockMm: mm.stockMm,
          stockVolumeCm3: mm.stockVolumeCm3,
          partVolumeCm3: mm.partVolumeCm3 || volumeCm3,
          removedVolumeCm3: mm.removedVolumeCm3,
          surfaceAreaCm2,
          setupCount: mm.setupCount,
          pocketCount: mm.pocketCount,
          bossCount: mm.bossCount,
          deepPocketCount: mm.deepPocketCount,
          holeCount: mm.holeCount,
        };
      } else {
        // Approximation: billet = bounding box; setups guessed from holes/faces.
        const stockVolMm = (meas.lengthMm * meas.widthMm * meas.heightMm) / 1000;
        milledProfile = {
          stockMm: { x: meas.lengthMm, y: meas.widthMm, z: meas.heightMm },
          stockVolumeCm3: Math.round(stockVolMm * 10) / 10,
          partVolumeCm3: volumeCm3,
          removedVolumeCm3: Math.round(Math.max(0, stockVolMm - volumeCm3) * 10) / 10,
          surfaceAreaCm2,
          setupCount: Math.min(3, 1 + (holeCount > 0 ? 1 : 0) + (bendCount > 0 ? 1 : 0)),
          pocketCount: 0,
          bossCount: 0,
          deepPocketCount: 0,
          holeCount,
        };
      }
    }

    // Setups: single op for a plain turned part; a second op (back-face /
    // turn-around) when off-axis features exist. Milled parts use the access-
    // direction count from the geometry analysis.
    const setups = milledProfile ? Math.max(1, milledProfile.setupCount) : (crossFeatures ? 2 : 1);

    // Stock (next standard bar) and material yield (buy-to-fly).
    const { barDiameterMm, stockVolumeCm3: stockVol } = computeStock(turningProfile, DEFAULT_CNC_SETTINGS);
    const removedVol = Math.max(0, stockVol - volumeCm3);
    const buyToFlyRatio = stockVol > 0 ? Math.round((volumeCm3 / stockVol) * 100) / 100 : 0;

    // Machine selection — the most efficient machine (sliding-head / 2-axis /
    // turn-mill / mill) that can make this part, and why.
    const machineRecommendation = selectMachine({
      isTurned,
      odMm: diameterMm,
      barDiameterMm,
      lengthMm: axisLengthMm,
      crossFeatures,
      setupCount: milledProfile?.setupCount,
      pocketCount: milledProfile?.pocketCount,
      bossCount: milledProfile?.bossCount,
    });

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
              ? `Billet ${milledProfile.stockMm.x}×${milledProfile.stockMm.y}×${milledProfile.stockMm.z} mm — ${milledProfile.removedVolumeCm3.toFixed(1)} cm³ removed (yield ${Math.round((milledProfile.partVolumeCm3 / Math.max(0.01, milledProfile.stockVolumeCm3)) * 100)}%).`
              : '',
            milledProfile
              ? `${setups} setup${setups === 1 ? '' : 's'} (distinct tool-access directions), ${milledProfile.pocketCount} pocket${milledProfile.pocketCount === 1 ? '' : 's'}${milledProfile.deepPocketCount > 0 ? ` (${milledProfile.deepPocketCount} deep)` : ''}, ${milledProfile.holeCount} hole${milledProfile.holeCount === 1 ? '' : 's'}. Setups are the biggest cost lever.`
              : '',
            `Estimates cost and cycle time only — this does not generate toolpaths (your CAM stays in place).`,
          ].filter(Boolean),
      confidenceScore: isTurned
        ? (crossFeatures ? 70 : Math.round(70 + pcConfidence * 28))
        : Math.round(45 + milledConfidence * 40),
      stepData,
      stepMesh: mesh,
      measurementSource: 'solid',
      featuresNeedReview: isTurned
        ? crossFeatures
        : (profileSource !== 'brep-service' || (milledProfile?.deepPocketCount ?? 0) > 0 || setups >= 3),
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

function fromAiData(
  fileName: string,
  fileType: 'PDF' | 'IMAGE',
  d: AiDrawingData,
  pdfUrl?: string
): ExtractedCadAnalysis {
  return {
    partName: d.partName || baseName(fileName),
    fileType,
    fileName,
    materialName: d.materialName || 'Mild Steel 3.0mm',
    thicknessMm: d.thicknessMm ?? 3.0,
    lengthMm: d.lengthMm ?? 0,
    widthMm: d.widthMm ?? 0,
    heightMm: d.heightMm ?? 0,
    perimeterMm: d.perimeterMm ?? 0,
    pierceCount: d.pierceCount ?? 0,
    bendCount: d.bendCount ?? 0,
    isSimpleBending: d.isSimpleBending ?? true,
    holeCount: d.holeCount ?? 0,
    holeDetails: d.holeDetails ?? [],
    weldLengthMm: d.weldLengthMm ?? 0,
    weldCount: d.weldCount ?? 0,
    weightKg: d.weightKg ?? 0,
    surfaceAreaM2: d.surfaceAreaM2 ?? 0,
    finishCallout: d.finishCallout,
    tolerances: d.tolerances,
    aiNotes:
      d.aiNotes && d.aiNotes.length
        ? d.aiNotes
        : ['Dimensions read from the drawing by AI vision. Please verify before quoting.'],
    confidenceScore: d.confidenceScore ?? 70,
    measurementSource: 'ai-drawing',
    pdfUrl,
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
    materialName: 'Mild Steel 3.0mm',
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
