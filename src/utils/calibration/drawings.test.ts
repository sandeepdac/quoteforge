import { describe, it, expect } from 'vitest';
import {
  DRAWN_PARTS, drawnPart, threadCount, filletCount, drawnHoleCount,
  PARTS_WITH_UNCOSTED_THREADS,
} from './drawings';
import { QUOTED_PARTS } from './quotes';

/**
 * The drawings are evidence, so these tests check the evidence is internally
 * consistent and that the conclusions drawn from it in code still hold. They do
 * NOT re-run the geometry service — that lives in the Python corpus baseline,
 * which pins the extracted counts these callouts were compared against.
 */
describe('the drawing evidence is well formed', () => {
  it('every drawn part names a material and a machine', () => {
    for (const p of DRAWN_PARTS) {
      expect(p.material, p.drawing).toBeTruthy();
      expect(p.handwrittenMachine, p.drawing).toBeTruthy();
    }
  });

  it('every part we hold a STEP file for is also quoted', () => {
    const quoted = new Set(QUOTED_PARTS.map((q) => q.stepMatch));
    for (const p of DRAWN_PARTS.filter((d) => d.stepMatch)) {
      expect(quoted.has(p.stepMatch!), `${p.drawing} has geometry but no quote`).toBe(true);
    }
  });

  it('counts are positive and holes are not zero-diameter', () => {
    for (const p of DRAWN_PARTS) {
      for (const h of p.holes) {
        expect(h.diameterMm, p.drawing).toBeGreaterThan(0);
        expect(h.count, p.drawing).toBeGreaterThan(0);
      }
      for (const t of p.threads) expect(t.count, p.drawing).toBeGreaterThan(0);
    }
  });
});

describe('what the drawings proved about the model', () => {
  it('the C clamp carries ten corner radii that are not operations', () => {
    // Each of these was being billed as a driven-tool cycle. Ten phantom
    // operations on a part with seven real ones.
    const c = drawnPart('035838')!;
    expect(filletCount(c)).toBe(10);
    expect(c.offAxisFeatureCount).toBe(7);
  });

  it('the hollow arm is a 0.51 g part with twenty off-axis operations', () => {
    // Six ⌀0.7 holes to ±0.05, an M0.9 tap and a ⌀1 H7 ream, in stainless.
    // This is the part Lance books 80 minutes of cycle time on.
    const h = drawnPart('OLY014_01921')!;
    expect(drawnHoleCount(h)).toBe(15);
    expect(h.offAxisFeatureCount).toBe(20);
    expect(h.holes.find((x) => x.diameterMm === 0.7)!.count).toBe(6);
    expect(h.holes.some((x) => x.fitClass?.includes('H7'))).toBe(true);
  });

  it('the VOC housing has a counterbore in EACH end, only one of which is billed', () => {
    const v = drawnPart('031169')!;
    const cbore = v.holes.find((x) => x.diameterMm === 11.8)!;
    expect(cbore.count).toBe(2);
    // 14.0 deep — the figure the bore-contiguity fix now produces. Before it,
    // this read as a single 70 mm hole through the whole part.
    expect(cbore.depthMm).toBe(14.0);
  });

  it('the drive dog is ONE trilobe pocket, which we still read as six features', () => {
    const d = drawnPart('OLY014_01297')!;
    expect(d.offAxisFeatureCount).toBe(1);
  });
});

describe('threads: the largest gap the drawings expose', () => {
  it('every part with a thread is named, and there are many', () => {
    // Not one of these is in a price. Recorded so the gap cannot be forgotten.
    expect(PARTS_WITH_UNCOSTED_THREADS.length).toBeGreaterThanOrEqual(7);
  });

  it('the hollow arm needs an M0.9 tap — under a millimetre, in stainless', () => {
    const h = drawnPart('OLY014_01921')!;
    expect(threadCount(h)).toBe(1);
    expect(h.threads[0].callout).toBe('M0.9 x 0.225');
  });

  it('six of the seven quoted parts carry at least one thread', () => {
    const withGeometry = DRAWN_PARTS.filter((p) => p.stepMatch);
    const threaded = withGeometry.filter((p) => threadCount(p) > 0);
    expect(threaded.length).toBeGreaterThanOrEqual(4);
  });
});
