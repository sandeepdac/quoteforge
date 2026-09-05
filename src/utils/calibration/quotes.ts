/**
 * THE EVIDENCE BASE.
 *
 * Seven real quotes from Turncircuit, transcribed from Lance's system: the
 * router he ran, the rates on it, the quantity, and what he charged. This is the
 * only external truth this project has about what a machined part costs.
 *
 * It is deliberately RAW. No fitted coefficients live here, no derived
 * multipliers, nothing that a model wants to be true. A model is scored against
 * this file; it never edits it. When a number here is wrong, it is wrong because
 * a screenshot was misread, and the fix is to re-read the screenshot.
 *
 * WHY THIS SHAPE. The first instinct after seeing seven quotes was to divide
 * Lance's setup minutes by ours, get "about 3.5x", and put that in a constant.
 * That number would have been fitted to seven points, carried no mechanism, and
 * failed silently on the eighth part with nothing to say about why. Worse, it
 * could not be argued with: you cannot take "x3.5" to a machinist and ask if it
 * is right. Every field below is something Lance could confirm or correct in one
 * sentence, which is the test of whether a model is qualitative or just fitted.
 */

/** A work centre as Lance names it. Not our MachineId — his vocabulary. */
export type WorkCentre =
  | 'Mori' | 'NTX1000' | 'MINI MILL' | 'HAAS VF2' | 'SR20' | 'SR#32' | 'XD10'
  | 'PROG' | 'IN' | 'CLEAN' | 'SCHEAT' | 'SCPLAT';

/** What kind of work a centre does. Decides whether it is a MACHINING op. */
export const CENTRE_KIND: Record<WorkCentre, 'machining' | 'programming' | 'inspection' | 'finishing' | 'subcontract'> = {
  'Mori': 'machining', 'NTX1000': 'machining', 'MINI MILL': 'machining',
  'HAAS VF2': 'machining', 'SR20': 'machining', 'SR#32': 'machining', 'XD10': 'machining',
  'PROG': 'programming',
  'IN': 'inspection',
  'CLEAN': 'finishing',
  'SCHEAT': 'subcontract', 'SCPLAT': 'subcontract',
};

export interface RouterOp {
  op: number;
  centre: WorkCentre;
  description: string;
  /** One-time, for the whole batch. */
  setupMin: number;
  /** Per `cycleQty` parts — NOT always per part. Inspection is often batched. */
  cycleMin: number;
  /** How many parts one `cycleMin` covers. 1 = per part. */
  cycleQty: number;
  moveMin: number;
  setupRate: number;
  cycleRate: number;
}

export interface QuotedPart {
  drawing: string;
  title: string;
  material: string;
  /** Substring identifying the STEP file, when we hold the geometry. */
  stepMatch?: string;
  router: RouterOp[];
  /** One entry per quantity Lance priced. Two entries let setup and cycle be
   *  solved independently rather than fitted — see `solveSetupAndCycle`. */
  pricing: {
    qty: number;
    processCost: number;
    materialCost: number;
    subconCost: number;
    miscCost: number;
    totalCost: number;
    quotedPrice: number;
    marginPercent: number;
  }[];
}

