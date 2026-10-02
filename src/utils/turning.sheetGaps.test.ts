import { describe, it, expect } from 'vitest';
import { estimateTurningTimes, DEFAULT_TURNING_CONFIG, indexRetractSec, type TurningProfile } from './turning';
import { DEFAULT_TURNING_TOOLS } from '../constants';
import { materialPropsFor } from './materials';
import { threadFromCallout } from './drilling';

/**
 * The two operations Turncircuit's cycle sheets showed the model did not have.
 *
 * The sheets are evidence that something was MISSING. They supply no value here:
 * the drilling comes from the hole's own size and depth, the deburring from the
 * chamfer and the edges the geometry finds. Assertions are about structure and
 * ordering, never about matching a second from the sheet.
 */
const brass = materialPropsFor('Brass CZ121');
const cfg = { ...DEFAULT_TURNING_CONFIG, toolLibrary: DEFAULT_TURNING_TOOLS, facingAllowanceMm: 2 };
const housing: TurningProfile = {
  odMm: 29.3, lengthMm: 70, boreDiaMm: 11.8, boreDepthMm: 14, grooveCount: 4,
  threadCount: 0, faceCount: 2, crossFeatures: false, barDiameterMm: 36,
};

describe('a part can have more than one hole on its axis', () => {
  it('a second on-axis hole is drilled, not ignored', () => {
    // The VOC housing is ⌀11.8 x 14 at the mouth AND ⌀10 through 70mm. The
    // profile carried one bore, so the second was invisible.
    const one = estimateTurningTimes(housing, brass, 55, cfg);
    const two = estimateTurningTimes(
      { ...housing, additionalBores: [{ diameterMm: 10, depthMm: 40.9 }] }, brass, 55, cfg);
    expect(two.drillSec).toBeGreaterThan(one.drillSec);
    expect(two.spotSec).toBeGreaterThan(one.spotSec);   // it is spotted too
  });

  it('a deeper second hole costs more than a shallow one', () => {
    const shallow = estimateTurningTimes({ ...housing, additionalBores: [{ diameterMm: 10, depthMm: 10 }] }, brass, 55, cfg);
    const deep = estimateTurningTimes({ ...housing, additionalBores: [{ diameterMm: 10, depthMm: 65 }] }, brass, 55, cfg);
    expect(deep.drillSec).toBeGreaterThan(shallow.drillSec);
  });

  it('an empty list changes nothing', () => {
    const none = estimateTurningTimes(housing, brass, 55, cfg);
    const empty = estimateTurningTimes({ ...housing, additionalBores: [] }, brass, 55, cfg);
    expect(empty.drillSec).toBeCloseTo(none.drillSec, 9);
  });
});

describe('deburring is an operation, not an afterthought', () => {
  it('a part with holes to break costs more than one without', () => {
    const solid = estimateTurningTimes(
      { ...housing, boreDiaMm: 0, boreDepthMm: 0 }, brass, 55, cfg);
    const bored = estimateTurningTimes(housing, brass, 55, cfg);
    expect(solid.deburrSec).toBe(0);
    expect(bored.deburrSec).toBeGreaterThan(0);
  });

  it('a THROUGH hole is deburred at both ends', () => {
    const blind = estimateTurningTimes(
      { ...housing, additionalBores: [{ diameterMm: 10, depthMm: 20 }] }, brass, 55, cfg);
    const thru = estimateTurningTimes(
      { ...housing, additionalBores: [{ diameterMm: 10, depthMm: 70 }] }, brass, 55, cfg);
    expect(thru.deburrSec).toBeGreaterThan(blind.deburrSec);
  });

  it('a thread carries an edge to break as well', () => {
    const t = threadFromCallout('G1/4', 12, 1)!;
    const plain = estimateTurningTimes(housing, brass, 55, cfg);
    const threaded = estimateTurningTimes({ ...housing, threads: [t] }, brass, 55, cfg);
    expect(threaded.deburrSec).toBeGreaterThan(plain.deburrSec);
  });

  it('it is dominated by reaching the edge, not by the chamfer', () => {
    // On a spinning part the chamfer itself is a fraction of a second. What the
    // operation really costs is getting a tool there — the same rule as every
    // other operation. So more EDGES must cost more, roughly linearly.
    const one = estimateTurningTimes(housing, brass, 55, cfg);
    const three = estimateTurningTimes(
      { ...housing, additionalBores: [{ diameterMm: 10, depthMm: 70 }] }, brass, 55, cfg);
    expect(three.deburrSec / one.deburrSec).toBeGreaterThan(2);
    expect(three.deburrSec / one.deburrSec).toBeLessThan(4);
  });

  it('it is counted in the cycle, and the named operations still sum', () => {
    const t = estimateTurningTimes(housing, brass, 55, cfg);
    const named = t.spotSec + t.deburrSec + t.facingSec + t.roughSec + t.finishSec + t.drillSec
      + t.boreSec + t.grooveSec + t.threadSec + t.partingSec + t.crossSec + t.tapSec;
    // Each named figure is that operation's own total; the turret indexes are
    // the remainder, charged once per actual change.
    const changeSec = cfg.toolChangeSec + indexRetractSec(cfg.opApproach);
    expect(named + t.toolChangeCount * changeSec).toBeCloseTo(t.cuttingSec + t.idleSec, 6);
  });
});
