/**
 * TURNING TOOLPATH — a REFERENCE preview of the passes behind the cycle-time
 * estimate, plus an operator-checkable G-code skeleton.
 *
 * This is NOT a CAM post-processor. It expands the same simplified turned profile
 * the estimator uses (facing → roughing → drilling → finishing → part-off) into an
 * ordered set of tool moves, so the quote can be SHOWN, not just asserted, and so
 * an operator has a starting reference. Every program is stamped REFERENCE ONLY —
 * production toolpaths still come from the shop's CAM (SolidCAM), unchanged.
 *
 * Conventions: diameter programming (X = diameter), Z = 0 at the finished right
 * face and negative into the part, feed-per-rev (G99), constant rpm (G97).
 */
import type { MaterialProps } from './materials';
import { rpm } from './turning';
import type { TurningProfile } from './turning';

export interface TPMove {
  /** Rapid (G0) vs feed (G1). */
  rapid: boolean;
  /** X in DIAMETER (mm). */
  x: number;
  /** Z (mm), 0 at the face, negative into the part. */
  z: number;
}

export interface TPPass {
  op: 'face' | 'rough' | 'drill' | 'finish' | 'partoff';
  label: string;
  color: string;
  toolNo: number;
  /** The assumed cutter for this pass — generic, not tied to a real tool offset. */
  tool: string;
  rpm: number;
  /** Feed per rev (mm/rev). */
  feed: number;
  moves: TPMove[];
}

export interface Toolpath {
  stockDiaMm: number;
  stockLengthMm: number;
  partOdMm: number;
  boreDiaMm: number;
  boreDepthMm: number;
  lengthMm: number;
  passes: TPPass[];
}

export interface ToolpathConfig {
  maxRpm: number;
  /** Radial finish allowance left on for the finishing pass (mm). */
  finishAllowanceMm: number;
  /** Rapid clearance in front of the face (mm, +Z). */
  clearanceMm: number;
}

export const DEFAULT_TOOLPATH_CONFIG: ToolpathConfig = {
  maxRpm: 6000,
  finishAllowanceMm: 0.4,
  clearanceMm: 2.0,
};

const OP_COLORS = {
  face: '#f59e0b',
  rough: '#2563eb',
  drill: '#8b5cf6',
  finish: '#10b981',
  partoff: '#64748b',
} as const;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Expand a turned profile + chosen bar into an ordered toolpath. Stepover for
 * roughing comes from the material's depth of cut; feeds/speeds from its cutting
 * data. Grooves/threads are estimated in the quote but omitted from this
 * reference path (they need the drawing callout to program correctly).
 */
