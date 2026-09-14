import { describe, it, expect } from 'vitest';
import { estimateTurningTimes, DEFAULT_TURNING_CONFIG, type TurningProfile } from './turning';
import { calculateMachiningCosts } from './cncEstimator';
import { DEFAULT_SHOP_SETTINGS } from '../constants';
import { materialPropsFor } from './materials';

const brass = materialPropsFor('Brass CZ121');
const profile: TurningProfile = {
  odMm: 29.3, lengthMm: 70, boreDiaMm: 11.8, boreDepthMm: 14,
  grooveCount: 4, threadCount: 0, faceCount: 2, crossFeatures: false,
};

describe('a stale settings blob cannot produce a NaN price', () => {
  // Settings are persisted in the browser. A blob saved before a field existed —
  // or a Settings input cleared to an empty string — comes back undefined. The
  // failure mode is not a slightly wrong number: NaN propagates out of cycle
  // time, through machineCost, and into a price that renders as "£NaN".
  it('every returned time is finite when toolChangeSec is missing', () => {
    const stale = { ...DEFAULT_TURNING_CONFIG, toolChangeSec: undefined } as never;
    const t = estimateTurningTimes(profile, brass, 55, stale);
    for (const [name, v] of Object.entries(t)) {
      if (typeof v === 'number') expect(Number.isFinite(v), `${name} = ${v}`).toBe(true);
    }
    expect(t.airSec).toBeGreaterThan(0);
  });

  it('the quoted PRICE stays finite, which is the thing that reaches a customer', () => {
    const stale = {
      ...DEFAULT_SHOP_SETTINGS,
      cnc: { ...DEFAULT_SHOP_SETTINGS.cnc!, toolChangeSec: undefined as unknown as number },
    };
    const c = calculateMachiningCosts(
      { isTurned: true, materialName: 'Brass CZ121', volumeCm3: 20, profile, setups: 1, materialPricePerKg: 12 },
      5, false, 0.25, stale
    );
    for (const k of ['cycleTimeSec', 'machineCost', 'subtotal', 'overhead', 'marginAmount'] as const) {
      expect(Number.isFinite(c[k]), `${k} = ${c[k]}`).toBe(true);
    }
    expect(c.subtotal).toBeGreaterThan(0);
  });

  it('a zero tool-change time falls back rather than making changes free', () => {
    const zeroed = { ...DEFAULT_TURNING_CONFIG, toolChangeSec: 0 };
    const t = estimateTurningTimes(profile, brass, 55, zeroed);
    expect(t.airSec).toBeGreaterThan(t.rapidSec);
  });
});
