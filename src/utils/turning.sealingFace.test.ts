import { describe, it, expect } from 'vitest';
import { estimateTurningTimes, DEFAULT_TURNING_CONFIG, type TurningProfile } from './turning';
import { DEFAULT_TURNING_TOOLS } from '../constants';
import { materialPropsFor } from './materials';

/**
 * THE DRAWING'S FINISH REACHES THE LATHE.
 *
 * The VOC housing's title block gives Ra 0.8 for everything, and its two end
 * faces carry "Ra 0.4 — surface required for sealing". The sealing callout
 * belongs to the facing passes alone.
 */
const brass = materialPropsFor('Brass CZ121');
const cfg = { ...DEFAULT_TURNING_CONFIG, toolLibrary: DEFAULT_TURNING_TOOLS, facingAllowanceMm: 2 };
const base: TurningProfile = {
  odMm: 29.3, lengthMm: 70, boreDiaMm: 11.8, boreDepthMm: 14, grooveCount: 0,
  threadCount: 0, faceCount: 2, crossFeatures: false,
};
const cut = (p: TurningProfile, op: string) =>
  estimateTurningTimes(p, brass, 55, cfg).opTimes.find((o) => o.op === op)!.cuttingSec;

describe('a sealing-face finish', () => {
  const sealed = { ...base, sealingFaceRaUm: 0.4 };

  it('slows the facing passes', () => {
    expect(cut(sealed, 'face')).toBeGreaterThan(cut(base, 'face') * 2);
  });

  it('leaves the diameters and the bore alone', () => {
    for (const op of ['finish', 'bore']) expect(cut(sealed, op), op).toBeCloseTo(cut(base, op), 9);
  });

  it('never makes a face coarser than the general callout', () => {
    const general = { ...base, surfaceFinishRaUm: 0.8 };
    expect(cut({ ...general, sealingFaceRaUm: 3.2 }, 'face')).toBeCloseTo(cut(general, 'face'), 9);
  });
});

describe('the general finish', () => {
  it('reaches every finishing pass, faces included', () => {
    const fine = { ...base, surfaceFinishRaUm: 0.8 };
    for (const op of ['face', 'finish', 'bore']) expect(cut(fine, op), op).toBeGreaterThan(cut(base, op));
  });
});
