import { describe, it, expect } from 'vitest';
import {
  estimateTurningTimes, DEFAULT_TURNING_CONFIG, type TurningProfile,
  threadPassCount, threadFormHeightMm, boringDepthOfCutMm, barDiameterForBore,
  THREAD_VC_FRACTION, GROOVE_TOOL_WIDTH_MM,
} from './turning';
import { DEFAULT_TURNING_TOOLS } from '../constants';
import { materialPropsFor } from './materials';
import { TOOL_CHANGE_SEC } from './machineSelection';
import { drillHoleSplit, DRILL_SUBSTRATE_VC, DEFAULT_DRILL_CONFIG, threadFromCallout } from './drilling';

/**
 * THE FIVE FAULTS THE REALISATION STACK EXPOSED.
 *
 * Applying a defensible shop derate to the housing landed finish turning on
 * Lance's figure (x1.04) and left deburring at x0.01 — which is the evidence
 * that those operations fail for different reasons and that no multiplier fixes
 * both. Five had a nameable cause; these are the fixes.
 *
 * EVERY ASSERTION IS ABOUT A RELATION, NOT A SECOND. The pass count comes from
 * published infeed tables, the thread height from the ISO form, the boring depth
 * from the bar's own diameter, the drill speed from what the drill is made of.
 * Nothing is asserted to equal a figure from a Turncircuit sheet — the sheets
 * said which operations to look at, not what the answers are.
 */
const brass = materialPropsFor('Brass CZ121');
const cfg = {
  ...DEFAULT_TURNING_CONFIG, toolLibrary: DEFAULT_TURNING_TOOLS, facingAllowanceMm: 2,
  toolChangeSec: TOOL_CHANGE_SEC['lathe'],
};
const housing: TurningProfile = {
  odMm: 29.3, lengthMm: 70, boreDiaMm: 11.8, boreDepthMm: 14, grooveCount: 4,
  threadCount: 1, faceCount: 2, crossFeatures: false, barDiameterMm: 36,
};

describe('fault 1 — a thread is not six passes at turning speed', () => {
  it('the pass count follows the published infeed tables, which are linear in pitch', () => {
    // Sandvik / Seco / Vardex tabulate infeeds for a 60-degree thread:
    //   pitch 0.5 -> 5, 1.0 -> 7, 1.5 -> 9, 2.0 -> 11, 3.0 -> 15
    // i.e. 3 + 4p, and one spring pass on top.
    expect(threadPassCount(0.5)).toBe(5 + 1);
    expect(threadPassCount(1.0)).toBe(7 + 1);
    expect(threadPassCount(1.5)).toBe(9 + 1);
    expect(threadPassCount(2.0)).toBe(11 + 1);
    expect(threadPassCount(3.0)).toBe(15 + 1);
  });

  it('a coarse thread is more work than a fine one — the old model said they were equal', () => {
    expect(threadPassCount(3)).toBeGreaterThan(threadPassCount(0.4) * 2);
    // And the form height is what drives it.
    expect(threadFormHeightMm(2)).toBeCloseTo(2 * threadFormHeightMm(1), 9);
  });

  it('screwcutting runs slower than turning, never faster', () => {
    expect(THREAD_VC_FRACTION).toBeLessThan(1);
    // Published thread-turning speed in brass is around 100-150 m/min against
    // 300-400 for general turning: the ratio, not the absolute figure.
    const thread = brass.cuttingSpeedFinish * THREAD_VC_FRACTION;
    expect(thread).toBeGreaterThan(80);
    expect(thread).toBeLessThan(180);
  });

  it('the pitch comes from the callout, and a FINE thread is the slow one', () => {
    // The pitch used to be a hardcoded 1.5 mm, so every thread on every part was
    // the same operation. Now it reaches the model — and the direction is worth
    // writing down because it catches people out:
    //
    //   threading time = passes x (length / pitch) revolutions
    //
    // A coarse thread removes far more metal but advances further per rev, so
    // over the SAME length a fine thread needs more revolutions per pass and
    // more time overall, even though it takes fewer passes. 0.4 mm pitch over
    // 21 mm is 52 revs a pass; 1.75 mm pitch is 12.
    // The SCREWCUT thread's own pitch field — not `threads`, which is the
    // tapped-hole list and a different feature entirely.
    const threadSec = (pitchMm: number) => {
      const t = estimateTurningTimes({ ...housing, threadPitchMm: pitchMm }, brass, 55, cfg);
      return t.opTimes.find(o => o.op === 'thread')!.cuttingSec;
    };
    const fine = threadSec(threadFromCallout('M2x0.4', 5)!.pitchMm);    // 0.4
    const coarse = threadSec(threadFromCallout('M12', 12)!.pitchMm);    // 1.75
    expect(fine).not.toBeCloseTo(coarse, 2);   // the pitch is read at all
    expect(fine).toBeGreaterThan(coarse);      // and fine is slower per unit length
  });

  it('every pass but the first pays a return and a spindle resync', () => {
    const t = estimateTurningTimes(housing, brass, 55, cfg);
    const thread = t.opTimes.find(o => o.op === 'thread')!;
    // It was the one operation with no idle at all.
    expect(thread.idleSec).toBeGreaterThan(0);
  });
});

