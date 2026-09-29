/**
 * WHAT THE MACHINE ACTUALLY DOES, operation by operation.
 *
 * Two cycle-time sheets from Turncircuit, transcribed as written. Where
 * `quotes.ts` is the truth about what a part was CHARGED and `drawings.ts` the
 * truth about what a part IS, this is the truth about what the spindle DID:
 * every operation in order, its cutting seconds, its idle seconds, and the tool
 * that ran it.
 *
 * IT SETTLES THE QUESTION THIS PROJECT HAS BEEN STUCK ON.
 *
 * Cycle time has been scored against the router's `cycleMin`, and the router is
 * not a measurement. The VOC housing books 45 min across its two Mori ops and
 * the machine takes 8.28. The hollow arm books 60 min on the NTX for the head-1
 * work the sheet covers in 23.02. So the model has been judged against a figure
 * 2.6x to 5.4x larger than the thing it predicts, and most of the "we are
 * twenty times too fast" was a target, not an error.
 *
 * Against the sheets the real gap is about 4.8x, and it is remarkably even:
 * cutting x0.21 and idle x0.22 on the housing. That is a different diagnosis
 * from the dynamic-range problem the router figures implied.
 *
 * DELIBERATELY RAW, same rule as the other two files: transcriptions, not
 * derived values. A wrong number here means a sheet was misread.
 */

export interface SheetOp {
  /** As written on the sheet, including the tool where it names one. */
  operation: string;
  cuttingSec: number;
  idleSec: number;
}

export interface CycleSheet {
  /** Matches QuotedPart.drawing so the two can be joined. */
  drawing: string;
  title: string;
  machine: string;
  /**
   * What the sheet covers. The hollow arm's sheet is HEAD 1 only — its router
   * has a second op on the mini mill that this does not include — so comparing
   * it with the part's whole router would be comparing different things.
   */
  scope: string;
  ops: SheetOp[];
  /** As printed on the sheet, kept to check the transcription adds up. */
  statedCuttingSec: number;
  statedIdleSec: number;
  statedCycleMin: number;
}

export const CYCLE_SHEETS: CycleSheet[] = [
  {
    drawing: '031169-A',
    title: 'VOC Carbsorb Housing',
    machine: 'Mori NL2000Y',
    scope: 'the whole bar job, bar stop through part-off',
    ops: [
      { operation: 'Bar stop process - pull bar to stop - close door', cuttingSec: 0, idleSec: 30 },
      { operation: 'Rough turn front boss diameter (21mm)', cuttingSec: 36, idleSec: 12 },
      { operation: 'Drill 10mm thro hole with pilot drill (40mm deep) - solid carbide drill', cuttingSec: 36, idleSec: 14 },
      { operation: 'Rough/finish turn bore for G1/4 thread - S08K SCLCR-06 - CCMT 060202', cuttingSec: 32, idleSec: 18 },
      { operation: 'Drill 10mm HSS drill (70mm deep)', cuttingSec: 36, idleSec: 22 },
      { operation: 'Screw cut internal G1/4 thread - SNVRC10U-5LK 5LKIR 19 BSPT', cuttingSec: 40, idleSec: 18 },
      { operation: 'Deburr bore chamfer', cuttingSec: 12, idleSec: 12 },
      { operation: 'Deburr thread - G1/4 - SNVRC10U-5LK 5LKIR 19 BSPT', cuttingSec: 20, idleSec: 12 },
      { operation: 'Finish front boss diameter and flange - SDJCR 11K - CCGT 11T302', cuttingSec: 13, idleSec: 12 },
      { operation: 'Rough and finish recess - 760-20 - 764zxt-12-3.0-r100 TIALN', cuttingSec: 68, idleSec: 20 },
      { operation: 'Part off - horn RH224.2020.23 LS224 0530 C0 TN35', cuttingSec: 20, idleSec: 14 },
    ],
    statedCuttingSec: 313,
    statedIdleSec: 184,
    statedCycleMin: 8.28333,
  },
  {
    drawing: 'OLY014_01921-A',
    title: 'Hollow Arm Bulkhead, Short',
    machine: 'Mori NTX1000',
    scope: 'HEAD 1 only — the router also has a mini-mill second op',
    ops: [
      { operation: 'Bar stop process - pull bar to stop - close door', cuttingSec: 0, idleSec: 30 },
      { operation: 'Spot drill for 3.3mm diameter holes', cuttingSec: 5, idleSec: 10 },
      { operation: 'Drill 3.3mm diameter 7mm deep in two positions - carbide drill', cuttingSec: 12, idleSec: 14 },
      { operation: 'Spot drill for 0.9mm diameter hole - carbide drill', cuttingSec: 2, idleSec: 19 },
      { operation: 'Drill 1.0mm diameter hole from both sides - radial position - 1.0mm carbide', cuttingSec: 11, idleSec: 15 },
      { operation: '2.0mm diameter end mill - mill face slot', cuttingSec: 56, idleSec: 12 },
      { operation: '2mm diameter end mill carbide - mill radial profile of front tang', cuttingSec: 78, idleSec: 14 },
      { operation: '2mm carbide end mill - mill 210 deg angled slot face', cuttingSec: 58, idleSec: 16 },
      { operation: '3.3mm diameter drill - drill through', cuttingSec: 20, idleSec: 14 },
      { operation: '2.5mm diameter end mill - mill 3.3mm dia slots thro', cuttingSec: 150, idleSec: 30 },
      { operation: '1.4mm diameter drill - spot drill on flange', cuttingSec: 30, idleSec: 18 },
      { operation: '0.7mm diameter drill - drill 0.7mm on a 6.5mm PCD in 6 places', cuttingSec: 64, idleSec: 18 },
      { operation: '2.5mm diameter end mill - deburr 3.3mm dia slots thro', cuttingSec: 150, idleSec: 30 },
      { operation: '1.0mm diameter end mill - mill 0.7mm diameter holes', cuttingSec: 360, idleSec: 60 },
      { operation: '50mm diameter by 1.0mm wide slitting saw - cut off', cuttingSec: 55, idleSec: 30 },
    ],
    statedCuttingSec: 1051,
    statedIdleSec: 330,
    statedCycleMin: 23.0167,
  },
];

// --- Derived views. Arithmetic on the evidence, never fitted to it. ---------

export const sheetCuttingSec = (s: CycleSheet) => s.ops.reduce((a, o) => a + o.cuttingSec, 0);
export const sheetIdleSec = (s: CycleSheet) => s.ops.reduce((a, o) => a + o.idleSec, 0);
export const sheetCycleSec = (s: CycleSheet) => sheetCuttingSec(s) + sheetIdleSec(s);

/**
 * Idle seconds per operation — the figure our per-operation approach and tool
 * change together are trying to predict. It comes out at 16.7 s on the housing
 * and 22.0 s on the hollow arm, against the ~5.3 s the model charges.
 */
export const idlePerOpSec = (s: CycleSheet) =>
  sheetIdleSec(s) / Math.max(1, s.ops.length);

/**
 * What the ROUTER books for the same work, from quotes.ts, over what the machine
 * measures. Not a correction factor to multiply by — a warning that the two
 * numbers are different things, and that only one of them is a cycle time.
 */
export const ROUTER_OVER_MEASURED = {
  '031169-A': { routerMin: 45, measuredMin: 8.28, ratio: 5.4 },
  'OLY014_01921-A': { routerMin: 60, measuredMin: 23.02, ratio: 2.6, note: 'head 1 vs op 10' },
} as const;
