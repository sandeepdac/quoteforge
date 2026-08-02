/**
 * Design-for-Manufacturing (DFM) analysis for sheet-metal parts.
 *
 * These are ADVISORY checks based on standard sheet-metal guidelines (min bend
 * radius ≈ material thickness, hole-to-bend clearance ≈ 2× thickness, min hole
 * size ≈ material thickness for clean piercing, etc.). Every finding is derived
 * from geometry we actually measured from the solid — nothing is invented. A real
 * shop should tune the thresholds to its own machines and tolerances; the
 * constants below are conservative, widely-cited defaults.
 */
import type { DetectedHole, DetectedBend, Vec3 } from './holeDetector';

export type DfmSeverity = 'fail' | 'warn' | 'pass' | 'info';

export interface DfmFinding {
  id: string;
  severity: DfmSeverity;
  title: string;
  detail: string;
  /** The guideline this check is based on, shown as a small caption. */
  rule: string;
}

export interface DfmReport {
  findings: DfmFinding[];
  counts: { fail: number; warn: number; pass: number; info: number };
  /** 0–100 manufacturability score (100 = no issues found). */
  score: number;
  /** True when positional checks (hole-to-bend, bend radius) could run. */
  hasGeometry: boolean;
}

export interface DfmInput {
  thicknessMm: number;
  boundingBoxMm: { lengthMm: number; widthMm: number; heightMm: number };
  holeDetails: Array<{ diameterMm: number; count: number }>;
  /** Per-hole geometry; empty when the source wasn't a measured solid. */
  holes?: DetectedHole[];
  /** Per-bend geometry; empty when the source wasn't a measured solid. */
  bends?: DetectedBend[];
  /** True when we have real per-feature positions (solid measurement). */
  hasGeometry: boolean;
}

// --- guideline thresholds (multiples of material thickness) ------------------
const MIN_HOLE_DIA_FAIL = 1.0;   // hole ⌀ below 1.0× t: very hard to pierce cleanly
const MIN_HOLE_DIA_WARN = 1.5;   // below 1.5× t: possible but slow / drill preferred
const MIN_BEND_RADIUS_WARN = 1.0; // inside radius below 1.0× t: risk of cracking
const HOLE_TO_BEND_WARN = 2.0;   // hole edge should sit ≥ 2× t from a bend line
const HOLE_TO_BEND_FAIL = 1.0;   // inside 1× t the hole will deform when forming
const THIN_ASPECT_WARN = 300;    // longest span : thickness ratio → floppy part
const STD_SHEET_MM = 3000;       // longest common raw sheet dimension (1.5 × 3 m)

const mm = (v: number) => `${Math.round(v * 10) / 10}mm`;

/** Perpendicular distance from a point to a finite line segment (the bend axis). */
function pointToBendDistance(p: Vec3, bend: DetectedBend): number {
  const d = bend.axisDir;
  const a = bend.axisPoint;
  const w: Vec3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const proj = w[0] * d[0] + w[1] * d[1] + w[2] * d[2];
  // Clamp to the physical extent of the bend along its own axis.
  const a0 = a[0] * d[0] + a[1] * d[1] + a[2] * d[2];
  const pAx = p[0] * d[0] + p[1] * d[1] + p[2] * d[2];
  const halfLen = bend.lengthMm / 2;
  const mid = a0 + proj;
  const clamped = Math.max(mid - halfLen, Math.min(pAx, mid + halfLen));
  const t = clamped - a0;
  const foot: Vec3 = [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t];
  return Math.hypot(p[0] - foot[0], p[1] - foot[1], p[2] - foot[2]);
}

