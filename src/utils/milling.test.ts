import { describe, it, expect } from 'vitest';
import { millingRpm, millingMrrCm3PerMin, finishingRateCm2PerMin, roughingToolDiaMm, DEFAULT_MILLING_TOOL } from './milling';
import { materialPropsFor } from './materials';

const alu = materialPropsFor('Aluminium 6082');
const steel = materialPropsFor('Medium-carbon Steel');
const ss = materialPropsFor('Stainless 316');
const ti = materialPropsFor('Titanium');

describe('millingRpm', () => {
  it('follows Vc·1000/(π·D)', () => {
    expect(millingRpm(150, 10, 100000)).toBeCloseTo((150 * 1000) / (Math.PI * 10), 3);
  });

  it('clamps to the spindle ceiling', () => {
    // Aluminium at Vc 400 on a 10 mm cutter wants ~12,700 rpm.
    expect(millingRpm(400, 10, 6000)).toBe(6000);
  });
});

describe('millingMrrCm3PerMin', () => {
  it('gives physically plausible rates, not turning rates', () => {
    // The old model borrowed turning's Vc·fn·ap and got ~198 cm³/min for
    // aluminium — an order of magnitude beyond what a 10 mm end mill can do.
    const mrr = millingMrrCm3PerMin(alu);
    expect(mrr).toBeGreaterThan(20);
    expect(mrr).toBeLessThan(120);
  });

  it('ranks materials by machinability', () => {
    expect(millingMrrCm3PerMin(alu)).toBeGreaterThan(millingMrrCm3PerMin(steel));
    expect(millingMrrCm3PerMin(steel)).toBeGreaterThan(millingMrrCm3PerMin(ss));
    expect(millingMrrCm3PerMin(ss)).toBeGreaterThan(millingMrrCm3PerMin(ti));
  });

  it('a slower spindle reduces the achievable rate on aluminium', () => {
    const fast = millingMrrCm3PerMin(alu, { ...DEFAULT_MILLING_TOOL, maxRpm: 12000 });
    const slow = millingMrrCm3PerMin(alu, { ...DEFAULT_MILLING_TOOL, maxRpm: 6000 });
    expect(slow).toBeLessThan(fast);
  });

  it('is rpm-limited for aluminium but Vc-limited for steel', () => {
    // Steel's Vc (150) on a 10 mm cutter needs only ~4,800 rpm, so raising the
    // ceiling changes nothing — unlike aluminium above.
    const a = millingMrrCm3PerMin(steel, { ...DEFAULT_MILLING_TOOL, maxRpm: 6000 });
    const b = millingMrrCm3PerMin(steel, { ...DEFAULT_MILLING_TOOL, maxRpm: 24000 });
    expect(a).toBeCloseTo(b, 6);
  });

  it('a bigger cutter removes more material', () => {
    const small = millingMrrCm3PerMin(steel, { ...DEFAULT_MILLING_TOOL, toolDiaMm: 6 });
    const big = millingMrrCm3PerMin(steel, { ...DEFAULT_MILLING_TOOL, toolDiaMm: 16 });
    expect(big).toBeGreaterThan(small);
  });
});

describe('finishingRateCm2PerMin', () => {
  it('is positive and ordered by material', () => {
    expect(finishingRateCm2PerMin(alu)).toBeGreaterThan(finishingRateCm2PerMin(ti));
  });

  it('does not scale linearly with cutting speed', () => {
    // The old model multiplied a reference rate by Vc/150, so aluminium (Vc 600)
    // got 4× steel's finishing rate. Feed and the rpm ceiling bound it well below that.
    const ratio = finishingRateCm2PerMin(alu) / finishingRateCm2PerMin(steel);
    expect(ratio).toBeLessThan(4);
  });
});

describe('roughingToolDiaMm', () => {
  it('sizes the cutter to the part, within stocked sizes', () => {
    expect(roughingToolDiaMm(23.1)).toBe(6);    // small contoured part
    expect(roughingToolDiaMm(150)).toBe(20);    // big open plate
    expect(roughingToolDiaMm(48)).toBe(12);     // mid
  });

  it('drives an order-of-magnitude spread in removal rate', () => {
    // Two reference CAM quotes implied ~23 cm³/min on a small putter and
    // ~134 cm³/min on a large plate. One fixed cutter cannot describe both.
    const alu = materialPropsFor('Aluminium 6082');
    const small = millingMrrCm3PerMin(alu, { ...DEFAULT_MILLING_TOOL, toolDiaMm: roughingToolDiaMm(23.1) });
    const big = millingMrrCm3PerMin(alu, { ...DEFAULT_MILLING_TOOL, toolDiaMm: roughingToolDiaMm(150) });
    expect(big / small).toBeGreaterThan(4);
  });
});
