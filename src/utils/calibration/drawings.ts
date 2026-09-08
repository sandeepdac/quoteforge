/**
 * WHAT THE DRAWINGS SAY.
 *
 * Eleven 2D drawings from Turncircuit, transcribed by reading them. Where
 * `quotes.ts` is the truth about what a part COST, this is the truth about what
 * a part IS — the callouts a machinist works to, which the geometry service can
 * only infer from a solid.
 *
 * It exists because inference and callout disagree in ways that cost money, and
 * without this file those disagreements were invisible. Three examples, all of
 * them found by reading these sheets against our own extraction:
 *
 *   - The C clamp carries R1.0 in six places and R2.0 in four. Every one of them
 *     was being counted as an off-axis machining operation with its own spindle
 *     orient and tool change: ten phantom operations on a part with seven real
 *     ones, and the reason it quoted 36% high.
 *   - The VOC housing's ⌀11.80 counterbore is 14.0 deep, not the 70 mm the bore
 *     grouping reported before contiguity was checked. The drawing settles it.
 *   - Every single part on these sheets has a THREAD. None of them is costed.
 *
 * DELIBERATELY RAW, same rule as quotes.ts: these are transcriptions, not
 * derived values. When a number here is wrong it is because a drawing was
 * misread, and the fix is to look at the drawing again.
 */

/** A hole exactly as the drawing calls it out. */
export interface DrawnHole {
  diameterMm: number;
  /** How many of this hole the drawing asks for. */
  count: number;
  /** Depth in mm, or 'thru'. */
  depthMm?: number;
  thru?: boolean;
  /** A counterbore or countersink sitting on top of this hole. */
  counterboreMm?: { diameterMm: number; depthMm: number };
  countersinkMm?: { diameterMm: number; includedDeg: number };
  /** Reamed / H7 and similar — a drill AND a ream, not one operation. */
  fitClass?: string;
}

export interface DrawnThread {
  /** As written on the drawing: 'M6 x 1.0', 'G1/4 - 6H', '1/8 Rc'. */
  callout: string;
  count: number;
  depthMm?: number;
  thru?: boolean;
}

export interface DrawnPart {
  drawing: string;
  title: string;
  material: string;
  /** The machine written on the drawing by hand, in Lance's own shorthand. */
  handwrittenMachine?: string;
  /** Substring identifying the STEP file, when we hold the geometry. */
  stepMatch?: string;
  holes: DrawnHole[];
  threads: DrawnThread[];
  /** Chamfers as called out, e.g. '1.5 x 45' with a count. */
  chamfers: Array<{ callout: string; count: number }>;
  /** Corner radii — NOT machining operations, and the source of a real bug. */
  filletRadiiMm: Array<{ radiusMm: number; count: number }>;
  /** Off-axis operations the drawing implies, for checking crossFeatureList. */
  offAxisFeatureCount?: number;
  /** Finish / treatment callouts that imply a secondary operation. */
  finish?: string;
  notes?: string[];
}

