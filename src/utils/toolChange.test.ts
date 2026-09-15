import { describe, it, expect } from 'vitest';
import { calculateMachiningCosts } from './cncEstimator';
import { MACHINE_CATALOG, TOOL_CHANGE_SEC } from './machineSelection';
import { DEFAULT_SHOP_SETTINGS } from '../constants';
import type { TurningProfile } from './turning';

const profile: TurningProfile = {
  odMm: 29.3, lengthMm: 70, boreDiaMm: 11.8, boreDepthMm: 14, grooveCount: 4,
  threadCount: 0, faceCount: 2, crossFeatures: false,
};
const price = (machineId?: keyof typeof MACHINE_CATALOG) =>
  calculateMachiningCosts(
    { isTurned: true, materialName: 'Brass CZ121', volumeCm3: 21, profile, setups: 1, materialPricePerKg: 12 },
    1, false, 0.25, DEFAULT_SHOP_SETTINGS, 1, 0,
    machineId ? [{ machine: MACHINE_CATALOG[machineId], setups: 1 }] : undefined);

describe('a tool change is the machine\'s, not one number for the floor', () => {
  // 8 s was a machining-centre ATC figure applied to every machine on the floor.
  // It was defensible while nothing modelled the moves between cuts; once the
  // rapid, the settle and the clearance feed are charged per operation, leaving
  // it at 8 s charged the same seconds twice.
  it('a turret indexes faster than a machining centre changes tools', () => {
    expect(TOOL_CHANGE_SEC['lathe']).toBeLessThan(TOOL_CHANGE_SEC['mill']);
    expect(TOOL_CHANGE_SEC['sliding-head']).toBeLessThan(TOOL_CHANGE_SEC['lathe']);
  });

  it('gang tooling is the quickest, an ATC the slowest — and none is zero', () => {
    const order = ['sliding-head', 'lathe', 'turn-mill', 'mill'] as const;
    for (let i = 1; i < order.length; i++) {
      expect(TOOL_CHANGE_SEC[order[i]]).toBeGreaterThanOrEqual(TOOL_CHANGE_SEC[order[i - 1]]);
    }
    for (const k of order) expect(TOOL_CHANGE_SEC[k]).toBeGreaterThan(0);
  });

  it('the same part cycles faster on a sliding head than on a VMC', () => {
    // Same geometry, same material, same cutting — only the machine's tool
    // change differs, and it is enough to separate them.
    expect(price('star-sr32').cycleTimeSec).toBeLessThan(price('haas-vf2').cycleTimeSec);
  });

  it('choosing a machine at all makes the part quicker than the 8s placeholder', () => {
    const noMachine = price();
    for (const id of ['star-sr32', 'nl-2000', 'haas-vf2'] as const) {
      expect(price(id).cycleTimeSec, id).toBeLessThan(noMachine.cycleTimeSec);
    }
  });

  it('the shop setting still applies when no machine has been chosen', () => {
    const slow = calculateMachiningCosts(
      { isTurned: true, materialName: 'Brass CZ121', volumeCm3: 21, profile, setups: 1, materialPricePerKg: 12 },
      1, false, 0.25,
      { ...DEFAULT_SHOP_SETTINGS, cnc: { ...DEFAULT_SHOP_SETTINGS.cnc!, toolChangeSec: 20 } });
    expect(slow.cycleTimeSec).toBeGreaterThan(price().cycleTimeSec);
  });

  it('the cost line quotes the figure actually used, not the shop default', () => {
    const c = price('star-sr32');
    const row = c.lineItems.find((li) => li.key === 'noncut')!;
    // Matched on the whole figure: "0.8s" contains "8s" as a substring, so a
    // naive toContain passes for the wrong reason.
    expect(row.driver).toMatch(new RegExp(`\u00d7 ${TOOL_CHANGE_SEC['sliding-head']}s\\b`));
    expect(row.driver).not.toMatch(new RegExp(`\u00d7 ${DEFAULT_SHOP_SETTINGS.cnc!.toolChangeSec}s\\b`));
  });
});

describe('a plan row says what it does not include', () => {
  it('each operation names its time at the cut and the change to get there', () => {
    const rows = price('nl-2000').plan!.setups.flatMap((s) => s.operations);
    const drill = rows.find((r) => r.op === 'drill')!;
    expect(drill.driver).toMatch(/at the cut/);
    expect(drill.driver).toMatch(/bring this tool round|same tool as above/);
  });

  it('two operations sharing a tool do not each pay for a change', () => {
    const rows = price('nl-2000').plan!.setups.flatMap((s) => s.operations);
    const shared = rows.filter((r) => /same tool as above/.test(r.driver ?? ''));
    // Facing and rough turning run the same insert in the default inventory.
    expect(shared.length).toBeGreaterThan(0);
  });
});
