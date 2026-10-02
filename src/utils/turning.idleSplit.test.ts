import { describe, it, expect } from 'vitest';
import { estimateTurningTimes, DEFAULT_TURNING_CONFIG, indexRetractSec, DEFAULT_OP_APPROACH, type TurningProfile } from './turning';
import { DEFAULT_TURNING_TOOLS } from '../constants';
import { materialPropsFor } from './materials';
import { CYCLE_SHEETS, sheetCuttingSec, sheetIdleSec } from './calibration/cycleSheets';
import { TOOL_CHANGE_SEC } from './machineSelection';

/**
 * CUTTING AND IDLE ARE MEASURED SEPARATELY, BECAUSE THEY FAIL SEPARATELY.
 *
 * Every operation used to report one blended figure: its cut plus its approach,
 * with the turret indexes swept into a lump row at the bottom next to a flat
 * 5%-of-cutting rapid allowance that was never measured travel. Comparing that
 * against a shop cycle sheet compared one of our columns with two of theirs, so
 * a model fast on metal and slow on air could read as correct.
 *
 * With the columns apart, the housing says something the blended figure could
 * not: the two halves are wrong by DIFFERENT amounts — the cutting model is
 * roughly twice as far off as the idle model. That is two problems, not one
 * scale factor, and it is the kind of thing this split exists to reveal.
 *
 * NOTHING HERE IS FITTED TO THE SHEET. The assertions are about structure —
 * that both columns exist, that they partition the cycle, that the idle column
 * is never empty — plus one deliberately loose guard recording that the two
 * ratios are not the same number. A tighter assertion would be a lookup.
 */
const brass = materialPropsFor('Brass CZ121');
const cfg = {
  ...DEFAULT_TURNING_CONFIG,
  toolLibrary: DEFAULT_TURNING_TOOLS,
  facingAllowanceMm: 2,
  toolChangeSec: TOOL_CHANGE_SEC['lathe'],
};
const housing: TurningProfile = {
  odMm: 29.3, lengthMm: 70, boreDiaMm: 11.8, boreDepthMm: 14, grooveCount: 4,
  threadCount: 1, faceCount: 2, crossFeatures: false, barDiameterMm: 36,
  additionalBores: [{ diameterMm: 10, depthMm: 70 }],
};

describe('every operation carries its own idle', () => {
  const t = estimateTurningTimes(housing, brass, 55, cfg);

  it('no operation is pure metal', () => {
    // A cut that removes almost nothing still had to be reached. This is the
    // property that made "Boring 0.7s" impossible to defend.
    expect(t.opTimes.length).toBeGreaterThan(5);
    for (const o of t.opTimes) expect(o.idleSec).toBeGreaterThan(0);
  });

  it('the two columns partition the cycle — nothing doubled, nothing dropped', () => {
    expect(t.opTimes.reduce((a, o) => a + o.cuttingSec, 0)).toBeCloseTo(t.cuttingSec, 9);
    expect(t.opTimes.reduce((a, o) => a + o.idleSec, 0)).toBeCloseTo(t.idleSec, 9);
    expect(t.airSec).toBeCloseTo(t.idleSec, 9);
  });

  it('the turret indexes land on the operations, and still total the same count', () => {
    // ATTRIBUTION, NOT INVENTION. Re-run the same part with a free turret: the
    // idle column must fall by exactly the count countToolSelections reports,
    // times the machine's own figure, and the cutting column must not move.
    const free = estimateTurningTimes(housing, brass, 55, { ...cfg, toolChangeSec: 1e-9 });
    expect(free.cuttingSec).toBeCloseTo(t.cuttingSec, 9);
    expect(t.idleSec - free.idleSec).toBeCloseTo(t.toolChangeCount * cfg.toolChangeSec, 6);
    expect(t.toolChangeCount).toBeGreaterThan(0);
    expect(t.toolChangeCount).toBeLessThanOrEqual(t.opTimes.length);
  });

  it('a tool change pays the trip out to where it is safe to index', () => {
    // A turret cannot rotate where it cuts — its tools sweep a circle — so it
    // withdraws, indexes, and the new tool comes back. Out and back, and only
    // on an actual change.
    const fast = indexRetractSec({ ...DEFAULT_OP_APPROACH, rapidMmPerMin: 30000 });
    const slow = indexRetractSec({ ...DEFAULT_OP_APPROACH, rapidMmPerMin: 12000 });
    expect(slow).toBeGreaterThan(fast);          // a slower machine pays more
    expect(fast).toBeCloseTo((2 * 150 / 30000) * 60, 9);
    // AND IT IS SMALL, which is the finding. Travel on a modern machine is
    // cheap: 150 mm out and back at 30 m/min is under a second. Whatever else
    // is missing from the idle column, it cannot be distance — twelve seconds
    // of rapid would be six metres of it per operation.
    expect(fast).toBeLessThan(2);
  });

  it('operations sharing a tool pay neither the index nor the retract', () => {
    const t2 = estimateTurningTimes(housing, brass, 55, cfg);
    const free = estimateTurningTimes(housing, brass, 55, { ...cfg, toolChangeSec: 1e-9 });
    // Removing the index leaves the retract, so the drop is less than the full
    // change cost — and it is still counted once per CHANGE, not per operation.
    const dropped = t2.idleSec - free.idleSec;
    expect(dropped).toBeCloseTo(t2.toolChangeCount * cfg.toolChangeSec, 6);
    expect(t2.toolChangeCount).toBeLessThan(t2.opTimes.length + 1);
  });

  it('the flat 5%-of-cutting rapid allowance is gone', () => {
    // It was provisional by its own label and is now double counting: every
    // approach and retract is timed move by move on the row that makes it.
    expect(t.rapidSec).toBe(0);
  });

  it('records that the two columns are off by different factors', () => {
    // THE MEASUREMENT, not a target. Against the VOC housing sheet the cutting
    // ratio sits near 0.11 and the idle ratio near 0.23 — so no single
    // efficiency constant reconciles both, which the blended figure hid.
    const sheet = CYCLE_SHEETS.find((s) => s.drawing === '031169-A')!;
    const cuttingRatio = t.cuttingSec / sheetCuttingSec(sheet);
    const idleRatio = t.idleSec / sheetIdleSec(sheet);
    expect(cuttingRatio).toBeGreaterThan(0);
    expect(idleRatio).toBeGreaterThan(0);
    // Both still well under 1 — the model is fast on both halves.
    expect(cuttingRatio).toBeLessThan(1);
    expect(idleRatio).toBeLessThan(1);
    // And they are not the same number. Loose on purpose: the claim is "these
    // differ", not "these equal 0.11 and 0.23".
    expect(idleRatio / cuttingRatio).toBeGreaterThan(1.4);
  });

  it('the operation COUNT is already about right, which narrows the search', () => {
    // 10 operations against the sheet's 11 for the same part. Whatever is
    // missing is inside the operations, not a list of operations we never had.
    const sheet = CYCLE_SHEETS.find((s) => s.drawing === '031169-A')!;
    // The sheet's first line is the bar stop, which the model charges as bar
    // load outside the operation list.
    const sheetCuttingOps = sheet.ops.filter((o) => o.cuttingSec > 0).length;
    expect(Math.abs(t.opTimes.length - sheetCuttingOps)).toBeLessThanOrEqual(3);
  });
});
