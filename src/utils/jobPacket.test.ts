import { describe, it, expect } from 'vitest';
import { buildJobPacket, jobPacketToCsv, mapWorkCentre } from './jobPacket';
import { buildJobRouter } from './jobRouter';
import type { Customer, Job, MachiningCosts, Part, Quote } from '../types';

const mc = {
  machineClass: 'mill',
  setups: 2,
  setupTimeMin: 90,
  cycleTimeSec: 600,
  plan: {
    setups: [
      { index: 1, name: 'Setup 1', orientation: 'Main spindle', seconds: 360, cost: 12, toolChanges: 3,
        operations: [{ name: 'Turn OD', tool: 'CNMG 120408', seconds: 360, cost: 12, driver: 'profile', color: '#000' }] },
      { index: 2, name: 'Setup 2', orientation: 'Sub spindle', seconds: 240, cost: 8, toolChanges: 2,
        operations: [{ name: 'Drill', tool: '6 mm drill', seconds: 240, cost: 8, driver: '6 holes', color: '#000' }] },
    ],
    tools: [], totalSeconds: 600, totalCost: 20,
  },
} as unknown as MachiningCosts;

const router = buildJobRouter({
  machiningCosts: mc,
  machineName: 'Multi-Axis Turn-Mill Centre',
  stockDescription: '⌀45 round bar',
  materialName: 'Aluminium 6082',
  quantity: 10,
});

const job = {
  id: 'job-1',
  jobNumber: 'JOB-1001',
  quoteId: 'q1',
  customerId: 'c1',
  partId: 'p1',
  poNumber: 'PO-77321',
  status: 'in-progress',
  quantity: 10,
  createdDate: '2026-01-01T00:00:00.000Z',
  dueDate: '2026-02-01T00:00:00.000Z',
  router: router.map((o, i) => (i === 1 ? { ...o, actualMin: 120, status: 'done' as const } : o)),
  costSnapshot: {
    unitPrice: 53.2, grandTotal: 532, estFactoryCost: 425.6,
    stockDescription: '⌀45 round bar', materialName: 'Aluminium 6082',
  },
} as unknown as Job;

const customer = { name: 'Lance Engineering', contactName: 'Lance', email: 'l@e.com', terms: 'Net 30' } as Customer;
const part = { name: 'Spindle Housing' } as Part;
const quote = { quoteNumber: 'Q-2026-1001' } as Quote;

describe('mapWorkCentre', () => {
  const mappings = [{ from: 'Multi-Axis Turn-Mill Centre', to: 'TM01' }];

  it('maps a known work centre to the MRP code', () => {
    expect(mapWorkCentre('Multi-Axis Turn-Mill Centre', mappings)).toBe('TM01');
  });

  it('matches case-insensitively and ignores surrounding space', () => {
    expect(mapWorkCentre('  multi-axis turn-mill centre ', mappings)).toBe('TM01');
  });

  it('passes an unmapped centre through unchanged', () => {
    expect(mapWorkCentre('Inspection', mappings)).toBe('Inspection');
    expect(mapWorkCentre('Inspection', undefined)).toBe('Inspection');
  });

  it('ignores a mapping with an empty code', () => {
    expect(mapWorkCentre('Inspection', [{ from: 'Inspection', to: '  ' }])).toBe('Inspection');
  });
});

describe('buildJobPacket', () => {
  const packet = buildJobPacket({
    job, customer, part, quote,
    mappings: [{ from: 'Multi-Axis Turn-Mill Centre', to: 'TM01' }],
    shopName: 'Lance CNC', currency: 'GBP',
  });

  it('carries the job header, customer, part and costs', () => {
    expect(packet.packetVersion).toBe(1);
    expect(packet.job.jobNumber).toBe('JOB-1001');
    expect(packet.job.poNumber).toBe('PO-77321');
    expect(packet.customer.name).toBe('Lance Engineering');
    expect(packet.part.name).toBe('Spindle Housing');
    expect(packet.part.stock).toBe('⌀45 round bar');
    expect(packet.costs.quoteNumber).toBe('Q-2026-1001');
    expect(packet.costs.currency).toBe('GBP');
  });

  it('exports every router operation, with the MRP code applied', () => {
    expect(packet.router).toHaveLength(job.router.length);
    const machining = packet.router.filter((o) => o.kind === 'machining');
    expect(machining.every((o) => o.workCentreCode === 'TM01')).toBe(true);
    // The original name is kept alongside the code, so the export is readable.
    expect(machining[0].workCentre).toBe('Multi-Axis Turn-Mill Centre');
    // An unmapped centre falls back to its own name.
    expect(packet.router.find((o) => o.kind === 'shipping')!.workCentreCode).toBe('Despatch');
  });

  it('computes planned minutes as setup once + run per part x qty', () => {
    const op = packet.router.find((o) => o.kind === 'machining')!;
    expect(op.totalPlannedMin).toBeCloseTo(op.setupMin + op.runMinPerPart * 10, 1);
    expect(packet.totals.plannedTotalMin).toBeCloseTo(
      packet.totals.plannedSetupMin + packet.totals.plannedRunMin,
      1
    );
  });

  it('carries logged actuals through to the totals', () => {
    expect(packet.totals.actualMin).toBeCloseTo(120, 1);
    expect(packet.router.find((o) => o.actualMin != null)!.actualMin).toBe(120);
  });

  it('leaves actual totals undefined when nothing has been logged', () => {
    const fresh = buildJobPacket({ job: { ...job, router }, customer, part });
    expect(fresh.totals.actualMin).toBeUndefined();
  });
});

describe('jobPacketToCsv', () => {
  const packet = buildJobPacket({
    job, customer, part, quote,
    mappings: [{ from: 'Multi-Axis Turn-Mill Centre', to: 'TM01' }],
  });
  const csv = jobPacketToCsv(packet);
  const lines = csv.split('\r\n');

  it('writes a header plus one row per operation', () => {
    expect(lines).toHaveLength(packet.router.length + 1);
    expect(lines[0]).toMatch(/^job_number,po_number,customer/);
  });

  it('repeats the job header on every row so rows stand alone', () => {
    for (const line of lines.slice(1)) {
      expect(line.startsWith('JOB-1001,PO-77321,Lance Engineering')).toBe(true);
    }
  });

  it('uses CRLF line endings for spreadsheet importers', () => {
    expect(csv.includes('\r\n')).toBe(true);
  });

  it('quotes fields containing commas and escapes embedded quotes', () => {
    const tricky = buildJobPacket({
      job: {
        ...job,
        router: [{ ...job.router[0], name: 'Face, then rough', notes: 'Use the "big" cutter' }],
      } as unknown as Job,
      customer, part,
    });
    const out = jobPacketToCsv(tricky);
    expect(out).toContain('"Face, then rough"');
    expect(out).toContain('"Use the ""big"" cutter"');
  });
});