export const QUOTED_PARTS: QuotedPart[] = [
  {
    drawing: '031169-A', title: 'VOC Carbsorb Housing', material: 'Brass BS2874 CZ121',
    stepMatch: '031169',
    router: [
      { op: 10, centre: 'Mori', description: 'M/C all parts accept thread at back', setupMin: 180, cycleMin: 30, cycleQty: 1, moveMin: 0, setupRate: 40, cycleRate: 40 },
      { op: 20, centre: 'Mori', description: 'M/C thread and face', setupMin: 30, cycleMin: 15, cycleQty: 1, moveMin: 0, setupRate: 40, cycleRate: 40 },
      { op: 30, centre: 'IN', description: 'Final inspection', setupMin: 15, cycleMin: 15, cycleQty: 1, moveMin: 0, setupRate: 35, cycleRate: 35 },
    ],
    pricing: [{ qty: 1, processCost: 176.50, materialCost: 50.00, subconCost: 0, miscCost: 7.50, totalCost: 234.00, quotedPrice: 356.00, marginPercent: 34.27 }],
  },
  {
    drawing: '029068', title: 'Removable Collet Holding Block', material: 'Phosphor bronze PB102',
    stepMatch: '029068',
    router: [
      { op: 10, centre: 'SR20', description: 'Machine complete to customer drawings', setupMin: 240, cycleMin: 1.9, cycleQty: 1, moveMin: 60, setupRate: 50, cycleRate: 38 },
      { op: 20, centre: 'IN', description: 'Final inspection', setupMin: 6, cycleMin: 10, cycleQty: 6, moveMin: 0, setupRate: 35, cycleRate: 35 },
    ],
    pricing: [{ qty: 6, processCost: 22.28, materialCost: 0.23, subconCost: 0, miscCost: 5.00, totalCost: 27.51, quotedPrice: 44.50, marginPercent: 38.18 }],
  },
  {
    drawing: 'OLY014_01921-A', title: 'Hollow arm bulkhead, short', material: 'Stainless',
    stepMatch: 'OLY014_01921',
    router: [
      { op: 5,  centre: 'PROG', description: 'Programming', setupMin: 150, cycleMin: 0, cycleQty: 1, moveMin: 1440, setupRate: 40, cycleRate: 40 },
      { op: 10, centre: 'NTX1000', description: 'Machine complete to customer drawings', setupMin: 1200, cycleMin: 60, cycleQty: 1, moveMin: 20, setupRate: 50, cycleRate: 50 },
      { op: 20, centre: 'MINI MILL', description: 'M/C op 2', setupMin: 600, cycleMin: 20, cycleQty: 1, moveMin: 0, setupRate: 40, cycleRate: 40 },
      { op: 30, centre: 'IN', description: 'Final inspection', setupMin: 120, cycleMin: 15, cycleQty: 1, moveMin: 0, setupRate: 35, cycleRate: 35 },
    ],
    pricing: [{ qty: 15, processCost: 149.50, materialCost: 0.13, subconCost: 0, miscCost: 20.00, totalCost: 169.63, quotedPrice: 267.00, marginPercent: 36.47 }],
  },
  {
    drawing: 'NAUT_01695-C', title: 'Guide Rod', material: '416 Stainless (Temper H)',
    stepMatch: 'NAUT_01695',
    router: [
      { op: 10, centre: 'XD10', description: 'Machine part complete to drawing', setupMin: 180, cycleMin: 1.5, cycleQty: 1, moveMin: 60, setupRate: 50, cycleRate: 40 },
      { op: 20, centre: 'CLEAN', description: 'Degrease, no residue in blind holes', setupMin: 5, cycleMin: 15, cycleQty: 100, moveMin: 0, setupRate: 30, cycleRate: 30 },
      { op: 25, centre: 'SCHEAT', description: 'Harden and temper', setupMin: 0, cycleMin: 0, cycleQty: 1, moveMin: 2880, setupRate: 0, cycleRate: 0 },
      { op: 30, centre: 'IN', description: 'Final inspection', setupMin: 10, cycleMin: 20, cycleQty: 100, moveMin: 0, setupRate: 35, cycleRate: 35 },
    ],
    pricing: [{ qty: 100, processCost: 1.90, materialCost: 1.70, subconCost: 3.00, miscCost: 0, totalCost: 6.60, quotedPrice: 10.40, marginPercent: 36.51 }],
  },
  {
    drawing: 'OLY014_01297-A', title: 'Toolset Drive Unit — Drive Dog', material: 'POM-H',
    stepMatch: 'OLY014_01297',
    router: [
      { op: 10, centre: 'SR#32', description: 'Machine complete to customer drawings', setupMin: 900, cycleMin: 15, cycleQty: 1, moveMin: 0, setupRate: 50, cycleRate: 50 },
      { op: 20, centre: 'IN', description: 'Final inspection', setupMin: 15, cycleMin: 15, cycleQty: 30, moveMin: 0, setupRate: 35, cycleRate: 35 },
    ],
    // TWO quantities on one router — the only rows in the set that let setup and
    // cycle be separated without assuming anything.
    pricing: [
      { qty: 68,  processCost: 14.48, materialCost: 0.15, subconCost: 0, miscCost: 2.00, totalCost: 16.62, quotedPrice: 28.50, marginPercent: 41.67 },
      { qty: 102, processCost: 12.24, materialCost: 0.15, subconCost: 0, miscCost: 2.00, totalCost: 14.38, quotedPrice: 23.00, marginPercent: 37.47 },
    ],
  },
  {
    drawing: '032736-01', title: 'Cold Stage Block', material: 'Copper C103',
    stepMatch: '032736',
    router: [
      { op: 10, centre: 'NTX1000', description: 'Machine complete to customer drawings', setupMin: 600, cycleMin: 20, cycleQty: 1, moveMin: 0, setupRate: 50, cycleRate: 50 },
      { op: 20, centre: 'MINI MILL', description: 'Skim ends and m/c finished', setupMin: 210, cycleMin: 5, cycleQty: 1, moveMin: 0, setupRate: 40, cycleRate: 40 },
      { op: 25, centre: 'SCPLAT', description: 'Gold plate to Quorum spec eng-quo-2013 cat g2', setupMin: 0, cycleMin: 0, cycleQty: 1, moveMin: 3000, setupRate: 25, cycleRate: 0 },
      { op: 30, centre: 'IN', description: 'Final inspection', setupMin: 15, cycleMin: 30, cycleQty: 10, moveMin: 0, setupRate: 35, cycleRate: 35 },
    ],
    pricing: [{ qty: 10, processCost: 72.05, materialCost: 14.09, subconCost: 18.50, miscCost: 3.00, totalCost: 107.64, quotedPrice: 136.00, marginPercent: 20.85 }],
  },
  {
    drawing: '035838-A', title: 'Bulkhead C Clamp — KF16/KF10', material: 'Aluminium 6082 (HE30)',
    stepMatch: '035838',
    router: [
      { op: 10, centre: 'Mori', description: 'Mill op 1', setupMin: 240, cycleMin: 7, cycleQty: 1, moveMin: 20, setupRate: 40, cycleRate: 40 },
      { op: 20, centre: 'HAAS VF2', description: 'Face mill to length and deburr edges', setupMin: 60, cycleMin: 1.5, cycleQty: 1, moveMin: 20, setupRate: 40, cycleRate: 40 },
      { op: 30, centre: 'IN', description: 'Final inspection', setupMin: 10, cycleMin: 10, cycleQty: 2, moveMin: 0, setupRate: 35, cycleRate: 35 },
    ],
    pricing: [{ qty: 15, processCost: 20.88, materialCost: 1.67, subconCost: 0, miscCost: 0, totalCost: 22.55, quotedPrice: 33.50, marginPercent: 32.69 }],
  },
];

