import { describe, it, expect } from 'vitest';
import {
  drillHoleSec,
  drillHolesSec,
  drillFeedPerRev,
  peckDepthMm,
  crossFeatureSec,
  crossFeaturesSec,
  pairHoles,
  tapThreadSec,
  tapThreadsSec,
  tapSpeedDerate,
  threadFromCallout,
  THREAD_CATALOG,
} from './drilling';
import { materialPropsFor } from './materials';

const steel = materialPropsFor('Medium-carbon Steel (EN8/1045)');
const brass = materialPropsFor('Brass CZ121');

describe('drilling time depends on the hole, not just the count', () => {
  it('a small drill is SLOWER than a big one at the same depth', () => {
    // The whole point of the change: the old model charged a flat rate per hole
    // and could not tell these apart. Chip load scales with diameter, and below
    // ~8 mm the spindle is already at its ceiling, so a small drill has nothing
    // left to give back.
    const small = drillHoleSec({ diameterMm: 1, depthMm: 10 }, steel);
    const big = drillHoleSec({ diameterMm: 10, depthMm: 10 }, steel);
    expect(small).toBeGreaterThan(big * 3);
  });

  it('feed per rev rises with diameter and never reaches zero', () => {
    expect(drillFeedPerRev(10, steel)).toBeGreaterThan(drillFeedPerRev(1, steel));
    expect(drillFeedPerRev(0.1, steel)).toBeGreaterThan(0);
  });

  it('a shallow hole is drilled in one plunge; a deep one is pecked', () => {
    expect(peckDepthMm(5, 10)).toBe(10);       // L/D 2 — straight through
    expect(peckDepthMm(5, 30)).toBe(5);        // L/D 6 — peck a diameter at a time
    expect(peckDepthMm(5, 100)).toBe(2.5);     // L/D 20 — half-diameter bites
  });

  it('depth costs more than proportionally, because every peck retracts further', () => {
    const shallow = drillHoleSec({ diameterMm: 5, depthMm: 10 }, steel);
    const deep = drillHoleSec({ diameterMm: 5, depthMm: 100 }, steel);
    expect(deep).toBeGreaterThan(shallow * 10);
  });

  it('an easier material drills faster at the same size', () => {
    const inBrass = drillHoleSec({ diameterMm: 6, depthMm: 30 }, brass);
    const inSteel = drillHoleSec({ diameterMm: 6, depthMm: 30 }, steel);
    expect(inBrass).toBeLessThan(inSteel);
  });

  it('no holes costs nothing', () => {
    expect(drillHolesSec([], steel)).toBe(0);
  });

  it('holes add up', () => {
    const one = drillHoleSec({ diameterMm: 4, depthMm: 12 }, steel);
    expect(drillHolesSec([{ diameterMm: 4, depthMm: 12 }, { diameterMm: 4, depthMm: 12 }], steel))
      .toBeCloseTo(one * 2, 6);
  });
});

describe('pairHoles keeps diameters and depths together', () => {
  it('matches them by index', () => {
    expect(pairHoles([10, 5], [20, 3], 99)).toEqual([
      { diameterMm: 10, depthMm: 20 },
      { diameterMm: 5, depthMm: 3 },
    ]);
  });

  it('falls back to a through hole when a depth is missing', () => {
    // Older geometry payloads carry no depths at all. Degrading to the previous
    // assumption is right; inventing a depth of zero is not.
    expect(pairHoles([10, 5], undefined, 99)).toEqual([
      { diameterMm: 10, depthMm: 99 },
      { diameterMm: 5, depthMm: 99 },
    ]);
    expect(pairHoles([10, 5], [20], 99)[1].depthMm).toBe(99);
  });

  it('no diameters means no holes', () => {
    expect(pairHoles(undefined, undefined, 99)).toEqual([]);
    expect(pairHoles([], [], 99)).toEqual([]);
  });
});

describe('off-axis features are work, and used to be free', () => {
  it('a cross feature costs more than the same hole on the axis', () => {
    // The extra is getting there: orient the spindle, lock it, bring the driven
    // tool in and out again.
    const onAxis = drillHoleSec({ diameterMm: 4, depthMm: 10 }, steel);
    const offAxis = crossFeatureSec({ diameterMm: 4, lengthMm: 10 }, steel);
    expect(offAxis).toBeGreaterThan(onAxis);
  });

  it('a feature too wide to drill is interpolated, and that is much slower', () => {
    const drilled = crossFeatureSec({ diameterMm: 10, lengthMm: 10 }, steel);
    const interpolated = crossFeatureSec({ diameterMm: 40, lengthMm: 10 }, steel);
    expect(interpolated).toBeGreaterThan(drilled * 3);
  });

  it('having none of them costs nothing', () => {
    expect(crossFeaturesSec(undefined, steel)).toBe(0);
    expect(crossFeaturesSec([], steel)).toBe(0);
  });

  it('the drive dog case: six cross features are not free', () => {
    // Lance's acetal drive dog has three ⌀12 lugs and three ⌀4 cross holes and
    // nothing else — no bore, almost nothing to remove — and it takes him ten
    // times as long per part as a plain stainless rod of the same size. Whatever
    // else this model is missing, these features cannot cost zero.
    const pom = materialPropsFor('Acetal (POM)');
    const sec = crossFeaturesSec([
      { diameterMm: 12, lengthMm: 9.2 }, { diameterMm: 12, lengthMm: 9.2 },
      { diameterMm: 12, lengthMm: 9.2 }, { diameterMm: 4, lengthMm: 9.2 },
      { diameterMm: 4, lengthMm: 9.2 }, { diameterMm: 4, lengthMm: 9.2 },
    ], pom);
    expect(sec).toBeGreaterThan(30);
  });
});

