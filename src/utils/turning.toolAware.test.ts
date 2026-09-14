import { describe, it, expect } from 'vitest';
import {
  estimateTurningTimes, finishFeedForRaMmPerRev, boringOverhangDerate,
  DEFAULT_TURNING_CONFIG, DEFAULT_TURNED_RA_UM, type TurningProfile,
} from './turning';
import { materialPropsFor } from './materials';
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
  it('matches the handbook relation', () => {
    // Ra 3.2 um on an 0.8 mm nose: sqrt(32 * 0.8 * 0.0032) = 0.286 mm/rev.
    expect(finishFeedForRaMmPerRev(0.8, 3.2)).toBeCloseTo(0.286, 3);
    expect(finishFeedForRaMmPerRev(0.4, 0.4)).toBeCloseTo(0.072, 3);
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

  it('a deep bore costs more than a shallow one of the same diameter', () => {
    // Not exercised by the calibration corpus — no part there has a bore deeper
    // than three diameters — so this test is the only thing holding it.
    const shallow = estimateTurningTimes({ ...profile, boreDepthMm: 12 }, brass, 55, cfg(0.4));
    const deep = estimateTurningTimes({ ...profile, boreDepthMm: 120 }, brass, 55, cfg(0.4));
    expect(deep.boreSec).toBeGreaterThan(shallow.boreSec * 10);
  });
});
