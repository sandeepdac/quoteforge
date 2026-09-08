import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseStepFile } from './stepParser';
import { SAMPLE_STEP_BRACKET } from './sampleCadFiles';

const realStep = readFileSync(
  resolve(process.cwd(), 'test-fixtures/P5-Round-Top-Flag.STEP'),
  'utf-8'
);

describe('parseStepFile — real P5 Round Top Flag STEP', () => {
  const r = parseStepFile(realStep, 'P5-Round-Top-Flag.STEP');

  it('extracts the true bounding box from the B-Rep geometry', () => {
    expect(r.lengthMm).toBe(56.3);
    expect(r.widthMm).toBe(40);
    expect(r.heightMm).toBe(34.3);
  });

  it('reads SolidWorks header metadata despite spaced author tuples', () => {
    expect(r.originatingSystem).toBe('SolidWorks 2023');
    expect(r.timestamp).toBe('2023-01-23');
  });

  it('does not false-positive a material from bare alloy digits in coordinates', () => {
    // The DATA section is full of coordinates containing "304"/"316"; a material
    // must only come from human-authored header/comment text (none here).
    expect(r.estimatedMaterialName).toBeUndefined();
  });

  it('counts fastener holes without inflating them with large bores', () => {
    expect(r.holeCount).toBe(14);
    const diameters = r.holeDetails.map((h) => h.diameterMm);
    expect(diameters).toContain(8.5);
    expect(diameters).toContain(5.5);
    // ⌀32 / ⌀40 rounded bores must not be reported as fastener holes.
    expect(r.holeDetails.every((h) => h.diameterMm <= 26)).toBe(true);
  });

  it('detects bends and a non-trivial cut perimeter', () => {
    expect(r.bendCount).toBeGreaterThan(0);
    expect(r.perimeterMm).toBeGreaterThan(2 * (r.lengthMm + r.widthMm));
  });
});

describe('parseStepFile — material detection from comments', () => {
  it('reads the material callout from a STEP comment block', () => {
    const r = parseStepFile(SAMPLE_STEP_BRACKET, 'bracket.step');
    expect(r.estimatedMaterialName).toBe('Mild Steel');
  });
});

describe('parseStepFile — regression guards', () => {
  const minimalStep = `ISO-10303-21;
HEADER;
FILE_NAME('t.step','2020-01-01T00:00:00',(''),(''),'pre','TestCAD','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1=CARTESIAN_POINT('',(304.0,316.5,-1.0));
#2=CARTESIAN_POINT('',(0.0,0.0,0.0));
ENDSEC;
END-ISO-10303-21;`;

  it('ignores alloy-like numbers that only appear in geometry', () => {
    const r = parseStepFile(minimalStep, 't.step');
    expect(r.estimatedMaterialName).toBeUndefined();
  });

  it('parses the originating system from a non-spaced FILE_NAME tuple', () => {
    const r = parseStepFile(minimalStep, 't.step');
    expect(r.originatingSystem).toBe('TestCAD');
  });

  it('converts imperial units to millimetres', () => {
    const inchStep = minimalStep.replace('DATA;', 'DATA;\n#9=SI_UNIT(*,.INCH.);');
    const r = parseStepFile(inchStep, 'inch.step');
    expect(r.unit).toBe('inch');
    expect(r.unitScale).toBe(25.4);
  });
});
