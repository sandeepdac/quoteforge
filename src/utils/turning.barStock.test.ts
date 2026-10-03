import { describe, it, expect } from 'vitest';
import {
  estimateTurningTimes, DEFAULT_TURNING_CONFIG, polygonSectionMm2, acrossCornersMm,
  type TurningProfile,
} from './turning';
import { calculateMachiningCosts, computeStock } from './cncEstimator';
import { DEFAULT_TURNING_TOOLS, DEFAULT_SHOP_SETTINGS } from '../constants';
import { materialPropsFor } from './materials';
import { normaliseRealisation } from './realisation';

/**
 * THE BAR, AND WHAT IS TURNED OUT OF IT.
 *
 * The VOC housing is cut from 25.4 A/F hex bar (its drawing says so, and the
 * geometry service counts six flats). The model treated it as round: it roughed
 * ⌀36 bar that is not there, finish-turned 70 mm of the hex's corners, and read
 * two end lands as "4 grooves" while missing the ⌀21 x 44 recess between the
 * hex collars that the shop's sheet calls "rough and finish recess".
 *
 * Assertions are geometry and relations; none pins a second from the sheet.
 */
const brass = materialPropsFor('Brass CZ121');
const cfg = { ...DEFAULT_TURNING_CONFIG, toolLibrary: DEFAULT_TURNING_TOOLS, facingAllowanceMm: 2 };
const hex = { shape: 'polygon' as const, flats: 6, acrossFlatsMm: 25.4 };
const regions: NonNullable<TurningProfile['odRegions']> = [
  { diameterMm: 21, zStartMm: -34.5, zEndMm: -30, lengthMm: 4.5, kind: 'boss' },
  { diameterMm: 21, zStartMm: -22, zEndMm: 22, lengthMm: 44, kind: 'recess' },
  { diameterMm: 21, zStartMm: 30, zEndMm: 34.5, lengthMm: 4.5, kind: 'boss' },
];
const housing: TurningProfile = {
  odMm: 29.33, lengthMm: 70, boreDiaMm: 11.8, boreDepthMm: 14, grooveCount: 4,
  threadCount: 0, faceCount: 2, crossFeatures: false, stock: hex, odRegions: regions,
};

describe('a polygon bar', () => {
  it('has the section and corners of the polygon', () => {
    // Hex: area 0.866 x AF^2, corners at AF / cos 30.
    expect(polygonSectionMm2(6, 25.4)).toBeCloseTo((Math.sqrt(3) / 2) * 25.4 * 25.4, 6);
    expect(acrossCornersMm(6, 25.4)).toBeCloseTo(29.33, 2);
    // Square: area AF^2.
    expect(polygonSectionMm2(4, 20)).toBeCloseTo(400, 6);
  });

  it('is bought and weighed as the polygon, not as the next round bar', () => {
    const s = computeStock(housing);
    const round = computeStock({ ...housing, stock: undefined });
    expect(s.stockDescription).toBe('25.4 A/F hex bar');
    expect(s.stockVolumeCm3).toBeCloseTo(polygonSectionMm2(6, 25.4) * s.barLengthMm / 1000, 6);
    expect(s.stockVolumeCm3).toBeLessThan(round.stockVolumeCm3);
  });
});

describe('what is turned out of it', () => {
  const t = estimateTurningTimes(housing, brass, 55, cfg);
  const op = (name: string) => t.opTimes.find((o) => o.op === name);

  it('finishes the turned bosses at their own diameter, not 70 mm of corners', () => {
    const old = estimateTurningTimes({ ...housing, stock: undefined, odRegions: undefined }, brass, 55, cfg);
    expect(op('finish')!.cuttingSec).toBeLessThan(old.opTimes.find((o) => o.op === 'finish')!.cuttingSec / 3);
  });

  it('roughs only the regions, so a hole does not count as turned metal', () => {
    // The old rule was (bar - part), which includes every hole. Regions do not.
    const withHole = estimateTurningTimes(housing, brass, 55, cfg);
    const biggerRemovalNumber = estimateTurningTimes(housing, brass, 155, cfg);
    expect(biggerRemovalNumber.opTimes.find((o) => o.op === 'rough')!.cuttingSec)
      .toBeCloseTo(withHole.opTimes.find((o) => o.op === 'rough')!.cuttingSec, 9);
  });

  it('cuts the recess with the grooving insert, and the groove COUNT no longer applies', () => {
    const g = op('groove')!;
    expect(g.cuttingSec).toBeGreaterThan(0);
    // The same part with the face-count artefact doubled: no change.
    const t8 = estimateTurningTimes({ ...housing, grooveCount: 8 }, brass, 55, cfg);
    expect(t8.opTimes.find((o) => o.op === 'groove')!.cuttingSec).toBeCloseTo(g.cuttingSec, 9);
  });

  it('a longer recess takes more plunges', () => {
    const longer = estimateTurningTimes({
      ...housing, odRegions: regions.map((r) => r.kind === 'recess' ? { ...r, lengthMm: 60 } : r),
    }, brass, 55, cfg);
    expect(longer.opTimes.find((o) => o.op === 'groove')!.cuttingSec).toBeGreaterThan(op('groove')!.cuttingSec);
  });

  it('with no regions, the old single-OD model still runs', () => {
    const legacy = estimateTurningTimes({ ...housing, stock: undefined, odRegions: undefined }, brass, 55, cfg);
    expect(legacy.opTimes.find((o) => o.op === 'groove')!.cuttingSec).toBeGreaterThan(0);
    expect(legacy.opTimes.find((o) => o.op === 'finish')!.cuttingSec).toBeGreaterThan(0);
  });
});

