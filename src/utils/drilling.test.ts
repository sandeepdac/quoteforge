import { describe, it, expect } from 'vitest';
import {
  drillHoleSec,
  drillHolesSec,
  drillFeedPerRev,
  peckDepthMm,
  crossFeatureSec,
  crossFeaturesSec,
  pairHoles,
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
