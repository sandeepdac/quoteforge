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

  it('falls back to the generic sample for an unknown PDF', async () => {
    const a = await analyzeCadFile({ name: 'random_drawing.pdf' });
    expect(a.fileType).toBe('PDF');
    expect(a.partName).not.toBe('P5 ROUND TOP FLAG');
  });
});
