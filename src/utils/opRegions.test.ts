import { describe, it, expect } from 'vitest';
import {
  turningOpRegions,
  pilotDiaFromToolpath,
  milledFeatureLayout,
  milledOpsFor,
} from './opRegions';
import { generateTurningToolpath } from './toolpath';
import { materialPropsFor } from './materials';
import type { TurningProfile } from './turning';

const alu = materialPropsFor('Aluminium 6082');

// A bushing: OD 40, length 50, with a 25 mm bore 30 deep — forces drill + bore.
const bushing: TurningProfile = {
  odMm: 40,
  lengthMm: 50,
  boreDiaMm: 25,
  boreDepthMm: 30,
  grooveCount: 0,
  threadCount: 0,
} as unknown as TurningProfile;

// A plain shaft: OD 20, length 80, no bore.
const shaft: TurningProfile = {
  odMm: 20,
  lengthMm: 80,
  boreDiaMm: 0,
  boreDepthMm: 0,
  grooveCount: 0,
  threadCount: 0,
} as unknown as TurningProfile;

describe('turningOpRegions', () => {
  it('emits regions in machining order for a bored part', () => {
    const tp = generateTurningToolpath(bushing, 44, alu);
    const info = turningOpRegions(tp);
    const ops = info.map((i) => i.op);
    expect(ops).toEqual(['face', 'rough', 'drill', 'bore', 'finish', 'partoff']);
    // Every region is non-degenerate and every op carries copy.
    for (const i of info) {
      expect(i.description.length).toBeGreaterThan(10);
      expect(i.regions.length).toBeGreaterThan(0);
      for (const r of i.regions) expect(r.rOuter).toBeGreaterThanOrEqual(r.rInner);
    }
  });

  it('omits drill/bore when there is no hole', () => {
    const tp = generateTurningToolpath(shaft, 24, alu);
    const ops = turningOpRegions(tp).map((i) => i.op);
    expect(ops).not.toContain('drill');
    expect(ops).not.toContain('bore');
    expect(ops).toContain('rough');
  });

  it('roughing spans the stock→part OD annulus, drill sits inside the pilot', () => {
    const tp = generateTurningToolpath(bushing, 44, alu);
    const info = turningOpRegions(tp);
    const rough = info.find((i) => i.op === 'rough')!.regions[0];
    expect(rough.shape).toBe('annulus');
    expect(rough.rInner).toBeCloseTo(bushing.odMm / 2, 5); // part OD
    expect(rough.rOuter).toBeCloseTo(tp.stockDiaMm / 2, 5); // stock radius

    const pilot = pilotDiaFromToolpath(tp);
    expect(pilot).toBeGreaterThan(0);
    expect(pilot).toBeLessThanOrEqual(bushing.boreDiaMm);
    const drill = info.find((i) => i.op === 'drill')!.regions[0];
    expect(drill.shape).toBe('core');
    expect(drill.rOuter).toBeCloseTo(pilot / 2, 5);
  });
});

describe('milledFeatureLayout', () => {
  it('lays out exactly the counts it is given', () => {
    const l = milledFeatureLayout({ pocketCount: 3, bossCount: 2, deepPocketCount: 1, holeCount: 6 });
    expect(l.pockets).toHaveLength(3);
    expect(l.bosses).toHaveLength(2);
    expect(l.holes).toHaveLength(6);
    expect(l.hiddenHoles).toBe(0);
    // The deep pockets are flagged.
    expect(l.pockets.filter((p) => p.deep)).toHaveLength(1);
  });

  it('caps the hole markers but reports the overflow', () => {
    const l = milledFeatureLayout({ pocketCount: 0, bossCount: 0, deepPocketCount: 0, holeCount: 40 });
    expect(l.holes.length).toBeLessThanOrEqual(24);
    expect(l.hiddenHoles).toBe(40 - l.holes.length);
  });

  it('keeps every feature inside the 0–1 footprint', () => {
    const l = milledFeatureLayout({ pocketCount: 6, bossCount: 8, deepPocketCount: 2, holeCount: 20 });
    for (const p of [...l.pockets, ...l.bosses]) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + p.w).toBeLessThanOrEqual(1.0001);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y + p.h).toBeLessThanOrEqual(1.0001);
    }
    for (const h of l.holes) {
      expect(h.x).toBeGreaterThanOrEqual(0);
      expect(h.x).toBeLessThanOrEqual(1);
      expect(h.y).toBeGreaterThanOrEqual(0);
      expect(h.y).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic', () => {
    const c = { pocketCount: 4, bossCount: 3, deepPocketCount: 1, holeCount: 10 };
    expect(milledFeatureLayout(c)).toEqual(milledFeatureLayout(c));
  });
});

describe('milledOpsFor', () => {
  it('drops drilling when there are no holes, keeps face/rough/finish', () => {
    const ops = milledOpsFor({ pocketCount: 1, bossCount: 0, deepPocketCount: 0, holeCount: 0 }).map((o) => o.op);
    expect(ops).toEqual(['facing', 'rough', 'finish']);
  });

  it('includes drilling when holes are present', () => {
    const ops = milledOpsFor({ pocketCount: 0, bossCount: 0, deepPocketCount: 0, holeCount: 4 }).map((o) => o.op);
    expect(ops).toContain('drill');
  });
});
