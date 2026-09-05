/**
 * MILLING TOOL LIBRARY — the shop's real cutters, so a milled estimate can be
 * expanded into a tool-by-tool operation sheet the way a CAM system does.
 *
 * Seeded from the shop's own tool libraries (exported from the reference CAM tool
 * as `Aluminium Sample Library` / `Steel & Stainless Sample Library`): each entry
 * is a genuine cutter — type, diameter, flute count, corner radius — with the
 * book cutting data (surface speed vc, feed per tooth fz) recorded for that tool.
 *
 * The estimator uses these to ASSIGN a specific tool to each operation (face mill
 * for facing, a sized rougher for the hog-out, small finishers for detail, the
 * matching drill for each hole size, a chamfer tool for edge-break) and to show
 * feeds/speeds on the job sheet. The cost total is still the calibrated cycle-time
 * model — this library controls which tools appear and how the work is grouped,
 * not the headline price.
 */
import type { MaterialProps } from './materials';

export type MillType = 'face' | 'flat' | 'bull' | 'ball' | 'chamfer' | 'drill' | 'countersink';

export interface MillingTool {
  description: string;
  type: MillType;
  /** Cutting diameter (mm). */
  diaMm: number;
  flutes: number;
  /** Corner radius (mm), for bull-nose. */
  cornerRadiusMm?: number;
  /** Book surface speed (m/min) recorded for this tool. */
  vc: number;
  /** Book feed per tooth (mm/tooth) recorded for this tool. */
  fz: number;
}

/** Aluminium Sample Library (metric) — the shop's aluminium set. */
export const ALU_MILL_TOOLS: MillingTool[] = [
  { description: 'Kennametal Dodeka Mini 40mm 4F Face', type: 'face', diaMm: 40, flutes: 4, cornerRadiusMm: 1, vc: 598, fz: 0.0707 },
  { description: 'Skookum 12mm 3F Flat', type: 'flat', diaMm: 12, flutes: 3, vc: 305, fz: 0.1436 },
  { description: 'Kennametal GOmill PRO 12mm 4F Bull R1', type: 'bull', diaMm: 12, flutes: 4, cornerRadiusMm: 1, vc: 731, fz: 0.1116 },
  { description: 'Haas 10mm 3F Flat', type: 'flat', diaMm: 10, flutes: 3, vc: 305, fz: 0.1347 },
  { description: 'Iscar 10mm 2F Ball', type: 'ball', diaMm: 10, flutes: 2, vc: 305, fz: 0.065 },
  { description: 'Iscar 8mm 3F Flat', type: 'flat', diaMm: 8, flutes: 3, vc: 305, fz: 0.08 },
  { description: 'Kennametal GOmill PRO 8mm 4F Bull R0.5', type: 'bull', diaMm: 8, flutes: 4, cornerRadiusMm: 0.5, vc: 219, fz: 0.0558 },
  { description: 'Iscar 6mm 3F Flat', type: 'flat', diaMm: 6, flutes: 3, vc: 226, fz: 0.06 },
  { description: 'Skookum 6mm 4F Ball', type: 'ball', diaMm: 6, flutes: 4, vc: 226, fz: 0.039 },
  { description: 'Skookum 5mm 3F Flat', type: 'flat', diaMm: 5, flutes: 3, vc: 188, fz: 0.05 },
  { description: 'Kennametal GOmill PRO 5mm 4F Bull R0.2', type: 'bull', diaMm: 5, flutes: 4, cornerRadiusMm: 0.2, vc: 219, fz: 0.0335 },
  { description: 'Haas 3mm 3F Flat', type: 'flat', diaMm: 3, flutes: 3, vc: 113, fz: 0.0329 },
  { description: 'Harvey 3mm 3F Ball', type: 'ball', diaMm: 3, flutes: 3, vc: 113, fz: 0.0213 },
  { description: 'Iscar 1.5mm 3F Flat', type: 'flat', diaMm: 1.5, flutes: 3, vc: 57, fz: 0.015 },
  { description: '8mm 4F Chamfer 45°', type: 'chamfer', diaMm: 8, flutes: 4, vc: 302, fz: 0.06 },
];