describe('tapping: the one operation with no geometric signature', () => {
  it('feed is locked to the pitch, so a FINE thread takes longer', () => {
    // The single most counter-intuitive thing about tapping: a finer thread is
    // slower, because the tap advances one pitch per revolution and a fine
    // pitch needs more revolutions to reach the same depth.
    const coarse = tapThreadSec({ callout: 'M5', pitchMm: 0.8, tapDrillMm: 4.2, depthMm: 8 }, steel);
    const fine = tapThreadSec({ callout: 'M5x0.35', pitchMm: 0.35, tapDrillMm: 4.65, depthMm: 8 }, steel);
    expect(fine).toBeGreaterThan(coarse);
  });

  it('a deeper thread costs more', () => {
    const shallow = tapThreadSec({ callout: 'M6', pitchMm: 1.0, tapDrillMm: 5, depthMm: 5 }, steel);
    const deep = tapThreadSec({ callout: 'M6', pitchMm: 1.0, tapDrillMm: 5, depthMm: 20 }, steel);
    expect(deep).toBeGreaterThan(shallow);
  });

  it('a small tap is run slower, because breaking it scraps the part', () => {
    expect(tapSpeedDerate(6)).toBe(1);
    expect(tapSpeedDerate(0.675)).toBeLessThan(0.5);
    // Monotonic: never faster as it gets smaller.
    const sizes = [0.5, 1.0, 1.6, 2.5, 5, 8];
    for (let i = 1; i < sizes.length; i++) {
      expect(tapSpeedDerate(sizes[i])).toBeGreaterThanOrEqual(tapSpeedDerate(sizes[i - 1]));
    }
  });

  it('every thread carries a cycle cost even when it is barely deep', () => {
    // Orient, approach, synchronise, reverse, retract. A rigid tapping cycle
    // pays this whatever the size, which is why an M0.9 x 1.5 deep is not free.
    const tiny = tapThreadSec({ callout: 'M0.9x0.225', pitchMm: 0.225, tapDrillMm: 0.675, depthMm: 1.5 }, steel);
    expect(tiny).toBeGreaterThan(3);
  });

  it('counts multiply, and no threads costs nothing', () => {
    const one = tapThreadSec({ callout: 'M2', pitchMm: 0.4, tapDrillMm: 1.6, depthMm: 7 }, steel);
    expect(tapThreadsSec([{ callout: 'M2', pitchMm: 0.4, tapDrillMm: 1.6, depthMm: 7, count: 2 }], steel))
      .toBeCloseTo(one * 2, 6);
    expect(tapThreadsSec(undefined, steel)).toBe(0);
    expect(tapThreadsSec([], steel)).toBe(0);
  });
});

describe('threads a quoter types in', () => {
  it('a catalog callout resolves to a costable thread', () => {
    const t = threadFromCallout('M5x0.35', 8, 1)!;
    expect(t.pitchMm).toBe(0.35);
    expect(t.tapDrillMm).toBe(4.65);
    expect(t.depthMm).toBe(8);
  });

  it('no depth given falls back to twice the diameter, never to zero', () => {
    // Pricing an unspecified thread at nothing is the bug this replaces.
    const t = threadFromCallout('M6', 0, 1)!;
    expect(t.depthMm).toBe(12);
    expect(tapThreadSec(t, steel)).toBeGreaterThan(0);
  });

  it('an unknown callout is refused rather than guessed', () => {
    expect(threadFromCallout('M99', 10, 1)).toBeNull();
  });

  it('the catalog covers the threads the drawings actually call out', () => {
    // Every thread on the eleven Turncircuit sheets must be selectable, or the
    // editor cannot express the part it exists to describe.
    for (const c of ['M0.9x0.225', 'M2', 'M3', 'M5x0.35', 'M6', 'G1/4', 'Rc1/8']) {
      expect(THREAD_CATALOG[c], c).toBeDefined();
    }
  });

  it('external threads are why this exists: M6 and a plain ⌀6 shaft are the same number', () => {
    // Lance's guide rod has a ⌀6 f7 GROUND body and an M5x0.35 thread. A
    // detector keyed on major diameter would tap the bearing surface.
    expect(THREAD_CATALOG['M6'].majorMm).toBe(6);
  });
});