export const DRAWN_PARTS: DrawnPart[] = [
  {
    drawing: '035838-A', title: 'Bulkhead C Clamp — KF16/KF10 Vacuum Manifold',
    material: 'Aluminium 6082 (HE30)', handwrittenMachine: 'NTX or NL', stepMatch: '035838',
    holes: [
      { diameterMm: 5.5, count: 2, thru: true, counterboreMm: { diameterMm: 10.0, depthMm: 5.4 } },
      { diameterMm: 24.0, count: 1, depthMm: 1.9 },
      { diameterMm: 30.0, count: 1, depthMm: 6.5 },
    ],
    threads: [],
    chamfers: [{ callout: '15.0 deg', count: 1 }],
    filletRadiiMm: [{ radiusMm: 2.0, count: 4 }, { radiusMm: 1.0, count: 6 }],
    // 2 holes + 2 counterbores + 2 bores + the R25.40 throat.
    offAxisFeatureCount: 7,
    finish: 'CLEAN AND BURR FREE',
    notes: ['R25.40 throat — the C shape, a real profiling operation', '43.00 x 7.00 +/-0.10, 9.20 thick'],
  },
  {
    drawing: '032736-01', title: 'Cold Stage Block',
    material: 'Copper C103', handwrittenMachine: 'VF2', stepMatch: '032736',
    holes: [
      { diameterMm: 3.4, count: 2, thru: true,
        countersinkMm: { diameterMm: 6.72, includedDeg: 90 },
        counterboreMm: { diameterMm: 6.72, depthMm: 2.5 } },
      { diameterMm: 1.6, count: 2, depthMm: 8.0 },
      { diameterMm: 1.0, count: 1, thru: true },
      { diameterMm: 24.0, count: 1, depthMm: 3.5 },
    ],
    threads: [{ callout: 'M2 - 6H', count: 2, depthMm: 7.0 }],
    chamfers: [{ callout: '1.5 x 45', count: 1 }],
    filletRadiiMm: [],
    offAxisFeatureCount: 9,
    finish: 'GOLD PLATE TO QUORUM SPEC ENG-QUO-2013 CAT G2 — no visible defects or scratches',
    notes: ['R5.25 scallop is a real internal radius, not a corner round', 'Flatness 0.05'],
  },
  {
    drawing: '031169-A', title: 'VOC Carbsorb Housing',
    material: 'Brass BS2874 CZ121', handwrittenMachine: 'NL MORI', stepMatch: '031169',
    holes: [
      // ONE AT EACH END. Our hole grouping reports a single entry, so the second
      // is not billed — a known, drawing-confirmed understatement.
      { diameterMm: 11.8, count: 2, depthMm: 14.0 },
      { diameterMm: 10.0, count: 1, thru: true },
    ],
    threads: [{ callout: 'G1/4 - 6H', count: 2, depthMm: 12.0 }],
    chamfers: [{ callout: '30.0 deg', count: 4 }, { callout: '0.50 x 45', count: 2 }],
    filletRadiiMm: [],
    offAxisFeatureCount: 0,
    finish: 'CLEAN AND BURR FREE',
    notes: ['Hex bar, 25.40 across flats', '70.00 long, ⌀21.0 body',
            'Ra 0.4 sealing faces — free from scratches and chatter marks'],
  },
  {
    drawing: '029068', title: 'Removable Collet Holding Block',
    material: 'Phosphor bronze PB102', handwrittenMachine: 'SR20', stepMatch: '029068',
    holes: [
      { diameterMm: 5.0, count: 1, depthMm: 5.0 },
      { diameterMm: 1.7, count: 1 },
      { diameterMm: 1.1, count: 1 },
    ],
    threads: [{ callout: 'M6 x 1.0', count: 1, depthMm: 4.6 }],
    chamfers: [],
    filletRadiiMm: [],
    offAxisFeatureCount: 1,
    finish: 'CLEAN AND BURR FREE',
    notes: ['⌀8.00 f7 -0.013/-0.028 on the OD', 'Thread as close to bottom as possible'],
  },
  {
    drawing: 'OLY014_01921-A', title: 'Hollow arm bulkhead, short',
    material: 'Stainless steel', handwrittenMachine: 'NTX', stepMatch: 'OLY014_01921',
    holes: [
      // Six 0.7 mm holes held to +/-0.05, in stainless, on a 0.51 GRAM part.
      { diameterMm: 0.7, count: 6, depthMm: 1.0 },
      { diameterMm: 1.3, count: 6, depthMm: 0.8 },
      { diameterMm: 3.3, count: 2 },
      { diameterMm: 1.0, count: 1, fitClass: 'H7 +0.010/0.000' },
    ],
    // M0.9 x 0.225. A tap under a millimetre, in stainless. This is the single
    // most demanding callout in the whole set and it costs nothing today.
    threads: [{ callout: 'M0.9 x 0.225', count: 1, depthMm: 1.5 }],
    chamfers: [],
    filletRadiiMm: [{ radiusMm: 1.15, count: 4 }],
    offAxisFeatureCount: 20,
    notes: [
      'Mass 0.51 g. Lance books 80 minutes of CYCLE time per part on this.',
      'Six ⌀0.7 +/-0.05 on a ⌀6.5 pitch circle, an M0.9 tap, and a ⌀1 H7 ream.',
      'This is what the cycle model cannot see: the care a tiny tool needs.',
    ],
  },
  {
    drawing: 'NAUT_01695-C', title: 'Guide Rod',
    material: '416 Stainless Steel (1.4005), Temper H (full hard)',
    handwrittenMachine: 'SR20', stepMatch: 'NAUT_01695',
    holes: [{ diameterMm: 3.3, count: 1 }],
    threads: [{ callout: 'M5 x 0.35', count: 1 }],
    chamfers: [],
    filletRadiiMm: [],
    offAxisFeatureCount: 0,
    finish: 'Temper H (full hard) — harden and temper, subcontract',
    notes: [
      '⌀6 f7 -0.010/-0.022, GROUND, Ra 0.8 — grinding is an operation we do not model',
      '4 AF across flats',
      '67.6 long. Mass 13.75 g.',
    ],
  },
  {
    drawing: 'OLY014_01297-A', title: 'Toolset Drive Unit — Drive Dog',
    material: 'POM-H', handwrittenMachine: 'SR32', stepMatch: 'OLY014_01297',
    holes: [],
    threads: [],
    chamfers: [
      { callout: '0.2 x 45', count: 3 }, { callout: '0.3 x 60', count: 1 },
      { callout: '0.5 x 45', count: 1 }, { callout: '1 x 60', count: 1 },
    ],
    filletRadiiMm: [{ radiusMm: 0.3, count: 3 }],
    // ONE trilobe pocket, 10.3 deep. We currently read it as six separate
    // off-axis features (three lobes at ⌀12, three at ⌀4) and charge six
    // spindle-orient cycles for one continuous cut. Real work, wrong shape.
    offAxisFeatureCount: 1,
    notes: [
      'TRILOBE CUTOUT TO 10.3 DEPTH — one pocket, three lobes, 120 deg apart',
      '⌀20 / ⌀17 / ⌀16 turned steps. Mass 2.36 g.',
    ],
  },
  // --- Parts we hold a drawing for but no STEP file in this corpus ---------
  {
    drawing: '031581-A', title: 'Stage Spacer Block — PP3020',
    material: 'Peek', handwrittenMachine: 'NTX',
    holes: [
      { diameterMm: 2.0, count: 2, fitClass: 'H7 +0.01/0.00' },
      { diameterMm: 3.4, count: 3, thru: true },
      { diameterMm: 2.5, count: 2, thru: true },
      { diameterMm: 13.0, count: 6, thru: true },
    ],
    threads: [
      { callout: 'M2 x 0.4 - 6H', count: 4, thru: true },
      { callout: 'M3 x 0.5 - 6H', count: 2, thru: true },
    ],
    chamfers: [],
    filletRadiiMm: [],
    finish: 'CLEAN',
    notes: ['SLOT 2.0 THRU ALL', '⌀20.0 and ⌀36.0 PCD', '⌀44.0 / ⌀32.0 / ⌀30.0'],
  },
  {
    drawing: '031167-A', title: 'VOC Condenser Side Flange',
    material: 'Brass BS2874 CZ121', handwrittenMachine: 'NL MORI',
    holes: [
      { diameterMm: 4.5, count: 4, thru: true, counterboreMm: { diameterMm: 8.0, depthMm: 4.4 } },
      { diameterMm: 10.7, count: 1, depthMm: 16.0 },
    ],
    threads: [
      { callout: '1/8 Rc', count: 1, thru: true },
      { callout: '1/4 Rc', count: 1 },
    ],
    chamfers: [{ callout: '1.0 x 45', count: 1 }],
    filletRadiiMm: [{ radiusMm: 4.0, count: 4 }],
    finish: 'CLEAN AND BURR FREE',
    notes: ['□40.0 square flange, ⌀42.50 PCD', 'Position tolerance ⌀0.1 A on the 4 holes',
            'Ra 0.4 sealing face'],
  },
  {
    drawing: 'Kepler_00884-A', title: 'Fixture B — Simplified re-design',
    material: '316 Stainless Steel', handwrittenMachine: 'VF2',
    holes: [
      { diameterMm: 5.5, count: 2, thru: true },
      { diameterMm: 5.0, count: 2 },
      { diameterMm: 7.5, count: 2 },
      { diameterMm: 2.5, count: 2, thru: true },
    ],
    threads: [{ callout: 'M3 - 6H', count: 2, thru: true }],
    chamfers: [
      { callout: '4 x 45', count: 4 }, { callout: '2 x 45', count: 3 },
      { callout: '1 x 45', count: 1 }, { callout: '0.5 x 45', count: 1 },
    ],
    filletRadiiMm: [{ radiusMm: 2.0, count: 1 }],
    notes: [
      'Mass 257.79 g. Heavy GD&T: profile 0.2 A|B|C on ALL surfaces,',
      'flatness 0.05, position 0.04 A, perpendicularity 0.05 A|B.',
      'Tolerance work like this is inspection time our model does not carry.',
    ],
  },
];

// --- Derived views. Arithmetic on the evidence, never fitted to it. ---------

export const drawnPart = (stepMatch: string) =>
  DRAWN_PARTS.find((p) => p.stepMatch === stepMatch);

/** Total tapped features on a part, as the drawing asks for them. */
export const threadCount = (p: DrawnPart) =>
  p.threads.reduce((a, t) => a + t.count, 0);

/** Corner radii, which are NOT operations — the count we must never bill. */
export const filletCount = (p: DrawnPart) =>
  p.filletRadiiMm.reduce((a, f) => a + f.count, 0);

/** Holes the drawing asks for, counting each repeat. */
export const drawnHoleCount = (p: DrawnPart) =>
  p.holes.reduce((a, h) => a + h.count, 0);

/**
 * EVERY part in this set has at least one thread, and not one of them is in a
 * price. That is the largest single gap the drawings expose, and unlike cycle
 * time it is not a modelling problem — it is a missing input. Threads cannot be
 * read reliably off a solid; they are a drawing callout, and the drawing is
 * exactly what a quoter has in front of them.
 */
export const PARTS_WITH_UNCOSTED_THREADS = DRAWN_PARTS.filter((p) => p.threads.length > 0)
  .map((p) => p.drawing);