/** Steel & Stainless Sample Library (metric) — slower feeds/speeds. */
export const STEEL_MILL_TOOLS: MillingTool[] = [
  { description: 'Kennametal Dodeka Mini 40mm 4F Face', type: 'face', diaMm: 40, flutes: 4, cornerRadiusMm: 1, vc: 168, fz: 0.1414 },
  { description: 'Kennametal GOmill PRO 12mm 4F Flat', type: 'flat', diaMm: 12, flutes: 4, vc: 219, fz: 0.077 },
  { description: 'Iscar 12mm 5F Bull R0.4', type: 'bull', diaMm: 12, flutes: 5, cornerRadiusMm: 0.4, vc: 183, fz: 0.036 },
  { description: 'Kennametal GOmill PRO 10mm 4F Flat', type: 'flat', diaMm: 10, flutes: 4, vc: 219, fz: 0.067 },
  { description: 'Kennametal GOmill PRO 10mm 4F Ball', type: 'ball', diaMm: 10, flutes: 4, vc: 465, fz: 0.1766 },
  { description: 'Kennametal GOmill PRO 8mm 4F Flat', type: 'flat', diaMm: 8, flutes: 4, vc: 219, fz: 0.0558 },
  { description: 'Kennametal GOmill PRO 8mm 4F Bull R0.5', type: 'bull', diaMm: 8, flutes: 4, cornerRadiusMm: 0.5, vc: 219, fz: 0.0558 },
  { description: 'Iscar 6mm 4F Flat', type: 'flat', diaMm: 6, flutes: 4, vc: 183, fz: 0.024 },
  { description: 'Skookum 6mm 4F Ball', type: 'ball', diaMm: 6, flutes: 4, vc: 183, fz: 0.018 },
  { description: 'Iscar 5mm 4F Flat', type: 'flat', diaMm: 5, flutes: 4, vc: 183, fz: 0.02 },
  { description: 'Kennametal GOmill PRO 5mm 4F Bull R0.2', type: 'bull', diaMm: 5, flutes: 4, cornerRadiusMm: 0.2, vc: 219, fz: 0.0335 },
  { description: 'Iscar 3mm 4F Flat', type: 'flat', diaMm: 3, flutes: 4, vc: 113, fz: 0.012 },
  { description: 'Kennametal 3mm 4F Ball', type: 'ball', diaMm: 3, flutes: 4, vc: 113, fz: 0.009 },
  { description: 'Kennametal GOmill PRO 3mm 4F Bull R0.2', type: 'bull', diaMm: 3, flutes: 4, cornerRadiusMm: 0.2, vc: 188, fz: 0.0195 },
  { description: '1.5mm 4F Flat', type: 'flat', diaMm: 1.5, flutes: 4, vc: 57, fz: 0.006 },
  { description: '8mm 4F Chamfer 45°', type: 'chamfer', diaMm: 8, flutes: 4, vc: 183, fz: 0.024 },
];

/** Standard jobber drill ladder (mm) — the shop's drill set, coarsened to stock sizes. */
export const DRILL_LADDER_MM = [
  1, 1.5, 2, 2.5, 3, 3.2, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 6.8, 7, 7.5, 8, 8.5, 9, 9.5,
  10, 10.5, 11, 11.5, 12, 12.5, 13, 14, 15, 16, 17, 18, 19, 20,
];

/** Which sample library fits a material family. Steel/stainless run the slower set. */
export function millingToolsFor(m: MaterialProps): MillingTool[] {
  const label = `${m.label} ${m.family ?? ''}`.toLowerCase();
  const ferrous = /steel|stainless|inox|iron|titanium|inconel/.test(label);
  return ferrous ? STEEL_MILL_TOOLS : ALU_MILL_TOOLS;
}

const byType = (tools: MillingTool[], t: MillType) => tools.filter((x) => x.type === t);

/** The face mill (largest face-type cutter). */
export function faceMill(tools: MillingTool[]): MillingTool | undefined {
  return byType(tools, 'face').sort((a, b) => b.diaMm - a.diaMm)[0];
}

/** The chamfer tool. */
export function chamferTool(tools: MillingTool[]): MillingTool | undefined {
  return byType(tools, 'chamfer')[0];
}

/**
 * Roughing cutter: the biggest flat/bull that still fits the part comfortably
 * (≈ ¼ of the smallest in-plane dimension), so a small part doesn't get a 12 mm
 * hog. Prefers bull-nose (tougher for adaptive), falls back to flat.
 */
export function roughingTool(tools: MillingTool[], minPlaneDimMm: number): MillingTool | undefined {
  const cap = Math.max(3, minPlaneDimMm / 4);
  const cutters = tools.filter((t) => t.type === 'flat' || t.type === 'bull');
  const fits = cutters.filter((t) => t.diaMm <= cap).sort((a, b) => b.diaMm - a.diaMm);
  const pick = fits[0] ?? cutters.slice().sort((a, b) => a.diaMm - b.diaMm)[0];
  return pick;
}

