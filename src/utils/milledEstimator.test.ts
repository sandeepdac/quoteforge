import { describe, it, expect } from 'vitest';
import { calculateMilledCosts, contouredSetupCount, toBarStockProfile, MilledMachiningInput, MilledProfile } from './milledEstimator';
import { DEFAULT_SHOP_SETTINGS } from '../constants';

// A 60×40×20 mm aluminium block with one open pocket (~12.5% removed), 1 setup.
const baseProfile: MilledProfile = {
  stockMm: { x: 60, y: 40, z: 20 },
  stockVolumeCm3: 48,
  partVolumeCm3: 42,
  removedVolumeCm3: 6,
  surfaceAreaCm2: 120,
  setupCount: 1,
  pocketCount: 1,
  bossCount: 0,
  deepPocketCount: 0,
  holeCount: 0,
};

const input = (profile: MilledProfile): MilledMachiningInput => ({
  materialName: 'Aluminium 6082',
  profile,
  materialPricePerKg: 6,
});

describe('calculateMilledCosts (milling cycle-time)', () => {
  const costs = calculateMilledCosts(input(baseProfile), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);

  it('flags the milling route and reports stock/pocket metadata', () => {
    expect(costs.machineClass).toBe('mill');
    expect(costs.stockMm).toEqual({ x: 60, y: 40, z: 20 });
    expect(costs.pocketCount).toBe(1);
    expect(costs.setups).toBe(1);
  });

  it('produces a positive per-part cycle time and machine cost', () => {
    expect(costs.cycleTimeSec).toBeGreaterThan(0);
    expect(costs.machineCost).toBeGreaterThan(0);
  });

  it('reports a buy-to-fly ratio between 0 and 1', () => {
    expect(costs.buyToFlyRatio).toBeGreaterThan(0);
    expect(costs.buyToFlyRatio).toBeLessThan(1);
  });

  it('line items sum to the subtotal and each carries a driver', () => {
    const sum = costs.lineItems.reduce((s, li) => s + li.value, 0);
    expect(sum).toBeCloseTo(costs.subtotal, 4);
    expect(costs.lineItems.every((li) => li.value > 0 && li.driver.length > 0)).toBe(true);
  });
});

describe('setup amortisation (batch curve)', () => {
  const costs = calculateMilledCosts(input(baseProfile), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);

  it('unit price falls as quantity rises (setup spread over the batch)', () => {
    const prices = costs.batchCurve.map((p) => p.unitPrice);
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).toBeLessThan(prices[i - 1]);
    }
  });
});

