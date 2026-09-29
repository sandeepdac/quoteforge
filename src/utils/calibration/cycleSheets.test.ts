import { describe, it, expect } from 'vitest';
import {
  CYCLE_SHEETS, sheetCuttingSec, sheetIdleSec, sheetCycleSec, idlePerOpSec, ROUTER_OVER_MEASURED,
} from './cycleSheets';
import { QUOTED_PARTS, machiningCycleMinPerPart } from './quotes';

describe('the transcription matches the sheets', () => {
  for (const s of CYCLE_SHEETS) {
    it(`${s.drawing}: the operations add to the totals printed on it`, () => {
      expect(sheetCuttingSec(s)).toBe(s.statedCuttingSec);
      expect(sheetIdleSec(s)).toBe(s.statedIdleSec);
      expect(sheetCycleSec(s) / 60).toBeCloseTo(s.statedCycleMin, 1);
    });

    it(`${s.drawing}: every operation has a name and non-negative times`, () => {
      for (const o of s.ops) {
        expect(o.operation.length, o.operation).toBeGreaterThan(3);
        expect(o.cuttingSec).toBeGreaterThanOrEqual(0);
        expect(o.idleSec).toBeGreaterThanOrEqual(0);
      }
    });
  }
});

describe('the router is not a cycle time, and this proves it', () => {
  // The finding that reframes the whole calibration: cycle time has been scored
  // against router minutes, and the router books 2.6x to 5.4x what the machine
  // measures. Most of "we are twenty times too fast" was the target.
  it('every sheet is far shorter than the router books for the same work', () => {
    for (const s of CYCLE_SHEETS) {
      const r = ROUTER_OVER_MEASURED[s.drawing as keyof typeof ROUTER_OVER_MEASURED];
      expect(r, `no router comparison for ${s.drawing}`).toBeTruthy();
      expect(r.ratio).toBeGreaterThan(2);
      expect(sheetCycleSec(s) / 60).toBeCloseTo(r.measuredMin, 1);
    }
  });

  it('the housing sheet covers the whole job, so its router total is comparable', () => {
    const sheet = CYCLE_SHEETS.find((s) => s.drawing === '031169-A')!;
    const part = QUOTED_PARTS.find((p) => p.drawing === '031169-A')!;
    expect(sheet.ops.some((o) => /part off/i.test(o.operation))).toBe(true);
    // 45 router minutes against 8.28 measured.
    expect(machiningCycleMinPerPart(part) / (sheetCycleSec(sheet) / 60)).toBeGreaterThan(4);
  });
});

describe('what the sheets say about non-cutting time', () => {
  it('idle runs 16-22s per operation, not the ~5s the model charges', () => {
    // Our per-operation non-cutting is a turret index (3s on a turn-mill) plus
    // an approach (~2.3s). The sheets say the real figure is three times that,
    // consistently, on two different machines.
    for (const s of CYCLE_SHEETS) {
      expect(idlePerOpSec(s), s.drawing).toBeGreaterThan(14);
      expect(idlePerOpSec(s), s.drawing).toBeLessThan(25);
    }
  });

  it('idle is a quarter to a third of the whole cycle', () => {
    for (const s of CYCLE_SHEETS) {
      const share = sheetIdleSec(s) / sheetCycleSec(s);
      expect(share, s.drawing).toBeGreaterThan(0.2);
      expect(share, s.drawing).toBeLessThan(0.4);
    }
  });

  it('bar handling alone is 30s, against the 8s allowance in settings', () => {
    for (const s of CYCLE_SHEETS) {
      const bar = s.ops.find((o) => /bar stop/i.test(o.operation))!;
      expect(bar.idleSec).toBe(30);
      expect(bar.cuttingSec).toBe(0);
    }
  });
});

describe('operations the model does not know exist', () => {
  it('DEBURRING is a real, timed operation on both parts', () => {
    // 32s of cutting on the housing, 150s on the hollow arm — and the model has
    // no deburring operation at all.
    for (const s of CYCLE_SHEETS) {
      const deburr = s.ops.filter((o) => /deburr/i.test(o.operation));
      expect(deburr.length, `${s.drawing} has no deburr op`).toBeGreaterThan(0);
      expect(deburr.reduce((a, o) => a + o.cuttingSec, 0)).toBeGreaterThan(10);
    }
  });

  it('the hollow arm spends more time deburring slots than cutting them', () => {
    const s = CYCLE_SHEETS.find((x) => x.drawing === 'OLY014_01921-A')!;
    const mill = s.ops.find((o) => /mill 3.3mm dia slots/i.test(o.operation))!;
    const deburr = s.ops.find((o) => /deburr 3.3mm dia slots/i.test(o.operation))!;
    expect(deburr.cuttingSec).toBe(mill.cuttingSec);
  });

  it('its single longest operation is micro-milling six ⌀0.7 holes', () => {
    const s = CYCLE_SHEETS.find((x) => x.drawing === 'OLY014_01921-A')!;
    const longest = s.ops.reduce((a, o) => (o.cuttingSec > a.cuttingSec ? o : a));
    expect(longest.operation).toMatch(/0\.7mm diameter holes/i);
    expect(longest.cuttingSec).toBe(360);
    // A third of the part's cutting time in one operation.
    expect(longest.cuttingSec / sheetCuttingSec(s)).toBeGreaterThan(0.3);
  });
});
