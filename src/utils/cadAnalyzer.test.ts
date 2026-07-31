import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { analyzeCadFile } from './cadAnalyzer';

const realStep = readFileSync(
  resolve(process.cwd(), 'public/samples/P5-Round-Top-Flag.STEP'),
  'utf-8'
);

describe('analyzeCadFile — STEP dispatch', () => {
  it('produces a manufacturable feature set from the real STEP model', async () => {
    const a = await analyzeCadFile({ name: 'P5-Round-Top-Flag.STEP', content: realStep });
    expect(a.fileType).toBe('STEP');
    expect(a.materialName).toMatch(/Mild Steel/);
    expect(a.weightKg).toBeGreaterThan(0);
    expect(a.holeDetails.length).toBeGreaterThan(0);
    expect(a.stepData).toBeDefined();
  });
});

describe('analyzeCadFile — PDF dispatch', () => {
  it('matches the bundled P5 drawing by filename', async () => {
    const a = await analyzeCadFile({ name: 'P5-Round-Top-Flag.pdf', pdfUrl: '/samples/x.pdf' });
    expect(a.fileType).toBe('PDF');
    expect(a.partName).toBe('P5 ROUND TOP FLAG');
    expect(a.pdfData?.drawingNumber).toBe('FGC-P5-08');
    expect(a.pdfUrl).toBe('/samples/x.pdf');
  });

  it('asks for manual confirmation on an unknown PDF (no fabricated data)', async () => {
    const a = await analyzeCadFile({ name: 'random_drawing.pdf' });
    expect(a.fileType).toBe('PDF');
    expect(a.partName).not.toBe('P5 ROUND TOP FLAG');
    expect(a.measurementSource).toBe('manual');
    expect(a.lengthMm).toBe(0);
  });
});

describe('analyzeCadFile — honest fallbacks', () => {
  it('never fabricates dimensions for an unrecognized file', async () => {
    const a = await analyzeCadFile({ name: 'mystery.dwg' });
    expect(a.measurementSource).toBe('manual');
    expect([a.lengthMm, a.widthMm, a.heightMm, a.weightKg]).toEqual([0, 0, 0, 0]);
    expect(a.confidenceScore).toBe(0);
  });

  it('routes an image with no AI backend to manual entry', async () => {
    const a = await analyzeCadFile({ name: 'sketch.png', pdfUrl: 'blob:x' });
    expect(a.fileType).toBe('IMAGE');
    expect(a.measurementSource).toBe('manual');
  });
});