// --- Derived views. Arithmetic on the evidence, never fitted to it. ----------

export const totalSetupMin = (p: QuotedPart) =>
  p.router.reduce((a, o) => a + o.setupMin, 0);

export const cycleMinPerPart = (p: QuotedPart) =>
  p.router.reduce((a, o) => a + o.cycleMin / Math.max(1, o.cycleQty), 0);

export const machiningOps = (p: QuotedPart) =>
  p.router.filter((o) => CENTRE_KIND[o.centre] === 'machining');

/** Minutes of work the router says go into one part at a given quantity. */
export const routerMinutesPerPart = (p: QuotedPart, qty: number) =>
  totalSetupMin(p) / qty + cycleMinPerPart(p);

/**
 * The rate Lance's PROCESS COST implies, given his own router minutes.
 *
 * This is the single most load-bearing observation in the set, and it is an
 * observation rather than a fit: it comes out at exactly £30.00/hr on every part
 * whose router has ONE machining op, and £36.67-£39.12 on every part with two.
 * The £40-£135/hr per-machine rates in our own catalog do not appear anywhere in
 * what he charges.
 */
export const impliedRatePerHour = (p: QuotedPart, i = 0) =>
  (p.pricing[i].processCost * 60) / routerMinutesPerPart(p, p.pricing[i].qty);

/**
 * Where a part is quoted at two quantities, setup and cycle can be SOLVED rather
 * than assumed: process = S/N + C is two equations in two unknowns.
 * Returns money, not minutes — £ of setup per batch and £ of cycle per part.
 */
export function solveSetupAndCycle(p: QuotedPart): { setupPerBatch: number; cyclePerPart: number } | null {
  if (p.pricing.length < 2) return null;
  const [a, b] = p.pricing;
  const setupPerBatch = (a.processCost - b.processCost) / (1 / a.qty - 1 / b.qty);
  return { setupPerBatch, cyclePerPart: a.processCost - setupPerBatch / a.qty };
}
