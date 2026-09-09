import { describe, expect, it } from 'vitest';
import { DEFAULT_CNC_SETTINGS, DEFAULT_SHOP_SETTINGS, DEFAULT_TURNING_TOOLS } from '../constants';
import { countToolSelections, resolveTurningTool, seedTurningInventory } from './turningTools';
import { calculateMachiningCosts, type MachiningInput } from './cncEstimator';
import { generateTurningToolpath } from './toolpath';
import { materialPropsFor } from './materials';
import type { ShopTool } from '../types';

const input: MachiningInput = { isTurned: true, materialName: 'Brass CZ121', volumeCm3: 8, setups: 1,
  materialPricePerKg: 9, profile: { odMm: 20, lengthMm: 40, boreDiaMm: 8, boreDepthMm: 30,
    faceCount: 1, grooveCount: 0, threadCount: 0, crossFeatures: false } };
const settings = { ...DEFAULT_SHOP_SETTINGS, cnc: { ...DEFAULT_CNC_SETTINGS, machineRatePerMin: 1, efficiencyFactor: 1, toolChangeSec: 8 } };

describe('turning assembly identity and migration', () => {
  it('converts shared legacy rows to one unconfirmed assembly without mutating them', () => {
    const before = JSON.stringify(DEFAULT_TURNING_TOOLS);
    const seeded = seedTurningInventory(DEFAULT_TURNING_TOOLS);
    expect(seeded.assemblies).toHaveLength(5);
    expect(seeded.assignments[0].assemblyId).toBe(seeded.assignments[1].assemblyId);
    expect(seeded.assemblies.every(a => a.inventoryConfirmed === false)).toBe(true);
    expect(JSON.stringify(DEFAULT_TURNING_TOOLS)).toBe(before);
  });
  it('preserves an explicitly empty inventory', () => {
    expect(seedTurningInventory(DEFAULT_TURNING_TOOLS, []).assemblies).toEqual([]);
  });
  it('counts A A B A as two assemblies but three selections', () => {
    const a = resolveTurningTool('face', DEFAULT_TURNING_TOOLS);
    const b = resolveTurningTool('drill', DEFAULT_TURNING_TOOLS);
    expect(countToolSelections([a, a, b, a])).toEqual({ distinctTools: 2, selections: 3 });
    expect(countToolSelections([])).toEqual({ distinctTools: 0, selections: 0 });
  });
  it('does not merge identical descriptions at different stations', () => {
    const tools: ShopTool[] = [{ op: 'face', station: 'T0101', description: 'Tool' }, { op: 'rough', station: 'T0202', description: 'Tool' }];
    expect(countToolSelections(tools.map(t => resolveTurningTool(t.op, tools))).distinctTools).toBe(2);
  });
  it('normalises legacy stations and flags conflicting descriptions', () => {
    const tools: ShopTool[] = [{ op: 'face', station: ' t0101 ', description: 'A' }, { op: 'rough', station: 'T0101', description: 'B' }];
    const resolved = tools.map(t => resolveTurningTool(t.op, tools));
    expect(resolved.every(a => a.warning?.includes('conflicting'))).toBe(true);
    expect(countToolSelections(resolved).distinctTools).toBe(2);
  });
  it('does not fall back to stale row details for broken assembly references', () => {
    const a = resolveTurningTool('face', [{ ...DEFAULT_TURNING_TOOLS[0], assemblyId: 'deleted' }], []);
    expect(a.label).toContain('Unassigned');
    expect(a.station).toBe('');
  });
});

describe('tool library drives turning costing and the plan', () => {
  it('a separate rougher adds one selection and one tool setup, not cutting time', () => {
    const shared = calculateMachiningCosts(input, 1, false, .25, settings);
    const separate = calculateMachiningCosts(input, 1, false, .25, { ...settings, cnc: { ...settings.cnc,
      toolLibrary: DEFAULT_TURNING_TOOLS.map(t => t.op === 'rough' ? { ...t, station: 'T0909' } : t) } });
    expect(shared.plan!.tools).toHaveLength(5);
    expect(separate.plan!.tools).toHaveLength(6);
    expect(separate.machineCost - shared.machineCost).toBeCloseTo(8 / 60, 8);
    expect(separate.setupTimeMin - shared.setupTimeMin).toBeCloseTo(settings.cnc.setupTimePerToolMin);
    expect(separate.plan!.setups[0].operations.map(o => o.seconds)).toEqual(shared.plan!.setups[0].operations.map(o => o.seconds));
  });
  it.each([1, .8])('reconciles all machine seconds and costs at efficiency %s', efficiencyFactor => {
    const c = calculateMachiningCosts(input, 15, false, .25, { ...settings, cnc: { ...settings.cnc, efficiencyFactor, feedrateRatioPercent: 60 } });
    expect(c.plan!.totalCost).toBeCloseTo(c.machineCost, 8);
    expect(Math.round(c.plan!.totalSeconds)).toBe(c.cycleTimeSec);
    const noncut = c.lineItems.filter(l => ['noncut', 'rapids', 'loading'].includes(l.key));
    expect(noncut).toHaveLength(3);
    const cutting = c.plan!.setups.flatMap(s => s.operations).reduce((sum, o) => sum + o.seconds, 0);
    expect(cutting + noncut.reduce((sum, l) => sum + l.seconds!, 0)).toBeCloseTo(c.plan!.totalSeconds, 8);
    expect(c.lineItems.reduce((sum, l) => sum + l.value, 0)).toBeCloseTo(c.subtotal, 8);
    expect(noncut.find(l => l.key === 'loading')!.seconds).toBe(settings.cnc.barLoadSec);
  });
  it('uses the same assembly as the reference preview, ignoring stale labels on assignments', () => {
    const inventory = seedTurningInventory(DEFAULT_TURNING_TOOLS);
    inventory.assemblies[0] = { ...inventory.assemblies[0], station: 'T0909', description: 'Shop assembly', inventoryConfirmed: true };
    const cnc = { ...settings.cnc, toolLibrary: inventory.assignments, turningToolAssemblies: inventory.assemblies };
    const c = calculateMachiningCosts(input, 1, false, .25, { ...settings, cnc });
    const path = generateTurningToolpath(input.profile, 25, materialPropsFor(input.materialName), undefined, inventory.assignments, inventory.assemblies);
    expect(c.plan!.setups[0].operations[0].tool).toBe('T0909 — Shop assembly');
    expect(path.passes[0].station).toBe('T0909');
    expect(path.passes[0].tool).toBe('Shop assembly');
    expect(c.plan!.toolingWarnings!.some(w => w.includes('T0909'))).toBe(false);
  });
  it('shows explicit unassigned tools without silently restoring default inventory', () => {
    const c = calculateMachiningCosts(input, 1, false, .25, { ...settings, cnc: { ...settings.cnc, toolLibrary: [] } });
    expect(c.plan!.setups[0].operations.every(o => o.tool.startsWith('Unassigned'))).toBe(true);
    expect(c.plan!.toolingWarnings).toHaveLength(6);
  });
  it('keeps zero selection and loading allowances at zero', () => {
    const c = calculateMachiningCosts(input, 1, false, .25, { ...settings, cnc: { ...settings.cnc, toolChangeSec: 0, barLoadSec: 0 } });
    expect(c.lineItems.some(l => l.key === 'noncut' || l.key === 'loading')).toBe(false);
    expect(c.plan!.totalCost).toBeCloseTo(c.machineCost, 8);
  });
});
