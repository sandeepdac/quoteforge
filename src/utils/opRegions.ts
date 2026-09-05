/**
 * "WHERE THIS OP ACTS" — the region each machining operation works on.
 *
 * Pure geometry + copy, kept out of the React components so it can be unit
 * tested and shared. Two families:
 *
 *   • TURNING — regions in the longitudinal (Z–radius) section the toolpath
 *     preview already draws: an end-face slab, the OD envelope hogged off, the
 *     bore, the finished skin, the part-off plane.
 *   • MILLING — a deterministic schematic layout of the billet's features
 *     (pockets / bosses / holes) so a plan + elevation view can shade what each
 *     op touches. Positions are ILLUSTRATIVE — we know the counts from the
 *     geometry service, not where each feature sits (that needs a posted
 *     toolpath), so the milled view is always labelled schematic.
 */
import type { Toolpath } from './toolpath';
import type { TurningOp } from '../types';

// --------------------------------------------------------------------------
// Turning
// --------------------------------------------------------------------------

/** A shaded region on the longitudinal section, in mm (z along axis, r radius). */
export type SectionShape = 'band' | 'core' | 'annulus';
export interface SectionRegion {
  /** band = full-diameter slab; core = central cylinder; annulus = rInner→rOuter, mirrored. */
  shape: SectionShape;
  zA: number;
  zB: number;
  rInner: number;
  rOuter: number;
}

export interface TurningOpInfo {
  op: TurningOp;
  label: string;
  /** One-line "what this op does to the part". */
  description: string;
  regions: SectionRegion[];
}

/** Pilot-drill diameter behind a bore: the boring bar's first radial position. */
export function pilotDiaFromToolpath(tp: Toolpath): number {
  const bore = tp.passes.find((p) => p.op === 'bore');
  if (bore) {
    const first = bore.moves.find((m) => m.x > 0.01);
    if (first) return first.x;
  }
  return tp.boreDiaMm;
}

const TURNING_COPY: Record<TurningOp, string> = {
  face: 'Skims the right-hand end face flat — establishes the Z datum for everything after it.',
  rough: 'Hogs the OD down from bar stock to near-finish size — the bulk of the metal removed.',
  drill: 'Drills the pilot hole on centre, deep enough for the boring bar to open out.',
  bore: 'Opens the drilled pilot out to the finished bore diameter.',
  finish: 'Final light pass along the OD — brings it to size and surface finish.',
  partoff: 'Parts the finished component off the bar at length.',
};

const TURNING_LABEL: Record<TurningOp, string> = {
  face: 'Facing',
  rough: 'Rough turn',
  drill: 'Drill pilot',
  bore: 'Bore',
  finish: 'Finish turn',
  partoff: 'Part-off',
};

/**
 * Region(s) each turning op acts on, keyed by op, in section (z, r) space.
 * Only ops actually present in the toolpath are returned, in machining order.
 */
export function turningOpRegions(tp: Toolpath): TurningOpInfo[] {
  const len = Math.max(1, tp.lengthMm);
  const stockR = tp.stockDiaMm / 2;
  const partR = tp.partOdMm / 2;
  const boreDepth = tp.boreDepthMm;
  const boreR = tp.boreDiaMm / 2;
  const pilotR = pilotDiaFromToolpath(tp) / 2;
  const endSlab = Math.max(1.2, len * 0.03); // visible thickness of the end-face / part-off bands

  const build: Partial<Record<TurningOp, SectionRegion[]>> = {
    face: [{ shape: 'band', zA: -endSlab, zB: 0, rInner: 0, rOuter: stockR }],
    rough: [{ shape: 'annulus', zA: -len, zB: 0, rInner: partR, rOuter: stockR }],
    finish: [
      {
        shape: 'annulus',
        zA: -len,
        zB: 0,
        rInner: Math.max(0, partR - Math.min(0.8, partR * 0.05)),
        rOuter: partR + 0.4,
      },
    ],
    partoff: [{ shape: 'band', zA: -len, zB: -len + endSlab, rInner: 0, rOuter: stockR }],
  };
  if (tp.boreDiaMm > 0 && boreDepth > 0) {
    build.drill = [{ shape: 'core', zA: -boreDepth, zB: 0, rInner: 0, rOuter: pilotR }];
    if (boreR > pilotR + 0.05) {
      build.bore = [{ shape: 'annulus', zA: -boreDepth, zB: 0, rInner: pilotR, rOuter: boreR }];
    }
  }

  // Emit in the machining order the toolpath itself uses, but only for ops that
  // both exist as passes and produced a region.
  const order: TurningOp[] = ['face', 'rough', 'drill', 'bore', 'finish', 'partoff'];
  const present = new Set(tp.passes.map((p) => p.op));
  return order
    .filter((op) => present.has(op) && build[op] && build[op]!.every((r) => r.rOuter > r.rInner - 1e-6))
    .map((op) => ({ op, label: TURNING_LABEL[op], description: TURNING_COPY[op], regions: build[op]! }));
}

// --------------------------------------------------------------------------
// Milling
// --------------------------------------------------------------------------

/** A rectangle in normalised footprint coordinates (0–1 across the billet). */
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Depth as a fraction of stock thickness (for the elevation view). */
  depth: number;
  deep?: boolean;
}
export interface NormHole {
  x: number;
  y: number;
  r: number;
}

