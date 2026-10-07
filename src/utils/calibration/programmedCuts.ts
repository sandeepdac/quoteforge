/**
 * WHAT LANCE'S PROGRAMS ACTUALLY RUN: speed, feed, depth and CAM time per tool.
 *
 * Two process write-ups from Turncircuit, transcribed as written:
 *   - DATA ON MINI MILL OR VF2 MACHINING PROCESS  (aluminium base block)
 *   - DATA ON NTX MILL TURN MACHINING PROCESS     (316 stainless hinge)
 *
 * Unlike the cycle sheets (round-number estimates, one cell a formula pointing
 * at another row) these carry the programmed spindle speed, feed rate and depth
 * of cut per tool, and a machining time that equals toolpath length / feed. They
 * are the shop's own cutting data, so they are an input the four-source rule
 * allows: a shop setting, not a fit to an outcome.
 *
 * Which part each belongs to is inferred from the material (aluminium -> the
 * base block S17604_00415-A, 316 -> OLY014_02062-A); the documents do not name
 * the part. DELIBERATELY RAW: where a figure looks wrong it is kept as written
 * and flagged, not corrected.
 */

export type CutKind = 'face' | 'flat' | 'ball' | 'spot' | 'drill' | 'ream' | 'chamfer';

export interface ProgrammedCut {
  step: number;
  tool: string;
  kind: CutKind;
  diaMm: number;
  flutes: number;
  /** Programmed spindle speed, rpm, as written. */
  rpm: number;
  /** Programmed feed, mm/min, as written. */
  feedMmMin: number;
  /** Depth of cut per pass (mm), as written; for hole tools the total depth. */
  apMm: number;
  passes?: number;
  /** Machining time as written, seconds. */
  timeSec: number;
  /** Anything the write-up says that changes how to read the row. */
  note?: string;
  /** The row's own numbers disagree; kept as written. */
  suspect?: string;
}

export interface ProgrammedPart {
  /** Part this is inferred to belong to (see file header). */
  part: string;
  machine: string;
  material: string;
  cuts: ProgrammedCut[];
  /** Sum of the times as written. */
  statedTotalSec: number;
}