export function generateTurningToolpath(
  profile: TurningProfile,
  stockDiaMm: number,
  m: MaterialProps,
  cfg: ToolpathConfig = DEFAULT_TOOLPATH_CONFIG
): Toolpath {
  const od = Math.max(0.5, profile.odMm);
  const len = Math.max(1, profile.lengthMm);
  const stock = Math.max(od + 1, stockDiaMm);
  const clr = cfg.clearanceMm;
  const passes: TPPass[] = [];

  // --- 1) Facing: skim the right end flat, OD → centre, a couple of steps ----
  const faceRpm = Math.round(rpm(m.cuttingSpeedFinish, stock, cfg.maxRpm));
  {
    const moves: TPMove[] = [];
    const faceZ = 0; // finished face
    const steps = 2;
    for (let i = 0; i < steps; i++) {
      const zCut = clr - ((i + 1) / steps) * clr - 0; // shave down to z=0
      moves.push({ rapid: true, x: stock + 4, z: clr });
      moves.push({ rapid: true, x: stock + 4, z: faceZ - 0 + (i === steps - 1 ? 0 : 0) });
      moves.push({ rapid: false, x: -1, z: faceZ }); // feed across face to centre
      moves.push({ rapid: true, x: stock + 4, z: clr });
      void zCut;
    }
    passes.push({ op: 'face', label: 'Facing', color: OP_COLORS.face, toolNo: 1, tool: 'OD turning — 80° rhombic insert (C/DNMG)', rpm: faceRpm, feed: m.feedFinish, moves });
  }

  // --- 2) Roughing: turn OD from stock → part OD (+finish allowance) ----------
  const ap = Math.max(0.3, m.depthOfCutRough);          // radial depth of cut
  const targetDia = od + 2 * cfg.finishAllowanceMm;     // leave skin for finishing
  const roughRpm = Math.round(rpm(m.cuttingSpeedRough, stock, cfg.maxRpm));
  {
    const moves: TPMove[] = [];
    let dia = stock;
    // First rapid approach.
    moves.push({ rapid: true, x: stock + 2, z: clr });
    // Step down by 2·ap per pass, clamping the last pass to the finish diameter so
    // even a small amount of stock (target close to OD) still gets at least one cut.
    while (dia > targetDia + 0.01) {
      dia = Math.max(targetDia, dia - 2 * ap);
      moves.push({ rapid: true, x: dia, z: clr });        // rapid to depth
      moves.push({ rapid: false, x: dia, z: -len });      // feed along Z
      moves.push({ rapid: false, x: dia + 1.5, z: -len }); // small retract
      moves.push({ rapid: true, x: dia + 1.5, z: clr });   // rapid back
    }
    passes.push({ op: 'rough', label: 'Rough turn', color: OP_COLORS.rough, toolNo: 1, tool: 'OD turning — 80° rhombic insert (C/DNMG)', rpm: roughRpm, feed: m.feedRough, moves });
  }

  // --- 3) Drilling the bore (on centre) --------------------------------------
  if (profile.boreDiaMm > 0 && profile.boreDepthMm > 0) {
    const drillRpm = Math.round(rpm(m.cuttingSpeedRough * 0.5, profile.boreDiaMm, cfg.maxRpm));
    const moves: TPMove[] = [
      { rapid: true, x: 0, z: clr },
      { rapid: false, x: 0, z: -profile.boreDepthMm },
      { rapid: true, x: 0, z: clr },
    ];
    passes.push({ op: 'drill', label: `Drill ⌀${r3(profile.boreDiaMm)} bore`, color: OP_COLORS.drill, toolNo: 2, tool: `⌀${r3(profile.boreDiaMm)} mm carbide drill`, rpm: drillRpm, feed: m.feedRough * 0.6, moves });
  }

  // --- 4) Finishing: one clean pass along the final OD ------------------------
  const finishRpm = Math.round(rpm(m.cuttingSpeedFinish, od, cfg.maxRpm));
  {
    const moves: TPMove[] = [
      { rapid: true, x: od, z: clr },
      { rapid: false, x: od, z: -len },
      { rapid: false, x: od + 2, z: -len },
      { rapid: true, x: od + 2, z: clr },
    ];
    passes.push({ op: 'finish', label: 'Finish turn', color: OP_COLORS.finish, toolNo: 3, tool: 'OD finishing — 35° insert (V/DCGT, sharp)', rpm: finishRpm, feed: m.feedFinish, moves });
  }

  // --- 5) Part-off at length --------------------------------------------------
  {
    const partRpm = Math.round(rpm(m.cuttingSpeedFinish * 0.6, od, cfg.maxRpm));
    const moves: TPMove[] = [
      { rapid: true, x: stock + 2, z: -len },
      { rapid: false, x: profile.boreDiaMm > 0 ? profile.boreDiaMm : -1, z: -len },
      { rapid: true, x: stock + 2, z: -len },
    ];
    passes.push({ op: 'partoff', label: 'Part-off', color: OP_COLORS.partoff, toolNo: 4, tool: 'Parting blade — 3 mm wide', rpm: partRpm, feed: 0.05, moves });
  }

  return {
    stockDiaMm: stock,
    stockLengthMm: len + cfg.clearanceMm,
    partOdMm: od,
    boreDiaMm: profile.boreDiaMm,
    boreDepthMm: profile.boreDepthMm,
    lengthMm: len,
    passes,
  };
}

/** Emit an operator-checkable G-code skeleton. REFERENCE ONLY — never run un-verified. */
export function toGcode(tp: Toolpath, opts: { partName?: string; materialName?: string } = {}): string {
  const L: string[] = [];
  const p = (s = '') => L.push(s);
  p('%');
  p('O0001 (QUOTEFORGE REFERENCE TOOLPATH - VERIFY BEFORE RUNNING)');
  p(`(Part: ${opts.partName || 'turned part'})`);
  if (opts.materialName) p(`(Material: ${opts.materialName})`);
  p(`(Stock: DIA ${r3(tp.stockDiaMm)} x LEN ${r3(tp.stockLengthMm)} mm)`);
  p('(Diameter programming, mm, feed/rev. NOT post-processed for any control.)');
  p('(--- ASSUMED TOOLING (generic - set your own offsets/inserts) ---)');
  {
    const seen = new Set<number>();
    for (const pass of tp.passes) {
      if (seen.has(pass.toolNo)) continue;
      seen.add(pass.toolNo);
      p(`(T${String(pass.toolNo).padStart(2, '0')}: ${pass.tool})`);
    }
  }
  p('G21 G18 G99');
  p('G40');
  for (const pass of tp.passes) {
    p('');
    p(`(--- ${pass.label.toUpperCase()} ---)`);
    p(`T${String(pass.toolNo).padStart(2, '0')}${String(pass.toolNo).padStart(2, '0')}`);
    p(`G97 S${pass.rpm} M03`);
    let first = true;
    for (const mv of pass.moves) {
      const code = mv.rapid ? 'G00' : 'G01';
      const f = !mv.rapid && first ? ` F${r3(pass.feed)}` : '';
      p(`${code} X${r3(mv.x)} Z${r3(mv.z)}${f}`);
      if (!mv.rapid) first = false;
    }
    p('M09');
  }
  p('');
  p('M05');
  p('M30');
  p('%');
  return L.join('\n');
}
