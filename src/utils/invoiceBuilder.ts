/**
 * INVOICE BUILDER — turning a finished job into a billable document.
 *
 * The invoice is built from the JOB (not the live quote), because the job holds
 * the frozen snapshot of what was actually sold. Lines are split the way a shop
 * bills them: the parts themselves at the quoted unit price, then the one-time
 * NRE (CAM programming + fixturing) as its own line, because a customer expects
 * to see tooling/setup charged once and not smeared into the part price — and on
 * a reorder that line simply won't be there.
 *
 * Tax is a shop-level rate (VAT / sales tax) applied to the whole net total, and
 * the due date comes from the customer's payment terms.
 */
import { Customer, Invoice, InvoiceLine, Job, Quote } from '../types';
import { generateId } from './idGenerator';

const r2 = (v: number) => Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;

/**
 * Days of credit implied by a terms string, e.g. "Net 30" → 30.
 * Falls back to 30 when the text isn't a recognisable Net-N (the common default),
 * and to 0 for cash-on-delivery style terms.
 */
export function termsToDays(terms?: string): number {
  const t = (terms ?? '').trim().toLowerCase();
  if (!t) return 30;
  if (/(^|\b)(cod|cash on delivery|due on receipt|immediate|prepaid)\b/.test(t)) return 0;
  const m = /(\d+)/.exec(t);
  return m ? Math.max(0, parseInt(m[1], 10)) : 30;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + Math.max(0, Math.round(days || 0)));
  return d.toISOString();
}

export interface BuildInvoiceInput {
  job: Job;
  /** The quote behind the job — supplies the NRE split and rush premium. */
  quote?: Quote;
  customer?: Customer;
  /** Next number in the series, e.g. 'INV-1001'. */
  invoiceNumber: string;
  /** VAT / sales-tax rate as a percentage (e.g. 20). */
  taxRatePercent: number;
  currency?: string;
  issueDate?: string;
}

/** Build (but don't persist) the invoice for a job. */
export function buildInvoiceFromJob(input: BuildInvoiceInput): Invoice {
  const { job, quote, customer } = input;
  const qty = Math.max(1, Math.round(job.quantity || 1));
  const issueDate = input.issueDate ?? new Date().toISOString();
  const mc = quote?.machiningCosts;

  const lines: InvoiceLine[] = [];
  const push = (description: string, quantity: number, unitPrice: number, kind: InvoiceLine['kind']) => {
    const amount = r2(quantity * unitPrice);
    if (Math.abs(amount) < 0.005) return;
    lines.push({ id: generateId('inv-'), description, quantity, unitPrice: r2(unitPrice), amount, kind });
  };

  // --- Parts ---------------------------------------------------------------
  // One-time NRE is billed as its own line, so the per-part price on the invoice
  // is the recurring price the customer will see again on a reorder.
  const nreTotal = r2(mc?.nreCost ?? 0);
  const partsTotal = r2(job.costSnapshot.grandTotal - nreTotal);
  const perPart = partsTotal / qty;
  push(
    job.costSnapshot.stockDescription
      ? `Machined part — ${job.costSnapshot.stockDescription}`
      : 'Machined part',
    qty,
    perPart,
    'part'
  );

  // --- One-time job costs --------------------------------------------------
  if (nreTotal > 0) {
    push('CAM programming & fixturing (one-time)', 1, nreTotal, 'nre');
  }

  const subtotal = r2(lines.reduce((s, l) => s + l.amount, 0));
  const taxRatePercent = Math.max(0, input.taxRatePercent || 0);
  const taxAmount = r2(subtotal * (taxRatePercent / 100));

  return {
    id: generateId('invoice-'),
    invoiceNumber: input.invoiceNumber,
    jobId: job.id,
    quoteId: job.quoteId,
    customerId: job.customerId,
    poNumber: job.poNumber,
    status: 'draft',
    issueDate,
    dueDate: addDays(issueDate, termsToDays(customer?.terms)),
    lines,
    subtotal,
    taxRatePercent,
    taxAmount,
    total: r2(subtotal + taxAmount),
    currency: input.currency,
    terms: customer?.terms,
    notes: job.notes,
  };
}

/** Recompute the money fields after lines or the tax rate are edited. */
export function recalcInvoice(invoice: Invoice): Invoice {
  const lines = invoice.lines.map((l) => ({ ...l, amount: r2(l.quantity * l.unitPrice) }));
  const subtotal = r2(lines.reduce((s, l) => s + l.amount, 0));
  const taxAmount = r2(subtotal * (Math.max(0, invoice.taxRatePercent || 0) / 100));
  return { ...invoice, lines, subtotal, taxAmount, total: r2(subtotal + taxAmount) };
}

/**
 * An invoice is overdue when it has been sent, isn't paid, and its due date has
 * passed. Derived rather than stored so it can never go stale on the shelf.
 */
export function isOverdue(invoice: Invoice, now = new Date()): boolean {
  return invoice.status === 'sent' && new Date(invoice.dueDate) < now;
}

/** The status to display, upgrading a sent-but-late invoice to 'overdue'. */
export function displayInvoiceStatus(invoice: Invoice, now = new Date()): Invoice['status'] {
  return isOverdue(invoice, now) ? 'overdue' : invoice.status;
}