describe('flat setup charge (CAM-style billing)', () => {
  const withFlat = { ...DEFAULT_SHOP_SETTINGS, cnc: { ...DEFAULT_SHOP_SETTINGS.cnc!, flatSetupChargePerSetup: 150 } };
  const twoSetup = { ...baseProfile, setupCount: 2 };

  it('adds flat × setups to the setup cost, amortised over the batch', () => {
    const off = calculateMilledCosts(input(twoSetup), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    const on = calculateMilledCosts(input(twoSetup), 1, false, 0.25, withFlat);
    // 2 setups × $150 = $300 extra at qty 1.
    expect(on.setupCost - off.setupCost).toBeCloseTo(300, 5);
  });

  it('amortises the flat charge over the batch like the rest of setup', () => {
    const on1 = calculateMilledCosts(input(twoSetup), 1, false, 0.25, withFlat);
    const on10 = calculateMilledCosts(input(twoSetup), 10, false, 0.25, withFlat);
    const off1 = calculateMilledCosts(input(twoSetup), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    const off10 = calculateMilledCosts(input(twoSetup), 10, false, 0.25, DEFAULT_SHOP_SETTINGS);
    expect(on10.setupCost - off10.setupCost).toBeCloseTo(30, 5); // 300 / 10
    expect(on1.setupCost - off1.setupCost).toBeCloseTo(300, 5);
  });

  it('is off by default (no change to the standard quote)', () => {
    const def = calculateMilledCosts(input(twoSetup), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    const explicitZero = calculateMilledCosts(input(twoSetup), 1, false, 0.25, {
      ...DEFAULT_SHOP_SETTINGS, cnc: { ...DEFAULT_SHOP_SETTINGS.cnc!, flatSetupChargePerSetup: 0 },
    });
    expect(def.setupCost).toBeCloseTo(explicitZero.setupCost, 6);
  });

  it('billing mode: flat REPLACES labour, both STACKS, time ignores the flat', () => {
    const cnc = { ...DEFAULT_SHOP_SETTINGS.cnc!, flatSetupChargePerSetup: 150 };
    const time = calculateMilledCosts(input(twoSetup), 1, false, 0.25, { ...DEFAULT_SHOP_SETTINGS, cnc: { ...cnc, setupBillingMode: 'time' } });
    const flat = calculateMilledCosts(input(twoSetup), 1, false, 0.25, { ...DEFAULT_SHOP_SETTINGS, cnc: { ...cnc, setupBillingMode: 'flat' } });
    const both = calculateMilledCosts(input(twoSetup), 1, false, 0.25, { ...DEFAULT_SHOP_SETTINGS, cnc: { ...cnc, setupBillingMode: 'both' } });
    // flat = 2 setups × $150 = $300 exactly (labour removed).
    expect(flat.setupCost).toBeCloseTo(300, 5);
    // both = time labour + $300.
    expect(both.setupCost).toBeCloseTo(time.setupCost + 300, 5);
    // time ignores the flat charge entirely.
    const timeNoFlat = calculateMilledCosts(input(twoSetup), 1, false, 0.25, { ...DEFAULT_SHOP_SETTINGS, cnc: { ...cnc, flatSetupChargePerSetup: 0, setupBillingMode: 'time' } });
    expect(time.setupCost).toBeCloseTo(timeNoFlat.setupCost, 5);
  });
});

describe('the three geometric rules move the price', () => {
  it('more setups (Rule 1) raise the setup cost', () => {
    const one = calculateMilledCosts(input({ ...baseProfile, setupCount: 1 }), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    const three = calculateMilledCosts(input({ ...baseProfile, setupCount: 3 }), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    expect(three.setupCost).toBeGreaterThan(one.setupCost);
    expect(three.subtotal).toBeGreaterThan(one.subtotal);
  });

  it('a deep pocket (Rule 3) increases the machining cost via the reach derate', () => {
    const shallow = calculateMilledCosts(input(baseProfile), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    const deep = calculateMilledCosts(input({ ...baseProfile, deepPocketCount: 1 }), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    expect(deep.machineCost).toBeGreaterThan(shallow.machineCost);
    expect(deep.deepPocketCount).toBe(1);
  });

  it('more removed volume (billet − part) raises roughing/machine cost', () => {
    const light = calculateMilledCosts(input({ ...baseProfile, partVolumeCm3: 45, removedVolumeCm3: 3 }), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    const heavy = calculateMilledCosts(input({ ...baseProfile, partVolumeCm3: 20, removedVolumeCm3: 28 }), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    expect(heavy.machineCost).toBeGreaterThan(light.machineCost);
  });
});

describe('soft-jaw / fixture amortisation', () => {
  // 3 setups → soft jaws are needed. They are made ONCE for the job, so their
  // per-part share must fall with batch size (this used to be charged per part).
  const p: MilledProfile = { ...baseProfile, setupCount: 3 };

  it('charges fixturing per job, not per part', () => {
    const one = calculateMilledCosts(input(p), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    const many = calculateMilledCosts(input(p), 100, false, 0.25, DEFAULT_SHOP_SETTINGS);
    const fixtureOf = (c: typeof one) => c.lineItems.find((li) => li.key === 'fixture')?.value ?? 0;
    expect(fixtureOf(one)).toBeGreaterThan(0);
    expect(fixtureOf(many)).toBeCloseTo(fixtureOf(one) / 100, 6);
  });

  it('the batch curve keeps falling toward the per-part cost', () => {
    const c = calculateMilledCosts(input(p), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    const prices = c.batchCurve.map((b) => b.unitPrice);
    for (let i = 1; i < prices.length; i++) expect(prices[i]).toBeLessThan(prices[i - 1]);
  });
});

describe('milling uses milling physics, not turning physics', () => {
  it('roughing time scales with the volume hogged out', () => {
    const light = calculateMilledCosts(input(baseProfile), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    const heavy = calculateMilledCosts(
      input({ ...baseProfile, partVolumeCm3: 10, removedVolumeCm3: 38 }), 1, false, 0.25, DEFAULT_SHOP_SETTINGS
    );
    const roughOf = (c: typeof light) => c.lineItems.find((li) => li.key === 'rough')?.value ?? 0;
    // 6 → 38 cm³ is ~6.3× the material, so roughing should scale in step. The
    // TOTAL cycle moves far less: on a small part with a lot of surface, finishing
    // and tool changes dominate — which is itself the realistic behaviour.
    expect(roughOf(heavy) / roughOf(light)).toBeGreaterThan(5);
    expect(heavy.cycleTimeSec).toBeGreaterThan(light.cycleTimeSec);
  });

  it('counts real cutters so tool changes are not trivial', () => {
    const c = calculateMilledCosts(input({ ...baseProfile, setupCount: 3, holeCount: 4 }), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);
    const air = c.lineItems.find((li) => li.key === 'noncut');
    expect(air).toBeDefined();
    expect(air!.value).toBeGreaterThan(0);
  });
});

describe('contouredSetupCount — setup floor for contoured parts', () => {
  const ftc07 = { surfaceAreaCm2: 3914, partVolumeCm3: 1727, stockMm: { x: 352, y: 136, z: 263 } };
  const block = { surfaceAreaCm2: 2834, partVolumeCm3: 3324, stockMm: { x: 305, y: 98, z: 250 } };
  const plate = { surfaceAreaCm2: 966, partVolumeCm3: 136, stockMm: { x: 280, y: 3, z: 190 } };

  it('bumps a sculptured part above its geometric access count (FTC-07: 3 → 5)', () => {
    expect(contouredSetupCount(3, ftc07)).toBe(5);
  });

  it('leaves a prismatic block at its measured count (no spurious re-clamps)', () => {
    expect(contouredSetupCount(5, block)).toBe(5);
  });

  it('does not add setups for a thin plate', () => {
    expect(contouredSetupCount(2, plate)).toBe(2);
  });

  it('caps the sculpt bonus so a healthy access count is not inflated into an empty setup (12630: 5 → 5, not 6)', () => {
    // Small feature-dense part: high surface/volume ratio would otherwise add +1,
    // but the geometry already measured 5 access directions (= the real shop's 5
    // ops), so the 6th would carry only a facing skim. The ceiling holds it at 5.
    const denseSmall = { surfaceAreaCm2: 38, partVolumeCm3: 3.44, stockMm: { x: 33.4, y: 10.1, z: 25.4 } };
    expect(contouredSetupCount(5, denseSmall)).toBe(5);
  });
});

describe('NRE-vs-recurring setup split (first order vs repeat)', () => {
  const p: MilledProfile = { ...baseProfile, setupCount: 3, holeCount: 4 };
  const run = (qty: number) => calculateMilledCosts(input(p), qty, false, 0.25, DEFAULT_SHOP_SETTINGS);

  it('bills a one-time CAM programming NRE as its own line', () => {
    const c = run(1);
    const nre = c.lineItems.find((li) => li.key === 'nre');
    expect(nre).toBeDefined();
    expect(nre!.value).toBeGreaterThan(0);
    expect(c.nreCost).toBeGreaterThan(0);
  });

  it('the repeat price is lower than the first-order price (NRE already paid)', () => {
    const c = run(1);
    const unit = c.subtotal + c.overhead + c.marginAmount;
    expect(c.repeatUnitPrice).toBeLessThan(unit);
  });

  it('the first-order vs repeat gap shrinks as quantity rises', () => {
    const c = run(1);
    const gapAt = (q: number) => {
      const pt = c.batchCurve.find((b) => b.quantity === q)!;
      return pt.unitPrice - pt.repeatUnitPrice;
    };
    expect(gapAt(1)).toBeGreaterThan(gapAt(25));
    expect(gapAt(25)).toBeGreaterThan(gapAt(500));
  });

  it('with programming NRE off and no fixture, first order equals repeat', () => {
    const s = JSON.parse(JSON.stringify(DEFAULT_SHOP_SETTINGS));
    s.cnc.programmingMinPerSetup = 0;
    const flat: MilledProfile = { ...baseProfile, setupCount: 1, bossCount: 0 }; // <3 setups, no boss → no soft jaws
    const c = calculateMilledCosts(input(flat), 10, false, 0.25, s);
    const unit = c.subtotal + c.overhead + c.marginAmount;
    expect(c.repeatUnitPrice).toBeCloseTo(unit, 6);
  });
});

describe('feedrate ratio — client feed override scales cutting time', () => {
  const feedProfile: MilledProfile = { ...baseProfile, removedVolumeCm3: 50, surfaceAreaCm2: 300, holeCount: 4 };
  const runFeed = (pct: number | undefined) => {
    const s = JSON.parse(JSON.stringify(DEFAULT_SHOP_SETTINGS));
    if (pct === undefined) delete s.cnc.feedrateRatioPercent;
    else s.cnc.feedrateRatioPercent = pct;
    return calculateMilledCosts(input(feedProfile), 1, false, 0.25, s);
  };

  it('slower feed (50%) costs more machine time; faster (200%) costs less', () => {
    const slow = runFeed(50);
    const normal = runFeed(100);
    const fast = runFeed(200);
    expect(slow.cycleTimeSec).toBeGreaterThan(normal.cycleTimeSec);
    expect(slow.machineCost).toBeGreaterThan(normal.machineCost);
    expect(fast.machineCost).toBeLessThan(normal.machineCost);
  });

  it('100% is neutral — identical to leaving the ratio unset', () => {
    expect(runFeed(100).machineCost).toBeCloseTo(runFeed(undefined).machineCost, 6);
  });
});

describe('sculptured-surface finishing', () => {
  // Same volume + removed metal; one is a compact block, one is a contoured 3D part
  // (far more surface per unit volume → slow small-ball finishing).
  const vol = 1700;
  const prismatic: MilledProfile = {
    stockMm: { x: 300, y: 150, z: 280 }, stockVolumeCm3: 12600, partVolumeCm3: vol,
    removedVolumeCm3: 10900, surfaceAreaCm2: 900, setupCount: 3,
    pocketCount: 0, bossCount: 0, deepPocketCount: 0, holeCount: 0,
  };
  const sculptured: MilledProfile = { ...prismatic, surfaceAreaCm2: 3900 }; // ~4.5× a same-vol cube
  const thinPlate: MilledProfile = {
    stockMm: { x: 280, y: 3, z: 190 }, stockVolumeCm3: 160, partVolumeCm3: 136,
    removedVolumeCm3: 24, surfaceAreaCm2: 966, setupCount: 1,
    pocketCount: 0, bossCount: 0, deepPocketCount: 0, holeCount: 0,
  };
  const run = (p: MilledProfile) => calculateMilledCosts(input(p), 1, false, 0.25, DEFAULT_SHOP_SETTINGS);

  it('a contoured part finishes far slower than a prismatic one of the same volume', () => {
    const flat = run(prismatic);
    const curved = run(sculptured);
    const finOf = (c: typeof flat) => c.lineItems.find((li) => li.key === 'finish')!.value;
    // High surface/volume → several times more finishing time.
    expect(finOf(curved) / finOf(flat)).toBeGreaterThan(4);
    expect(curved.machineCost).toBeGreaterThan(flat.machineCost);
  });

  it('does NOT slow a thin plate (planar finishing stays fast)', () => {
    const plate = run(thinPlate);
    // Plate has a high surface/volume ratio too, but plateness damps it to ~1×.
    const fin = plate.lineItems.find((li) => li.key === 'finish')!;
    expect(fin.driver).not.toMatch(/contoured/);
  });
});

describe('feature complexity (small-tool detail)', () => {
  it('a feature-dense part costs much more machine time than a plain block', () => {
    // A cutting-dominated part (lots of removed volume + surface), identical except
    // one is plain and the other is packed with bosses, pockets and holes that
    // force small, slow tools.
    const cuttingHeavy = { ...baseProfile, partVolumeCm3: 50, removedVolumeCm3: 150, surfaceAreaCm2: 800 };
    const plain = calculateMilledCosts(
      input({ ...cuttingHeavy, bossCount: 0, pocketCount: 0, deepPocketCount: 0, holeCount: 0 }),
      1, false, 0.25, DEFAULT_SHOP_SETTINGS
    );
    const busy = calculateMilledCosts(
      input({ ...cuttingHeavy, bossCount: 12, pocketCount: 2, deepPocketCount: 2, holeCount: 30 }),
      1, false, 0.25, DEFAULT_SHOP_SETTINGS
    );
    expect(busy.machineCost).toBeGreaterThan(plain.machineCost * 1.8);
  });

  it('surfaces a feature-complexity line item only when there are features', () => {
    const plain = calculateMilledCosts(
      input({ ...baseProfile, bossCount: 0, pocketCount: 0, deepPocketCount: 0, holeCount: 0 }),
      1, false, 0.25, DEFAULT_SHOP_SETTINGS
    );
    const busy = calculateMilledCosts(
      input({ ...baseProfile, bossCount: 8, holeCount: 20 }), 1, false, 0.25, DEFAULT_SHOP_SETTINGS
    );
    expect(plain.lineItems.find((li) => li.key === 'deep')).toBeUndefined();
    expect(busy.lineItems.find((li) => li.key === 'deep')).toBeDefined();
  });

  it('caps the complexity multiplier so it cannot run away', () => {
    // Hold holes fixed (drilling is per-hole, uncapped) and push the multiplier
    // inputs to absurd values — the complexity add is bounded at +300%, so the
    // extra time stays finite instead of exploding.
    const base = { ...baseProfile, partVolumeCm3: 50, removedVolumeCm3: 150, surfaceAreaCm2: 800, holeCount: 10 };
    const capped = calculateMilledCosts(
      input({ ...base, bossCount: 200, pocketCount: 200, deepPocketCount: 50 }), 1, false, 0.25, DEFAULT_SHOP_SETTINGS
    );
    const moderate = calculateMilledCosts(
      input({ ...base, bossCount: 12, pocketCount: 2, deepPocketCount: 2 }), 1, false, 0.25, DEFAULT_SHOP_SETTINGS
    );
    const cxOf = (c: typeof capped) => c.lineItems.find((li) => li.key === 'deep')?.value ?? 0;
    // Moderate is at +238% (uncapped); extreme is clamped to +300% — so the
    // complexity charge rises only modestly, never unbounded.
    expect(cxOf(capped)).toBeGreaterThan(cxOf(moderate));
    expect(cxOf(capped)).toBeLessThan(cxOf(moderate) * 1.6);
  });
});

describe('toBarStockProfile — mill-turn from round bar (points 1 & 2)', () => {
  // A round-ish part that a mill-turn shop runs from bar, but which the prismatic
  // path would otherwise price as a rectangular billet with several setups.
  const billet: MilledProfile = {
    stockMm: { x: 90, y: 45, z: 45 },
    stockVolumeCm3: 182.25,
    partVolumeCm3: 90,
    removedVolumeCm3: 92.25,
    surfaceAreaCm2: 220,
    setupCount: 4,
    pocketCount: 0,
    bossCount: 2,
    deepPocketCount: 0,
    holeCount: 6,
    sparseBillet: false,
  };
  const bar = toBarStockProfile(billet, 45, 2);

  it('re-expresses the stock as round bar with collapsed setups', () => {
    expect(bar.fromBarStock).toBe(true);
    expect(bar.barDiameterMm).toBe(45);
    expect(bar.setupCount).toBe(2);
    expect(bar.setupCount).toBeLessThan(billet.setupCount);
    // Round bar sized to the part holds less than the smallest block that contains it.
    expect(bar.stockVolumeCm3).toBeLessThan(billet.stockVolumeCm3);
    expect(bar.removedVolumeCm3).toBeLessThan(billet.removedVolumeCm3);
    expect(bar.sparseBillet).toBe(false);
  });

  it('the mill-turn route costs less material and fewer setups than the billet route', () => {
    const billetCost = calculateMilledCosts(input(billet), 1, false, 0.25, DEFAULT_SHOP_SETTINGS, 1.1);
    const barCost = calculateMilledCosts(input(bar), 1, false, 0.25, DEFAULT_SHOP_SETTINGS, 1.35);
    expect(barCost.fromBarStock).toBe(true);
    expect(barCost.barDiameterMm).toBe(45);
    expect(barCost.materialCost).toBeLessThan(billetCost.materialCost);
    expect(barCost.setups).toBeLessThan(billetCost.setups);
  });

  it('at the same machine rate, the bar route is cheaper overall (isolates the route benefit)', () => {
    const billetCost = calculateMilledCosts(input(billet), 1, false, 0.25, DEFAULT_SHOP_SETTINGS, 1.1);
    const barSameRate = calculateMilledCosts(input(bar), 1, false, 0.25, DEFAULT_SHOP_SETTINGS, 1.1);
    expect(barSameRate.subtotal).toBeLessThan(billetCost.subtotal);
  });
});