describe('fault 2 — a screwcut thread is deburred along its helix', () => {
  it('deburring costs about a thread pass, not a chamfer', () => {
    const withThread = estimateTurningTimes(housing, brass, 55, cfg);
    const without = estimateTurningTimes({ ...housing, threadCount: 0 }, brass, 55, cfg);
    const delta = withThread.opTimes.find(o => o.op === 'deburr')!.cuttingSec
      - (without.opTimes.find(o => o.op === 'deburr')?.cuttingSec ?? 0);
    const onePass = withThread.opTimes.find(o => o.op === 'thread')!.cuttingSec / threadPassCount(1.5);
    // The same order as one threading pass — that IS the mechanism.
    expect(delta).toBeGreaterThan(onePass * 0.5);
    expect(delta).toBeLessThan(onePass * 2);
  });

  it('a tapped thread is still deburred at the mouth, not along the helix', () => {
    // A tap cannot be re-run to clean its own thread; the burr it leaves is at
    // the hole mouth and a chamfer reaches it.
    const tapped = estimateTurningTimes(
      { ...housing, threadCount: 0, threads: [threadFromCallout('M6', 8)!] },
      brass, 55, cfg);
    const plain = estimateTurningTimes({ ...housing, threadCount: 0 }, brass, 55, cfg);
    expect(tapped.deburrSec).toBeGreaterThan(plain.deburrSec);
  });
});

describe('fault 3 — the boring bar sets the depth of cut, not the material', () => {
  it('a slender bar takes a lighter cut than a big one', () => {
    expect(boringDepthOfCutMm(8, 1.8)).toBeLessThan(boringDepthOfCutMm(25, 1.8));
    // A tenth of the bar, and never more than the material allows.
    expect(boringDepthOfCutMm(8, 1.8)).toBeCloseTo(0.8, 9);
    expect(boringDepthOfCutMm(25, 1.8)).toBeCloseTo(1.8, 9);
  });

  it('a bar has to fit down the hole', () => {
    expect(barDiameterForBore(11.8)).toBeLessThan(11.8);
    // An ⌀11.8 bore takes something like an S08K — around 8 mm.
    expect(barDiameterForBore(11.8)).toBeGreaterThan(6);
    expect(barDiameterForBore(11.8)).toBeLessThan(10);
  });

  it('it binds on a bore with real stock in it', () => {
    // On the housing's ⌀10.5 -> ⌀11.8 there is 0.65 mm to remove and the limit
    // never bites. That is not a reason to leave it out: open the bore up and
    // the pass count is what the bar allows.
    const big = estimateTurningTimes({ ...housing, boreDiaMm: 40, boreDepthMm: 60 }, brass, 55, cfg);
    const small = estimateTurningTimes(housing, brass, 55, cfg);
    expect(big.opTimes.find(o => o.op === 'bore')!.cuttingSec)
      .toBeGreaterThan(small.opTimes.find(o => o.op === 'bore')!.cuttingSec * 10);
  });
});