export function analyzeDfm(input: DfmInput): DfmReport {
  const t = input.thicknessMm;
  const findings: DfmFinding[] = [];
  const holes = input.holes ?? [];
  const bends = input.bends ?? [];
  const { lengthMm, widthMm, heightMm } = input.boundingBoxMm;
  const maxSpan = Math.max(lengthMm, widthMm, heightMm);

  // 1) Minimum hole size vs material thickness (works from diameters alone).
  const diameters = input.holeDetails.map((h) => h.diameterMm).filter((d) => d > 0);
  if (diameters.length) {
    const smallest = Math.min(...diameters);
    if (smallest < t * MIN_HOLE_DIA_FAIL) {
      findings.push({
        id: 'min-hole-size',
        severity: 'fail',
        title: `Hole ⌀${mm(smallest)} is smaller than the ${mm(t)} material thickness`,
        detail: `Punching or laser-piercing a hole smaller than the sheet thickness is unreliable and slug-prone. Enlarge to ≥ ${mm(t)}, or plan to drill these holes as a separate op (adds cost).`,
        rule: 'Min hole ⌀ ≥ material thickness',
      });
    } else if (smallest < t * MIN_HOLE_DIA_WARN) {
      findings.push({
        id: 'min-hole-size',
        severity: 'warn',
        title: `Smallest hole ⌀${mm(smallest)} is close to the ${mm(t)} thickness`,
        detail: `Holes below ~1.5× thickness pierce slowly and wear tooling faster. Manufacturable, but ⌀ ≥ ${mm(t * MIN_HOLE_DIA_WARN)} cuts cleaner.`,
        rule: 'Min hole ⌀ ≥ 1.5× thickness',
      });
    } else {
      findings.push({
        id: 'min-hole-size',
        severity: 'pass',
        title: `All ${diameters.length} hole size${diameters.length > 1 ? 's are' : ' is'} good for clean piercing`,
        detail: `Smallest hole ⌀${mm(smallest)} ≥ 1.5× the ${mm(t)} material thickness.`,
        rule: 'Min hole ⌀ ≥ 1.5× thickness',
      });
    }
  }

  // 2) Minimum bend radius vs thickness (needs measured bend geometry).
  if (input.hasGeometry && bends.length) {
    const tight = bends.filter((b) => b.radiusMm > 0 && b.radiusMm < t * MIN_BEND_RADIUS_WARN);
    if (tight.length) {
      const sharpest = Math.min(...tight.map((b) => b.radiusMm));
      findings.push({
        id: 'min-bend-radius',
        severity: 'warn',
        title: `${tight.length} bend${tight.length > 1 ? 's have' : ' has'} an inside radius below material thickness`,
        detail: `Tightest inside radius is ${mm(sharpest)} on ${mm(t)} stock. Bending below ~1× thickness risks cracking on the outside of the bend, especially on harder tempers. Aim for an inside radius ≥ ${mm(t)}.`,
        rule: 'Inside bend radius ≥ material thickness',
      });
    } else {
      findings.push({
        id: 'min-bend-radius',
        severity: 'pass',
        title: `Bend radii are within a safe range`,
        detail: `All ${bends.length} detected bends have an inside radius ≥ the ${mm(t)} material thickness.`,
        rule: 'Inside bend radius ≥ material thickness',
      });
    }
  }

  // 3) Hole-to-bend clearance (needs both hole positions and bend lines).
  if (input.hasGeometry && holes.length && bends.length) {
    let worst = Infinity;
    let failCount = 0;
    let warnCount = 0;
    for (const hole of holes) {
      let nearest = Infinity;
      for (const bend of bends) {
        const edge = pointToBendDistance(hole.center, bend) - hole.diameterMm / 2;
        nearest = Math.min(nearest, edge);
      }
      if (nearest < t * HOLE_TO_BEND_FAIL) failCount++;
      else if (nearest < t * HOLE_TO_BEND_WARN) warnCount++;
      worst = Math.min(worst, nearest);
    }
    if (failCount > 0) {
      findings.push({
        id: 'hole-to-bend',
        severity: 'fail',
        title: `${failCount} hole${failCount > 1 ? 's are' : ' is'} too close to a bend line`,
        detail: `Nearest hole edge is ${mm(Math.max(0, worst))} from a bend — inside 1× thickness the hole will pull oval when the flange is formed. Move holes ≥ ${mm(t * HOLE_TO_BEND_WARN)} (2× thickness) from the bend, or pierce after forming.`,
        rule: 'Hole edge ≥ 2× thickness from a bend',
      });
    } else if (warnCount > 0) {
      findings.push({
        id: 'hole-to-bend',
        severity: 'warn',
        title: `${warnCount} hole${warnCount > 1 ? 's sit' : ' sits'} near a bend line`,
        detail: `Nearest hole edge is ${mm(Math.max(0, worst))} from a bend. Below ~2× thickness (${mm(t * HOLE_TO_BEND_WARN)}) there's some distortion risk. Usually acceptable, but watch the tolerance on those holes.`,
        rule: 'Hole edge ≥ 2× thickness from a bend',
      });
    } else {
      findings.push({
        id: 'hole-to-bend',
        severity: 'pass',
        title: `Holes are clear of all bends`,
        detail: `Every hole edge is ≥ 2× the ${mm(t)} thickness from the nearest bend line — no forming distortion expected.`,
        rule: 'Hole edge ≥ 2× thickness from a bend',
      });
    }
  }

  // 4) Thin, floppy part (aspect ratio of longest span to thickness).
  if (t > 0 && maxSpan > 0) {
    const ratio = Math.round(maxSpan / t);
    if (ratio > THIN_ASPECT_WARN) {
      findings.push({
        id: 'thin-part',
        severity: 'warn',
        title: `Large thin part (${ratio}:1 span-to-thickness)`,
        detail: `At ${mm(maxSpan)} across on ${mm(t)} stock, the blank is floppy — expect handling and flatness challenges after cutting. Consider a heavier gauge or added stiffening features if flatness matters.`,
        rule: 'Span : thickness ≤ 300:1',
      });
    }
  }

  // 5) Fits on standard raw stock?
  const inPlaneMax = Math.max(lengthMm, widthMm);
  if (inPlaneMax > STD_SHEET_MM) {
    findings.push({
      id: 'sheet-size',
      severity: 'warn',
      title: `Part exceeds a standard 1.5 × 3 m sheet`,
      detail: `Longest side is ${mm(inPlaneMax)}. This won't nest on common raw stock — it needs oversized sheet or splicing, which affects lead time and cost.`,
      rule: 'Fits ≤ 3000mm raw sheet',
    });
  } else if (inPlaneMax > 0) {
    findings.push({
      id: 'sheet-size',
      severity: 'info',
      title: `Fits standard raw stock`,
      detail: `Footprint ${mm(lengthMm)} × ${mm(widthMm)} nests within a standard 1.5 × 3 m sheet.`,
      rule: 'Fits ≤ 3000mm raw sheet',
    });
  }

  const order: Record<DfmSeverity, number> = { fail: 0, warn: 1, pass: 2, info: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  const counts = {
    fail: findings.filter((f) => f.severity === 'fail').length,
    warn: findings.filter((f) => f.severity === 'warn').length,
    pass: findings.filter((f) => f.severity === 'pass').length,
    info: findings.filter((f) => f.severity === 'info').length,
  };
  const score = Math.max(0, 100 - counts.fail * 25 - counts.warn * 10);

  return { findings, counts, score, hasGeometry: input.hasGeometry };
}
