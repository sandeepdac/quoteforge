import { describe, it, expect } from 'vitest';
import {
  buildInvoiceFromJob,
  recalcInvoice,
  termsToDays,
  displayInvoiceStatus,
  isOverdue,
} from './invoiceBuilder';
import type { Customer, Job, Quote } from '../types';

const job = {
  id: 'job-1',
  jobNumber: 'JOB-1001',
  quoteId: 'q1',
  customerId: 'c1',
  partId: 'p1',
  poNumber: 'PO-77321',
  status: 'complete',
  quantity: 10,
  createdDate: '2026-01-01T00:00:00.000Z',
  router: [],
  costSnapshot: {
    unitPrice: 53.2,
    grandTotal: 532,
    estFactoryCost: 425.6,
    stockDescription: '⌀45 round bar',
    materialName: 'Aluminium 6082',
  },
} as unknown as Job;

const quote = { machiningCosts: { nreCost: 40 } } as unknown as Quote;
const customer = { terms: 'Net 30' } as Customer;

describe('termsToDays', () => {
  it('reads Net-N terms', () => {
    expect(termsToDays('Net 30')).toBe(30);
    expect(termsToDays('NET 45')).toBe(45);
    expect(termsToDays('net 7')).toBe(7);
  });

  it('treats cash-style terms as due immediately', () => {
    expect(termsToDays('COD')).toBe(0);
    expect(termsToDays('Due on receipt')).toBe(0);
  });

  it('defaults to 30 days when the terms are missing or unreadable', () => {
    expect(termsToDays(undefined)).toBe(30);
    expect(termsToDays('')).toBe(30);
    expect(termsToDays('end of month')).toBe(30);
  });
});

describe('buildInvoiceFromJob', () => {
  const inv = buildInvoiceFromJob({
    job,
    quote,
    customer,
    invoiceNumber: 'INV-1001',
    taxRatePercent: 20,
    currency: 'GBP',
    issueDate: '2026-02-01T00:00:00.000Z',
  });

  it('carries the job, quote, customer and PO references', () => {
    expect(inv.invoiceNumber).toBe('INV-1001');
    expect(inv.jobId).toBe('job-1');
    expect(inv.quoteId).toBe('q1');
    expect(inv.poNumber).toBe('PO-77321');
    expect(inv.status).toBe('draft');
  });

  it('bills one-time NRE separately from the parts', () => {
    const part = inv.lines.find((l) => l.kind === 'part')!;
    const nre = inv.lines.find((l) => l.kind === 'nre')!;
    expect(part.quantity).toBe(10);
    expect(nre.quantity).toBe(1);
    expect(nre.amount).toBeCloseTo(40, 2);
    // Parts carry the total minus the one-time NRE.
    expect(part.amount).toBeCloseTo(492, 2);
  });

  it('totals to the job value, then adds tax on top', () => {
    expect(inv.subtotal).toBeCloseTo(532, 2);
    expect(inv.taxAmount).toBeCloseTo(106.4, 2);
    expect(inv.total).toBeCloseTo(638.4, 2);
  });

  it('sets the due date from the customer payment terms', () => {
    expect(inv.dueDate.slice(0, 10)).toBe('2026-03-03'); // 2026-02-01 + 30 days
    expect(inv.terms).toBe('Net 30');
  });

  it('omits the NRE line when there is none to bill (a reorder)', () => {
    const reorder = buildInvoiceFromJob({
      job,
      quote: { machiningCosts: { nreCost: 0 } } as unknown as Quote,
      customer,
      invoiceNumber: 'INV-1002',
      taxRatePercent: 20,
    });
    expect(reorder.lines.some((l) => l.kind === 'nre')).toBe(false);
    expect(reorder.lines.find((l) => l.kind === 'part')!.amount).toBeCloseTo(532, 2);
  });

  it('handles a zero tax rate', () => {
    const noTax = buildInvoiceFromJob({ job, quote, customer, invoiceNumber: 'INV-1003', taxRatePercent: 0 });
    expect(noTax.taxAmount).toBe(0);
    expect(noTax.total).toBeCloseTo(noTax.subtotal, 2);
  });
});

describe('recalcInvoice', () => {
  it('re-derives amounts, subtotal, tax and total after an edit', () => {
    const inv = buildInvoiceFromJob({ job, quote, customer, invoiceNumber: 'INV-1004', taxRatePercent: 20 });
    const edited = recalcInvoice({
      ...inv,
      taxRatePercent: 0,
      lines: inv.lines.map((l) => (l.kind === 'part' ? { ...l, quantity: 5 } : l)),
    });
    const part = edited.lines.find((l) => l.kind === 'part')!;
    expect(part.amount).toBeCloseTo(part.quantity * part.unitPrice, 2);
    expect(edited.subtotal).toBeCloseTo(part.amount + 40, 2);
    expect(edited.taxAmount).toBe(0);
    expect(edited.total).toBeCloseTo(edited.subtotal, 2);
  });
});

describe('overdue derivation', () => {
  const base = buildInvoiceFromJob({
    job, quote, customer, invoiceNumber: 'INV-1005', taxRatePercent: 20,
    issueDate: '2026-01-01T00:00:00.000Z',
  });
  const later = new Date('2026-06-01T00:00:00.000Z');

  it('a sent invoice past its due date is overdue', () => {
    expect(isOverdue({ ...base, status: 'sent' }, later)).toBe(true);
    expect(displayInvoiceStatus({ ...base, status: 'sent' }, later)).toBe('overdue');
  });

  it('drafts, paid and void invoices are never overdue', () => {
    for (const s of ['draft', 'paid', 'void'] as const) {
      expect(isOverdue({ ...base, status: s }, later)).toBe(false);
      expect(displayInvoiceStatus({ ...base, status: s }, later)).toBe(s);
    }
  });

  it('a sent invoice inside its terms is not overdue', () => {
    expect(isOverdue({ ...base, status: 'sent' }, new Date('2026-01-15T00:00:00.000Z'))).toBe(false);
  });
});