/** Wall finisher: a mid flat/bull, smaller than the rougher. */
export function wallFinisher(tools: MillingTool[], rougher?: MillingTool): MillingTool | undefined {
  const cutters = tools.filter((t) => t.type === 'flat' || t.type === 'bull');
  const cap = rougher ? rougher.diaMm : Infinity;
  const smaller = cutters.filter((t) => t.diaMm < cap).sort((a, b) => b.diaMm - a.diaMm);
  return smaller[0] ?? cutters.sort((a, b) => a.diaMm - b.diaMm)[0];
}

/** Floor finisher: prefer a ball/bull for a clean floor. */
export function floorFinisher(tools: MillingTool[]): MillingTool | undefined {
  return byType(tools, 'ball').sort((a, b) => b.diaMm - a.diaMm)[0]
    ?? byType(tools, 'bull').sort((a, b) => b.diaMm - a.diaMm)[0];
}

/** Smallest detail cutter, for finishing tight walls/corners. */
export function detailTool(tools: MillingTool[]): MillingTool | undefined {
  return tools.filter((t) => t.type === 'flat' || t.type === 'bull').sort((a, b) => a.diaMm - b.diaMm)[0];
}

/**
 * Rest-roughing cutter: a mid tool (≈ half the rougher) that clears what the big
 * adaptive tool left, without dropping straight to the finest finisher — a shop
 * rest-roughs with a 5–6 mm tool, not a 1.5 mm one.
 */
export function restRoughTool(tools: MillingTool[], rougher?: MillingTool): MillingTool | undefined {
  const cutters = tools.filter((t) => t.type === 'flat' || t.type === 'bull');
  const target = (rougher ? rougher.diaMm : 12) / 2;
  const smaller = cutters.filter((t) => !rougher || t.diaMm < rougher.diaMm);
  const pool = smaller.length ? smaller : cutters;
  return pool.slice().sort((a, b) => Math.abs(a.diaMm - target) - Math.abs(b.diaMm - target))[0];
}

/** Nearest drill at or above a hole diameter (a real shop reams/bores oversize holes). */
export function nearestDrill(diaMm: number): number {
  for (const d of DRILL_LADDER_MM) if (d >= diaMm - 1e-6) return d;
  return Math.ceil(diaMm);
}

export interface HoleGroup {
  drillMm: number;
  count: number;
  /** True when the hole is too big to drill from solid — interpolate/bore instead. */
  interpolate: boolean;
  /**
   * The measured depths of the holes in this group, when they were supplied.
   *
   * Carried through grouping so a caller can weight each operation by the time
   * it actually takes. Splitting a total by hole COUNT stopped being defensible
   * once per-hole time started depending on diameter and depth: a ⌀1 hole 25 mm
   * deep and a ⌀6 hole 1.5 mm deep are not two equal halves of the drilling.
   */
  depthsMm?: number[];
}

/**
 * Group measured hole diameters into drill operations, the way a CAM plan lists
 * one drilling op per drill size. Holes bigger than `maxDrillMm` are milled
 * (helical/bore), not drilled. Falls back to a single generic group when the
 * per-hole diameters weren't measured.
 */
export function groupHoles(
  holeDiametersMm: number[] | undefined,
  holeCount: number,
  maxDrillMm = 20,
  holeDepthsMm?: number[],
): HoleGroup[] {
  const paired = (holeDiametersMm ?? []).map((d, i) => ({ d, z: holeDepthsMm?.[i] }))
    .filter((h) => h.d > 0);
  const dias = paired.map((h) => h.d);
  if (dias.length === 0) {
    if (holeCount <= 0) return [];
    return [{ drillMm: 6, count: holeCount, interpolate: false }];
  }
  const map = new Map<number, number>();
  const depths = new Map<number, number[]>();
  for (const { d, z } of paired) {
    // negative key flags interpolate; big bores keep their real size
    const k = d > maxDrillMm ? -(Math.round(d * 10) / 10) : nearestDrill(d);
    map.set(k, (map.get(k) ?? 0) + 1);
    if (z !== undefined && z > 0) depths.set(k, [...(depths.get(k) ?? []), z]);
  }
  return [...map.entries()]
    .map(([k, count]) => ({
      drillMm: Math.abs(k), count, interpolate: k < 0,
      depthsMm: depths.get(k),
    }))
    .sort((a, b) => a.drillMm - b.drillMm);
}
