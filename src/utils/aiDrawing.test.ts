import { describe, it, expect } from 'vitest';
import { fromAiData } from './cadAnalyzer';
import { calculateMachiningCosts } from './cncEstimator';
import { calculateMilledCosts } from './milledEstimator';
import { materialPropsFor, nextStandardBar } from './materials';
import { DEFAULT_SHOP_SETTINGS, DEFAULT_CNC_SETTINGS } from '../constants';

describe('fromAiData — turned drawing', () => {
  const a = fromAiData('bushing.pdf', 'PDF', {
    partName: 'Bushing',
    materialName: 'Brass CZ121',
    partClass: 'turned',
    turned: { odMm: 25, lengthMm: 40, boreDiaMm: 12, boreDepthMm: 40, grooveCount: 1, threadCount: 0, faceCount: 2 },
    confidenceScore: 72,
    aiNotes: ['⌀25 read from the front view'],
  });

  it('builds a turning profile and routes to the turning cost model', () => {
    expect(a.isTurned).toBe(true);
    expect(a.machineClass).toBe('turn');
    expect(a.turningProfile).toBeDefined();
    expect(a.turningProfile!.odMm).toBe(25);
    expect(a.turningProfile!.boreDiaMm).toBe(12);
    expect(a.milledProfile).toBeUndefined();
  });

  it('picks the next standard bar over OD + allowance', () => {
    const expected = nextStandardBar(25 + 2 * DEFAULT_CNC_SETTINGS.radialStockAllowanceMm);
    expect(a.barDiameterMm).toBe(expected);
  });

  it('derives volume (cylinder − bore) and weight from density', () => {
    const cyl = (Math.PI / 4) * 25 * 25 * 40;
    const bore = (Math.PI / 4) * 12 * 12 * 40;
    const volCm3 = (cyl - bore) / 1000;
    expect(a.volumeCm3!).toBeCloseTo(volCm3, 1);
    const density = materialPropsFor('Brass CZ121').densityGCm3;
    expect(a.weightKg!).toBeCloseTo((volCm3 * density) / 1000, 2);
  });

  it('flags the estimate as drawing-read and low(ish) confidence', () => {
    expect(a.measurementSource).toBe('ai-drawing');
    expect(a.aiNotes[0]).toMatch(/verify/i);
    expect(a.aiNotes).toContain('⌀25 read from the front view');
  });

  it('produces a positive machining quote end-to-end', () => {
    const c = calculateMachiningCosts(
      { isTurned: true, materialName: a.materialName, volumeCm3: a.volumeCm3!, profile: a.turningProfile!, setups: a.setups ?? 1, materialPricePerKg: 8 },
      10, false, 0.25, DEFAULT_SHOP_SETTINGS, 1
    );
    expect(c.subtotal + c.overhead + c.marginAmount).toBeGreaterThan(0);
    expect(c.barDiameterMm).toBeGreaterThan(0); // turned quote carries a bar size
  });
});

describe('fromAiData — STEP read by AI (geometry-service fallback)', () => {
  const a = fromAiData('plate.step', 'STEP', {
    partName: 'Plate',
    materialName: 'Aluminium 6082',
    partClass: 'milled',
    milled: { lengthMm: 68, widthMm: 68, heightMm: 3, holeCount: 1, pocketCount: 2, bossCount: 1, setupCount: 1 },
    confidenceScore: 45,
  });

  it('builds a milled profile and keeps the STEP file type', () => {
    expect(a.fileType).toBe('STEP');
    expect(a.machineClass).toBe('mill');
    expect(a.milledProfile).toBeDefined();
    expect(a.milledProfile!.pocketCount).toBe(2);
  });

  it('flags it as an AI estimate with a STEP-specific verify note', () => {
    expect(a.measurementSource).toBe('ai-drawing');
    expect(a.aiNotes[0]).toMatch(/geometry service was unavailable/i);
    expect(a.aiNotes[0]).toMatch(/verify/i);
  });
});

describe('fromAiData — milled drawing', () => {
  const a = fromAiData('bracket.pdf', 'PDF', {
    partName: 'Bracket',
    materialName: 'Aluminium 6082',
    partClass: 'milled',
    milled: { lengthMm: 120, widthMm: 80, heightMm: 25, holeCount: 6, holeDetails: [{ diameterMm: 8, count: 6 }], pocketCount: 2, bossCount: 0, setupCount: 2 },
    weightKg: 0.35,
    confidenceScore: 60,
  });

  it('builds a milled profile from a purchasable billet', () => {
    expect(a.isTurned).toBe(false);
    expect(a.machineClass).toBe('mill');
    expect(a.milledProfile).toBeDefined();
    // Billet is rounded up from the bbox → strictly larger than the raw box.
    expect(a.milledProfile!.stockVolumeCm3).toBeGreaterThan((120 * 80 * 25) / 1000);
    expect(a.milledProfile!.setupCount).toBe(2);
    expect(a.milledProfile!.holeCount).toBe(6);
  });

  it('uses the stated weight for the part volume when given', () => {
    const density = materialPropsFor('Aluminium 6082').densityGCm3;
    expect(a.milledProfile!.partVolumeCm3).toBeCloseTo((0.35 * 1000) / density, 0);
  });

  it('produces a positive milled quote end-to-end', () => {
    const c = calculateMilledCosts(
      { materialName: a.materialName, profile: a.milledProfile!, materialPricePerKg: 16.5 },
      10, false, 0.25, DEFAULT_SHOP_SETTINGS, 1
    );
    expect(c.subtotal + c.overhead + c.marginAmount).toBeGreaterThan(0);
    expect(c.machineClass).toBe('mill');
  });
});

describe('fromAiData — fallbacks', () => {
  it('treats "unknown" with a bounding box as a milled part', () => {
    const a = fromAiData('plate.pdf', 'PDF', {
      partName: 'Plate', partClass: 'unknown',
      milled: { lengthMm: 60, widthMm: 40, heightMm: 10, holeCount: 0, holeDetails: [], pocketCount: 0, bossCount: 0, setupCount: 1 },
    });
    expect(a.milledProfile).toBeDefined();
    expect(a.machineClass).toBe('mill');
  });

  it('drops to manual entry when nothing usable was read', () => {
    const a = fromAiData('scan.pdf', 'PDF', { partName: 'Scan', partClass: 'unknown' });
    expect(a.turningProfile).toBeUndefined();
    expect(a.milledProfile).toBeUndefined();
    expect(a.confidenceScore).toBe(0);
    expect(a.aiNotes.join(' ')).toMatch(/confirm the dimensions/i);
  });

  it('does not fabricate a turned profile when the OD is missing', () => {
    const a = fromAiData('shaft.pdf', 'PDF', { partClass: 'turned', turned: { lengthMm: 50 } });
    expect(a.turningProfile).toBeUndefined();
  });
});