describe('the hex interrupts only the cuts on its outside', () => {
  const price = (p: TurningProfile, interruptedCut?: number) => calculateMachiningCosts(
    { isTurned: true, materialName: 'Brass CZ121', volumeCm3: 21, profile: p, setups: 1, materialPricePerKg: 12 },
    1, false, 0.25,
    { ...DEFAULT_SHOP_SETTINGS, cnc: { ...DEFAULT_SHOP_SETTINGS.cnc!,
      realisation: interruptedCut ? { interruptedCut } : undefined } });
  const rows = (c: ReturnType<typeof price>) => c.plan!.setups.flatMap((s) => s.operations);
  const cut = (c: ReturnType<typeof price>, op: string) => rows(c).find((o) => o.op === op)!.cuttingSeconds!;
  // The same hex part, with the interrupted-cut allowance switched off.
  const onHex = price(housing);
  const noInterrupt = price(housing, 1);
  const f = normaliseRealisation(DEFAULT_SHOP_SETTINGS.cnc!.realisation).interruptedCut;

  it('every operation on the outside of the hex carries the interrupted-cut factor', () => {
    for (const op of ['face', 'rough', 'finish', 'groove', 'partoff']) {
      expect(cut(onHex, op) / cut(noInterrupt, op), op).toBeCloseTo(1 / f, 6);
    }
  });

  it('the drill, the boring bar and the spot drill inside the part never see a corner', () => {
    for (const op of ['drill', 'bore', 'spot']) {
      expect(cut(onHex, op), op).toBeCloseTo(cut(noInterrupt, op), 9);
    }
  });

  it('on round bar with no cross holes, nothing is interrupted', () => {
    const round = { ...housing, stock: { shape: 'round' as const } };
    expect(cut(price(round), 'groove')).toBeCloseTo(cut(price(round, 1), 'groove'), 9);
  });

  it('the traveller says what is being cut, and from what', () => {
    const drivers = rows(onHex).map((o) => o.driver).join(' | ');
    expect(drivers).toMatch(/⌀21 × 44 — multi-plunge/);
    expect(drivers).toMatch(/25\.4 A\/F hex bar/);
    expect(rows(onHex).some((o) => o.name === 'Recess (grooving insert)')).toBe(true);
  });
});

describe('a stepped bore is drilled through at its narrow diameter', () => {
  const stepped: TurningProfile = { ...housing, pilotHole: { diameterMm: 10, depthMm: 70 } };
  const t = estimateTurningTimes(stepped, brass, 55, cfg);
  const plain = estimateTurningTimes(housing, brass, 55, cfg);

  it('the drill is the narrow hole, at its full depth', () => {
    expect(t.drillDiaMm).toBe(10);
    // 70 mm of ⌀10 against 14 mm of a separate ⌀10.5 pilot.
    expect(t.opTimes.find((o) => o.op === 'drill')!.cuttingSec)
      .toBeGreaterThan(plain.opTimes.find((o) => o.op === 'drill')!.cuttingSec * 3);
  });

  it('the mouth is bored up from it, so the boring bar has more wall to take', () => {
    expect(t.opTimes.find((o) => o.op === 'bore')!.cuttingSec)
      .toBeGreaterThan(plain.opTimes.find((o) => o.op === 'bore')!.cuttingSec);
  });

  it('a pilot shallower than the bore it serves is ignored', () => {
    const odd = estimateTurningTimes({ ...housing, pilotHole: { diameterMm: 10, depthMm: 5 } }, brass, 55, cfg);
    expect(odd.drillDiaMm).toBe(plain.drillDiaMm);
  });
});
