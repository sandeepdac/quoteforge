import { describe, it, expect } from 'vitest';
import {
  estimateTurningTimes, finishFeedForRaMmPerRev, boringOverhangDerate,
  DEFAULT_TURNING_CONFIG, DEFAULT_TURNED_RA_UM, ACHIEVABLE_RA_DERATE, type TurningProfile,
} from './turning';
import { materialPropsFor } from './materials';
import { standardDrillMm, boringStockMm, STANDARD_DRILL_MM } from './drilling';
import type { ShopTool } from '../types';

const brass = materialPropsFor('Brass CZ121');
const profile: TurningProfile = {
  odMm: 29.3, lengthMm: 70, boreDiaMm: 11.8, boreDepthMm: 14,
  grooveCount: 4, threadCount: 0, faceCount: 2, crossFeatures: false,
};
const tools = (finishNose: number): ShopTool[] => ([
  { op: 'face', station: 'T0101', description: 'OD rough', noseRadiusMm: 0.8 },
  { op: 'rough', station: 'T0101', description: 'OD rough', noseRadiusMm: 0.8 },
  { op: 'bore', station: 'T0505', description: 'Boring bar', noseRadiusMm: 0.4 },
  { op: 'finish', station: 'T0303', description: 'OD finish', noseRadiusMm: finishNose },
  { op: 'partoff', station: 'T0404', description: 'Part-off blade' },
]);
const cfg = (finishNose: number, toolLibrary = tools(finishNose)) =>
  ({ ...DEFAULT_TURNING_CONFIG, toolLibrary });

describe('the feed a finish allows: Ra = fn^2 / (32r)', () => {
  it('matches the handbook relation, derated to what is achievable', () => {
    // Ra 3.2 um on an 0.8 mm nose: sqrt(32 * 0.8 * 0.0032) = 0.286 mm/rev in
    // theory. Published guidance is that real roughness runs 20-50% above the
    // theoretical value, so holding the callout means feeding at ~0.86 of it.
    const theoretical = (r: number, ra: number) => Math.sqrt(32 * r * (ra / 1000));
    expect(theoretical(0.8, 3.2)).toBeCloseTo(0.286, 3);
    expect(finishFeedForRaMmPerRev(0.8, 3.2)).toBeCloseTo(0.286 * ACHIEVABLE_RA_DERATE, 3);
    expect(finishFeedForRaMmPerRev(0.4, 0.4)).toBeCloseTo(0.072 * ACHIEVABLE_RA_DERATE, 3);
  });

  it('never returns MORE than the theoretical formula allows', () => {
    // The derate can only slow a cut down. If it ever exceeded the theory the
    // model would be promising a finish the tool geometry cannot leave.
    for (const [r, ra] of [[0.4, 0.4], [0.8, 3.2], [1.2, 6.3]] as const) {
      expect(finishFeedForRaMmPerRev(r, ra)).toBeLessThan(Math.sqrt(32 * r * (ra / 1000)));
    }
  });

  it('a FINER finish demands a slower feed', () => {
    expect(finishFeedForRaMmPerRev(0.8, 0.4)).toBeLessThan(finishFeedForRaMmPerRev(0.8, 3.2));
  });

  it('a SMALLER nose radius demands a slower feed for the same finish', () => {
    expect(finishFeedForRaMmPerRev(0.4, 1.6)).toBeLessThan(finishFeedForRaMmPerRev(0.8, 1.6));
  });

  it('never returns zero or a negative, whatever it is handed', () => {
    for (const [r, ra] of [[0, 0], [-1, -1], [0.0001, 0.0001]] as const) {
      const f = finishFeedForRaMmPerRev(r, ra);
      expect(Number.isFinite(f)).toBe(true);
      expect(f).toBeGreaterThan(0);
    }
  });
});