describe('fault 4 — a groove is roughed and then finished', () => {
  it('the plunge is pecked and the floor and flanks are finished', () => {
    const t = estimateTurningTimes(housing, brass, 55, cfg);
    const groove = t.opTimes.find(o => o.op === 'groove')!;
    // A plunge alone cannot hold a width or a floor: there is a finish path of
    // the insert width plus both flanks.
    expect(GROOVE_TOOL_WIDTH_MM).toBeGreaterThan(0);
    expect(groove.cuttingSec).toBeGreaterThan(0);
    // Deeper groove -> longer finish path up the flanks, so more time per groove.
    const deeper = estimateTurningTimes({ ...housing, odMm: 60 }, brass, 55, cfg);
    const perGroove = (x: typeof t) => x.opTimes.find(o => o.op === 'groove')!.cuttingSec / 4;
    expect(perGroove(deeper)).toBeGreaterThan(perGroove(t));
  });

  it('pecking shows up as idle, not as cutting', () => {
    const t = estimateTurningTimes(housing, brass, 55, cfg);
    expect(t.opTimes.find(o => o.op === 'groove')!.idleSec).toBeGreaterThan(0);
  });
});

describe('fault 5 — what the drill is made of sets how fast it goes', () => {
  it('HSS is slower than carbide, and cobalt sits between', () => {
    expect(DRILL_SUBSTRATE_VC.hss).toBeLessThan(DRILL_SUBSTRATE_VC.cobalt);
    expect(DRILL_SUBSTRATE_VC.cobalt).toBeLessThan(DRILL_SUBSTRATE_VC.carbide);
    expect(DRILL_SUBSTRATE_VC.carbide).toBe(1);
  });

  it('an HSS drill takes materially longer through the same hole', () => {
    const hole = { diameterMm: 10, depthMm: 70 };
    const dcfg = { ...DEFAULT_DRILL_CONFIG, maxRpm: 6000, rapidMmPerMin: 30000 };
    const carbide = drillHoleSplit(hole, brass, { ...dcfg, substrate: 'carbide' });
    const hss = drillHoleSplit(hole, brass, { ...dcfg, substrate: 'hss' });
    expect(hss.cuttingSec).toBeGreaterThan(carbide.cuttingSec * 2);
    // Idle barely moves: the rapids and pecks are the machine's, not the drill's.
    expect(hss.idleSec / carbide.idleSec).toBeLessThan(1.3);
  });

  it('the default is carbide, so nothing moves until the shop says otherwise', () => {
    const hole = { diameterMm: 10, depthMm: 70 };
    const dcfg = { ...DEFAULT_DRILL_CONFIG, maxRpm: 6000 };
    const bare = drillHoleSplit(hole, brass, { ...dcfg, substrate: undefined });
    const carbide = drillHoleSplit(hole, brass, { ...dcfg, substrate: 'carbide' });
    expect(bare.cuttingSec).toBeCloseTo(carbide.cuttingSec, 9);
  });
});

describe('the fixes are surgical', () => {
  it('they move only the operations they are about', () => {
    const t = estimateTurningTimes(housing, brass, 55, cfg);
    // Measured before the five fixes, same profile, same config.
    const before: Record<string, number> = { face: 1.2, rough: 11.0, finish: 5.6, partoff: 4.2 };
    for (const [op, was] of Object.entries(before)) {
      const now = t.opTimes.find(o => o.op === op)!.cuttingSec;
      expect(Math.abs(now / was - 1)).toBeLessThan(0.05);
    }
  });
});