export interface MilledLayout {
  pockets: NormRect[];
  bosses: NormRect[];
  holes: NormHole[];
  /** Holes hidden by the display cap, so the view can note "+N more". */
  hiddenHoles: number;
}

export interface MilledCounts {
  pocketCount: number;
  bossCount: number;
  deepPocketCount: number;
  holeCount: number;
}

const MAX_HOLES_SHOWN = 24;

/**
 * A deterministic, tidy schematic layout for the measured feature counts. Not
 * the real positions — an illustration so each op can shade what it touches.
 * Pockets sit in a coarse grid, bosses tuck into the gaps, holes fill a fine
 * grid around them.
 */
export function milledFeatureLayout(counts: MilledCounts): MilledLayout {
  const pocketCount = Math.max(0, Math.round(counts.pocketCount || 0));
  const bossCount = Math.max(0, Math.round(counts.bossCount || 0));
  const deep = Math.max(0, Math.round(counts.deepPocketCount || 0));
  const holeCount = Math.max(0, Math.round(counts.holeCount || 0));

  // Pockets: grid across the middle band of the footprint.
  const pockets: NormRect[] = [];
  const pcols = Math.max(1, Math.ceil(Math.sqrt(pocketCount)));
  const prows = Math.max(1, Math.ceil(pocketCount / pcols));
  for (let i = 0; i < pocketCount; i++) {
    const c = i % pcols;
    const r = Math.floor(i / pcols);
    const cw = 0.62 / pcols;
    const ch = 0.5 / prows;
    const isDeep = i >= pocketCount - deep;
    pockets.push({
      x: 0.19 + c * (0.62 / pcols) + cw * 0.12,
      y: 0.26 + r * (0.5 / prows) + ch * 0.12,
      w: cw * 0.76,
      h: ch * 0.76,
      depth: isDeep ? 0.7 : 0.4,
      deep: isDeep,
    });
  }

  // Bosses: islands along the top strip.
  const bosses: NormRect[] = [];
  for (let i = 0; i < bossCount; i++) {
    const cols = Math.min(bossCount, 8);
    const c = i % cols;
    const r = Math.floor(i / cols);
    bosses.push({
      x: 0.1 + c * (0.8 / Math.max(1, cols)) + 0.02,
      y: 0.05 + r * 0.05,
      w: 0.8 / Math.max(1, cols) - 0.04,
      h: 0.035,
      depth: 0,
    });
  }

  // Holes: fine grid in the lower strip, capped for legibility.
  const shown = Math.min(holeCount, MAX_HOLES_SHOWN);
  const holes: NormHole[] = [];
  const hcols = Math.max(1, Math.ceil(Math.sqrt(shown * 2)));
  const hrows = Math.max(1, Math.ceil(shown / hcols));
  for (let i = 0; i < shown; i++) {
    const c = i % hcols;
    const r = Math.floor(i / hcols);
    holes.push({
      x: 0.12 + (c + 0.5) * (0.76 / hcols),
      y: 0.8 + (r - (hrows - 1) / 2) * 0.06,
      r: 0.012,
    });
  }

  return { pockets, bosses, holes, hiddenHoles: Math.max(0, holeCount - shown) };
}

/** Which milling ops to offer, in machining order, given what the part has. */
export type MilledOp = 'facing' | 'rough' | 'finish' | 'drill';

export interface MilledOpInfo {
  op: MilledOp;
  label: string;
  description: (c: MilledCounts, removedCm3?: number) => string;
  /** What the op shades in the schematic. */
  touches: {
    face?: boolean;
    perimeter?: boolean;
    pockets?: boolean;
    bosses?: boolean;
    holes?: boolean;
    walls?: boolean;
  };
}

export const MILLED_OPS: MilledOpInfo[] = [
  {
    op: 'facing',
    label: 'Facing',
    description: () => 'Skims the top face(s) flat to a clean datum after each re-clamp.',
    touches: { face: true },
  },
  {
    op: 'rough',
    label: 'Roughing',
    description: (_c, removed) =>
      `Hogs out the bulk — perimeter stock and pocket volume${
        removed ? ` (~${Math.round(removed)} cm³)` : ''
      }.`,
    touches: { perimeter: true, pockets: true },
  },
  {
    op: 'finish',
    label: 'Finishing',
    description: (c) =>
      `Finishes walls & floors to size and surface finish${
        c.bossCount > 0 ? `, machining around ${c.bossCount} island${c.bossCount === 1 ? '' : 's'}` : ''
      }.`,
    touches: { walls: true, pockets: true, bosses: true, perimeter: true },
  },
  {
    op: 'drill',
    label: 'Drilling',
    description: (c) => `Drills ${c.holeCount} hole${c.holeCount === 1 ? '' : 's'} to depth.`,
    touches: { holes: true },
  },
];

/** The milling ops actually present for these counts, in machining order. */
export function milledOpsFor(counts: MilledCounts): MilledOpInfo[] {
  return MILLED_OPS.filter((o) => {
    if (o.op === 'drill') return counts.holeCount > 0;
    if (o.op === 'finish') return true;
    return true; // facing + roughing always run
  });
}