describe('the tool reaches the cycle time', () => {
  // THE DEFECT THIS PINS. The library carried a nose radius per operation and it
  // reached nothing but a tool-change count, so an 0.4 mm finishing insert and
  // an 0.8 mm one produced identical seconds.
  it('a smaller finishing insert makes the part take longer', () => {
    const coarse = estimateTurningTimes(profile, brass, 55, cfg(0.8));
    const fine = estimateTurningTimes(profile, brass, 55, cfg(0.4));
    expect(fine.finishSec).toBeGreaterThan(coarse.finishSec);
  });

  it('a fine surface-finish callout makes the part take longer', () => {
    const ordinary = estimateTurningTimes(
      { ...profile, surfaceFinishRaUm: DEFAULT_TURNED_RA_UM }, brass, 55, cfg(0.4));
    const sealing = estimateTurningTimes(
      { ...profile, surfaceFinishRaUm: 0.4 }, brass, 55, cfg(0.4));
    // Slower feed AND a spring pass: a sealing face is not a turned diameter.
    expect(sealing.finishSec).toBeGreaterThan(ordinary.finishSec * 2);
    expect(sealing.facingSec).toBeGreaterThan(ordinary.facingSec);
  });

  it('no Ra callout is treated as an ordinary turned surface, not as free', () => {
    const none = estimateTurningTimes(profile, brass, 55, cfg(0.4));
    const stated = estimateTurningTimes(
      { ...profile, surfaceFinishRaUm: DEFAULT_TURNED_RA_UM }, brass, 55, cfg(0.4));
    expect(none.finishSec).toBeCloseTo(stated.finishSec, 6);
  });

  it('an unassigned tool still prices, on a stated fallback radius', () => {
    const bare = estimateTurningTimes(profile, brass, 55, { ...DEFAULT_TURNING_CONFIG, toolLibrary: [] });
    expect(Number.isFinite(bare.finishSec)).toBe(true);
    expect(bare.finishSec).toBeGreaterThan(0);
  });
});

describe('a boring bar is slowed by its own overhang', () => {
  it('derates monotonically with reach, and never speeds a cut up', () => {
    const ratios = [1, 3, 4, 6, 8, 12];
    for (let i = 1; i < ratios.length; i++) {
      expect(boringOverhangDerate(ratios[i])).toBeLessThanOrEqual(boringOverhangDerate(ratios[i - 1]));
    }
    expect(boringOverhangDerate(1)).toBe(1);
    expect(boringOverhangDerate(12)).toBeGreaterThan(0);
  });

  it('a deep bore costs more PER MILLIMETRE than a shallow one', () => {
    // Not exercised by the calibration corpus — no part there has a bore deeper
    // than three diameters — so this test is the only thing holding it.
    //
    // Per-millimetre is the honest claim. Total time cannot be a clean multiple
    // of depth, because every bore pays one approach however deep it is; what
    // the derate asserts is that the metres of bar sticking out of the hole make
    // each millimetre slower, and that is what is checked.
    const shallow = estimateTurningTimes({ ...profile, boreDepthMm: 12 }, brass, 55, cfg(0.4));
    const deep = estimateTurningTimes({ ...profile, boreDepthMm: 120 }, brass, 55, cfg(0.4));
    expect(deep.boreSec).toBeGreaterThan(shallow.boreSec * 5);

    // Per-millimetre is compared between two bores that are BOTH deep enough for
    // the derate to be what separates them. Against a shallow bore it would not
    // show: a 12 mm bore is mostly approach, and approach does not scale with
    // depth, so the shallow hole looks dearer per millimetre for a reason that
    // has nothing to do with overhang.
    const d60 = estimateTurningTimes({ ...profile, boreDepthMm: 60 }, brass, 55, cfg(0.4));
    expect(deep.boreSec / 120).toBeGreaterThan(d60.boreSec / 60);
  });
});

describe('a bored diameter is drilled UNDER and bored to size', () => {
  it('the drill is a size a shop stocks, not the measured decimal', () => {
    // ⌀11.80 is not a drill. The nearest stocked sizes are 11.5 and 12.0, and a
    // dimensioned bore is drilled under and bored anyway.
    expect(STANDARD_DRILL_MM).not.toContain(11.8);
    expect(standardDrillMm(11.8 - boringStockMm(11.8))).toBe(10.5);
    expect(standardDrillMm(6.4)).toBe(6);
    expect(standardDrillMm(0.2)).toBeGreaterThan(0);
  });

  it('leaves the boring bar real stock to remove', () => {
    const stock = boringStockMm(11.8);
    expect(stock).toBeGreaterThanOrEqual(1);
    const drill = standardDrillMm(11.8 - stock);
    expect((11.8 - drill) / 2).toBeGreaterThan(0.1);   // radial > the model's threshold
  });

  it('so boring a dimensioned hole costs MORE than boring nothing did', () => {
    // Previously drillDia = min(boreDia, maxDrill) = boreDia, radial = 0, and
    // "Boring" was a finish pass over a hole already at size.
    const bored = estimateTurningTimes(profile, brass, 55, cfg(0.4));
    const solid = estimateTurningTimes({ ...profile, boreDiaMm: 0, boreDepthMm: 0 }, brass, 55, cfg(0.4));
    expect(solid.boreSec).toBe(0);
    expect(bored.boreSec).toBeGreaterThan(3);
  });

  it('stock scales with the bore, and is capped', () => {
    expect(boringStockMm(5)).toBe(1);        // floor
    expect(boringStockMm(20)).toBe(2);       // a tenth
    expect(boringStockMm(100)).toBe(3);      // cap
  });
});
