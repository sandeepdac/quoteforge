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
import { DfmReport } from './dfm';
import { analyzeCncDfm } from './dfmCnc';
import { classifyPart, PartClass } from './partClass';
import { stockVolumeCm3, MachiningInput } from './cncEstimator';
import { materialPropsFor } from './materials';
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
  // --- CNC machining metrics (subtractive) --------------------------------
  /** Turned (round bar) vs milled (billet) — drives the machining cost model. */
  partClass?: PartClass;
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
    const weightKg = round((meas.volumeCm3 * density) / 1000, 2) || 0;
    const surfaceAreaM2 = round(meas.surfaceAreaCm2 / 10000, 3) || 0;
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
    const meanWallMm = meas.surfaceAreaCm2 > 0 ? (20 * meas.volumeCm3) / meas.surfaceAreaCm2 : 0;
    const thicknessMm = meanWallMm > 0
      ? Math.round(Math.min(60, Math.max(0.4, meanWallMm)) * 10) / 10
      : (meas.heightMm < 12 ? Math.max(1.5, meas.heightMm) : 3.0);

    // Machining is subtractive: classify the solid as turned (round bar) or milled
    // (billet), then derive stock and material yield (buy-to-fly) from the measured
    // volume — the headline cost/risk driver for a machine shop.
    const pc = classifyPart({
      lengthMm: meas.lengthMm,
      widthMm: meas.widthMm,
      heightMm: meas.heightMm,
      volumeCm3: meas.volumeCm3,
    });
    // Setups: a turned part is usually one hit (two if it has cross/second-op
    // features); a milled part needs ~2, or 3 when features wrap several faces.
    const boxiness = Math.min(meas.widthMm, meas.heightMm) / Math.max(meas.lengthMm, 1);
    const setups = pc.partClass === 'turned'
      ? (holeCount > 0 ? 2 : 1)
      : (boxiness > 0.5 ? 3 : 2);

    const machiningInput: MachiningInput = {
      partClass: pc.partClass,
      materialName,
      volumeCm3: meas.volumeCm3,
      surfaceAreaCm2: meas.surfaceAreaCm2,
      boundingBoxMm: { lengthMm: meas.lengthMm, widthMm: meas.widthMm, heightMm: meas.heightMm },
      diameterMm: pc.diameterMm,
      axisLengthMm: pc.axisLengthMm,
      holeCount,
      holeDetails,
      setups,
      materialPricePerKg: 0, // not needed for the stock-VOLUME calc below
    };
    const stockVol = stockVolumeCm3(machiningInput, DEFAULT_CNC_SETTINGS);
    const removedVol = Math.max(0, stockVol - meas.volumeCm3);
    const buyToFlyRatio = stockVol > 0 ? Math.round((meas.volumeCm3 / stockVol) * 100) / 100 : 0;
    const machinability = materialPropsFor(materialName).machinability;

    // This product line quotes machined parts, not folded sheet metal.
    const formedPart = false;

    // Advisory Design-for-Manufacturing checks for CNC machining.
    const dfm = analyzeCncDfm({
      partClass: pc.partClass,
      thicknessMm,
      boundingBoxMm: { lengthMm: meas.lengthMm, widthMm: meas.widthMm, heightMm: meas.heightMm },
      diameterMm: pc.diameterMm,
      axisLengthMm: pc.axisLengthMm,
      holeDetails,
      buyToFlyRatio,
      setups,
      tolerances: 'Standard ISO 2768-m (±0.2mm)',
      hasGeometry: !!geo,
    });

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
      aiNotes: [
        `Measured directly from the solid model — bounding box ${meas.lengthMm} × ${meas.widthMm} × ${meas.heightMm} mm.`,
        pc.partClass === 'turned'
          ? `Classified as a TURNED part (round-bar): ⌀${pc.diameterMm} × ${pc.axisLengthMm} mm. ${pc.reason}`
          : `Classified as a MILLED part (billet). ${pc.reason}`,
        `Finished volume ${meas.volumeCm3} cm³ → weight ${weightKg} kg in ${materialName} (density ${density} g/cm³, machinability ${machinability}× mild steel).`,
        `Machined from ${stockVol.toFixed(1)} cm³ of stock — ${removedVol.toFixed(1)} cm³ removed as chips (material yield ${Math.round(buyToFlyRatio * 100)}%), ${setups} setup${setups > 1 ? 's' : ''}.`,
        geo
          ? `${holeCount} holes (${holeSummary})${boreCount ? ` + ${boreCount} bores` : ''} detected geometrically from the solid faces.`
          : `Wetted surface area ${surfaceAreaM2} m² sets finishing time; ${holeCount} holes from topology.`,
      ],
      confidenceScore: 98,
      stepData,
      stepMesh: mesh,
      measurementSource: 'solid',
      featuresNeedReview: false,
      formedPart,
      dfm,
      partClass: pc.partClass,
      diameterMm: pc.diameterMm,
      axisLengthMm: pc.axisLengthMm,
      volumeCm3: meas.volumeCm3,
      surfaceAreaCm2: meas.surfaceAreaCm2,
      stockVolumeCm3: Math.round(stockVol * 10) / 10,
      removedVolumeCm3: Math.round(removedVol * 10) / 10,
      buyToFlyRatio,
      setups,
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