export const PROGRAMMED_PARTS: ProgrammedPart[] = [
  {
    part: 'S17604_00415-A Base Block',
    machine: 'Mini mill / Haas VF2',
    material: 'Aluminium alloy',
    statedTotalSec: 408,
    cuts: [
      { step: 1, tool: '40 face mill, 3F', kind: 'face', diaMm: 40, flutes: 3, rpm: 8000, feedMmMin: 3600, apMm: 0.5, passes: 1, timeSec: 9, note: 'face off top of block' },
      { step: 2, tool: '40 face mill, 3F', kind: 'face', diaMm: 40, flutes: 3, rpm: 3980, feedMmMin: 1910, apMm: 1, passes: 15, timeSec: 177, note: 'rough around square shape, 0.25 left' },
      { step: 4, tool: '40 face mill, 3F', kind: 'face', diaMm: 40, flutes: 3, rpm: 3980, feedMmMin: 1910, apMm: 1, passes: 10, timeSec: 167, note: 'rough around lower shape, 0.25 left on wall' },
      { step: 3, tool: '8 end mill, 3F', kind: 'flat', diaMm: 8, flutes: 3, rpm: 10000, feedMmMin: 3000, apMm: 2, passes: 6, timeSec: 12, note: 'rough slots either side' },
      { step: 5, tool: '8 end mill, 3F', kind: 'flat', diaMm: 8, flutes: 3, rpm: 10000, feedMmMin: 3600, apMm: 1.65, passes: 1, timeSec: 5, note: 'rough slot on top' },
      { step: 6, tool: '8 end mill, 3F', kind: 'flat', diaMm: 8, flutes: 3, rpm: 10000, feedMmMin: 5400, apMm: 15, passes: 1, timeSec: 6, note: 'finish around top square, 0.25 wall' },
      { step: 7, tool: '8 end mill, 3F', kind: 'flat', diaMm: 8, flutes: 3, rpm: 10000, feedMmMin: 4800, apMm: 0.25, timeSec: 11, note: 'finish mid-level faces' },
      { step: 8, tool: '8 end mill, 3F', kind: 'flat', diaMm: 8, flutes: 3, rpm: 10000, feedMmMin: 5400, apMm: 10.5, passes: 1, timeSec: 8, note: 'finish base and side slots' },
      { step: 9, tool: '5 end mill, 3F', kind: 'flat', diaMm: 5, flutes: 3, rpm: 10000, feedMmMin: 3600, apMm: 1.8, passes: 1, timeSec: 5, note: 'finish wall and face of top slot' },
      { step: 10, tool: '3 spot drill, 2F', kind: 'spot', diaMm: 3, flutes: 2, rpm: 10000, feedMmMin: 1000, apMm: 1.5, passes: 1, timeSec: 4 },
      { step: 11, tool: '3 reamer H7, 6F', kind: 'ream', diaMm: 3, flutes: 6, rpm: 5000, feedMmMin: 4500, apMm: 25, passes: 1, timeSec: 4, note: 'through the 25 mm part' },
    ],
  },
  {
    part: 'OLY014_02062-A Steel HA Shoulder Hinge',
    machine: 'Mori NTX1000',
    material: '316 stainless steel',
    statedTotalSec: 635,
    cuts: [
      { step: 1, tool: '40 face mill, 3F', kind: 'face', diaMm: 40, flutes: 3, rpm: 637, feedMmMin: 360, apMm: 0.5, passes: 1, timeSec: 14 },
      { step: 2, tool: '6.0 spot drill, 2F', kind: 'spot', diaMm: 6, flutes: 2, rpm: 135, feedMmMin: 2385, apMm: 1.5, passes: 1, timeSec: 6,
        suspect: '135 rpm at 2385 mm/min is 17.7 mm/rev; 13,500 rpm would give 0.18 mm/rev, so probably a dropped digit' },
      { step: 3, tool: '3.2 solid carbide drill, 2F', kind: 'drill', diaMm: 3.2, flutes: 2, rpm: 4476, feedMmMin: 147, apMm: 10, timeSec: 4, note: '1.6 mm peck' },
      { step: 4, tool: '3.0 end mill, 3F', kind: 'flat', diaMm: 3, flutes: 3, rpm: 9020, feedMmMin: 520, apMm: 0.5, passes: 10, timeSec: 256, note: 'pocket 5 mm deep' },
      { step: 5, tool: '3.0 end mill, 3F', kind: 'flat', diaMm: 3, flutes: 3, rpm: 9020, feedMmMin: 520, apMm: 0.5, passes: 2, timeSec: 100, note: 'pocket 5-6 mm, avoiding a feature' },
      { step: 6, tool: '1.0 end mill, 3F', kind: 'flat', diaMm: 1, flutes: 3, rpm: 12000, feedMmMin: 240, apMm: 0.25, passes: 4, timeSec: 13, note: '5-6 mm deep' },
      { step: 7, tool: '3.0 end mill, 3F', kind: 'flat', diaMm: 3, flutes: 3, rpm: 9020, feedMmMin: 520, apMm: 0.25, passes: 12, timeSec: 69, note: 'stairs 6-9 mm deep' },
      { step: 8, tool: '3.0 end mill, 3F', kind: 'flat', diaMm: 3, flutes: 3, rpm: 9020, feedMmMin: 520, apMm: 0.5, passes: 8, timeSec: 86, note: 'rough outer stock 6-10 mm deep' },
      { step: 9, tool: '3.0 end mill, 3F', kind: 'chamfer', diaMm: 3, flutes: 3, rpm: 10610, feedMmMin: 850, apMm: 0.5, passes: 6, timeSec: 7, note: 'under 10% engagement, so faster feed and speed' },
      { step: 10, tool: '1.0 ball nose, 2F', kind: 'ball', diaMm: 1, flutes: 2, rpm: 12000, feedMmMin: 290, apMm: 6.22, passes: 1, timeSec: 7, note: 'under 10% engagement' },
      { step: 11, tool: '1.0 ball nose, 2F', kind: 'ball', diaMm: 1, flutes: 2, rpm: 12000, feedMmMin: 610, apMm: 0.018, timeSec: 73, note: '0.018 mm passes, 1.8 mm deep surface' },
    ],
  },
];

// --- Derived views. Arithmetic on the evidence, never fitted to it. ---------

/** Chip load, mm per tooth: feed / (rpm x flutes). */
export const programmedFzMm = (c: ProgrammedCut) => c.feedMmMin / (c.rpm * c.flutes);

/** Surface speed, m/min: pi x D x n / 1000. */
export const programmedVcMMin = (c: ProgrammedCut) => (Math.PI * c.diaMm * c.rpm) / 1000;

/** Axial depth as a fraction of the cutter diameter. */
export const programmedApOverD = (c: ProgrammedCut) => c.apMm / c.diaMm;

/** Path length the CAM time implies, mm: feed x time. */
export const impliedPathMm = (c: ProgrammedCut) => (c.feedMmMin * c.timeSec) / 60;

export const programmedTotalSec = (p: ProgrammedPart) => p.cuts.reduce((a, c) => a + c.timeSec, 0);
