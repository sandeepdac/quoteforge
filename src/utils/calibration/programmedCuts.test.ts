import { describe, it, expect } from 'vitest';
import {
  PROGRAMMED_PARTS, programmedFzMm, programmedVcMMin, programmedApOverD, programmedTotalSec,
} from './programmedCuts';

/**
 * The transcription adds up to what the write-ups state, and the derived chip
 * loads and surface speeds are the arithmetic they should be. No assertion
 * compares a model number to the shop's.
 */
describe('Lance programmed cuts', () => {
  it('each part sums to the total the write-up states', () => {
    for (const p of PROGRAMMED_PARTS) expect(programmedTotalSec(p), p.part).toBe(p.statedTotalSec);
  });

  it('chip load and surface speed follow from rpm, feed, flutes and diameter', () => {
    const stainless = PROGRAMMED_PARTS[1];
    const em3 = stainless.cuts.find((c) => c.step === 4)!;
    expect(programmedFzMm(em3)).toBeCloseTo(520 / (9020 * 3), 9); // ~0.0192 mm/tooth
    expect(programmedVcMMin(em3)).toBeCloseTo((Math.PI * 3 * 9020) / 1000, 9); // ~85 m/min
    const faceMill = PROGRAMMED_PARTS[0].cuts.find((c) => c.step === 2)!;
    expect(programmedFzMm(faceMill)).toBeCloseTo(1910 / (3980 * 3), 9);
  });

  it('the programmed axial depth is a small fraction of the diameter on the stainless pockets', () => {
    for (const c of PROGRAMMED_PARTS[1].cuts.filter((x) => x.kind === 'flat' && x.diaMm === 3)) {
      expect(programmedApOverD(c), `step ${c.step}`).toBeLessThanOrEqual(0.17 + 1e-9);
    }
  });

  it('flags the row whose rpm and feed disagree', () => {
    const flagged = PROGRAMMED_PARTS.flatMap((p) => p.cuts).filter((c) => c.suspect);
    expect(flagged.map((c) => c.step)).toEqual([2]);
  });
});
