/**
 * INVOICE DETAIL — view, adjust and issue a single invoice.
 *
 * Lines stay editable while the invoice is a DRAFT (quantities and prices get
 * corrected before it goes out); once sent, the document is locked so the copy
 * the customer holds and the copy here can't drift apart.
 */
import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Send, Download, Trash2, CheckCircle, Ban } from 'lucide-react';
import { useJobs } from '../context/JobContext';
import { useQuotes } from '../context/QuoteContext';
import { useSettings } from '../context/SettingsContext';
import { useMoney } from '../utils/useMoney';
import StatusPill from '../components/common/StatusPill';
import { displayInvoiceStatus } from '../utils/invoiceBuilder';
import { downloadInvoicePdf } from '../utils/invoicePdf';
import { InvoiceStatus } from '../types';
import { cn } from '../utils/cn';

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getInvoiceById, updateInvoice, deleteInvoice, jobs } = useJobs();
  const { getCustomerById } = useQuotes();
  const { settings } = useSettings();
  const { money } = useMoney();

  const invoice = getInvoiceById(id || '');
  const [taxDraft, setTaxDraft] = useState(invoice ? String(invoice.taxRatePercent) : '20');

  if (!invoice) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold">Invoice not found</h2>
        <Link to="/invoices" className="text-primary hover:underline mt-4 inline-block">Back to invoices</Link>
      </div>
    );
  }

  const customer = getCustomerById(invoice.customerId);
  const job = jobs.find((j) => j.id === invoice.jobId);
  const shown = displayInvoiceStatus(invoice);
  const isDraft = invoice.status === 'draft';

  const setStatus = (status: InvoiceStatus) =>
    updateInvoice({
      ...invoice,
      status,
      paidDate: status === 'paid' ? invoice.paidDate ?? new Date().toISOString() : undefined,
    });

  const handleDelete = () => {
    if (confirm(`Delete ${invoice.invoiceNumber}? The job is not affected.`)) {
      deleteInvoice(invoice.id);
      navigate('/invoices');
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-accent rounded-full transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{invoice.invoiceNumber}</h1>
            <StatusPill status={shown} />
          </div>
          <p className="text-sm text-muted-foreground">
            {customer?.name}
            {invoice.poNumber ? ` · PO ${invoice.poNumber}` : ''}
            {job && (
              <>
                {' · '}
                <Link to={`/jobs/${job.id}`} className="text-primary hover:underline">{job.jobNumber}</Link>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 pb-6 border-b border-border">
        {isDraft && (
          <button onClick={() => setStatus('sent')} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-all">
            <Send size={16} /> Mark as sent
          </button>
        )}
        {(invoice.status === 'sent') && (
          <button onClick={() => setStatus('paid')} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 transition-all">
            <CheckCircle size={16} /> Mark as paid
          </button>
        )}
        <button
          onClick={() => downloadInvoicePdf({ invoice, customer, shop: settings, jobNumber: job?.jobNumber })}
          className="flex items-center gap-2 px-4 py-2 border border-border rounded-md text-sm font-medium hover:bg-accent transition-all"
        >
          <Download size={16} /> Download PDF
        </button>
        {invoice.status !== 'paid' && invoice.status !== 'void' && (
          <button onClick={() => setStatus('void')} className="flex items-center gap-2 px-4 py-2 border border-border rounded-md text-sm font-medium hover:bg-accent transition-all">
            <Ban size={16} /> Void
          </button>
        )}
        <div className="flex-1" />
        <button onClick={handleDelete} className="flex items-center gap-2 px-4 py-2 bg-destructive/10 text-destructive border border-destructive/20 rounded-md text-sm font-medium hover:bg-destructive/20 transition-all">
          <Trash2 size={16} /> Delete
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Field label="Issued" value={new Date(invoice.issueDate).toLocaleDateString()} />
        <Field label="Due" value={new Date(invoice.dueDate).toLocaleDateString()} tone={shown === 'overdue' ? 'warn' : undefined} />
        <Field label="Terms" value={invoice.terms || 'Net 30'} />
        <Field label="Paid" value={invoice.paidDate ? new Date(invoice.paidDate).toLocaleDateString() : '—'} />
      </div>

      {/* Lines */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-bold text-foreground">Line items</h2>
            <p className="text-xs text-muted-foreground mt-1">
              {isDraft ? 'Editable while this invoice is a draft.' : 'Locked — the invoice has been issued.'}
            </p>
          </div>
          {!isDraft && <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Locked</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground bg-accent/30">
                <th className="px-4 py-3 font-semibold">Description</th>
                <th className="px-4 py-3 font-semibold text-right">Qty</th>
                <th className="px-4 py-3 font-semibold text-right">Unit</th>
                <th className="px-4 py-3 font-semibold text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-foreground">{l.description}</td>
                  <td className="px-4 py-3 text-right">
                    {isDraft ? (
                      <input
                        type="number"
                        min="0"
                        value={l.quantity}
                        aria-label={`Quantity for ${l.description}`}
                        onChange={(e) =>
                          updateInvoice({
                            ...invoice,
                            lines: invoice.lines.map((x) =>
                              x.id === l.id ? { ...x, quantity: Math.max(0, Number(e.target.value) || 0) } : x
                            ),
                          })
                        }
                        className="w-16 bg-background border border-border rounded px-2 py-1 text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    ) : (
                      <span className="font-mono">{l.quantity}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{money(l.unitPrice)}</td>
                  <td className="px-4 py-3 text-right font-mono">{money(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="p-5 border-t border-border space-y-2">
          <Row label="Subtotal" value={money(invoice.subtotal)} />
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-2">
              VAT / tax @
              {isDraft ? (
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={taxDraft}
                  aria-label="Tax rate percent"
                  onChange={(e) => setTaxDraft(e.target.value)}
                  onBlur={() => {
                    const v = Math.min(100, Math.max(0, Number(taxDraft) || 0));
                    setTaxDraft(String(v));
                    updateInvoice({ ...invoice, taxRatePercent: v });
                  }}
                  className="w-16 bg-background border border-border rounded px-2 py-0.5 text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                />
              ) : (
                <span className="font-mono">{invoice.taxRatePercent}</span>
              )}
              %
            </span>
            <span className="font-mono">{money(invoice.taxAmount)}</span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <span className="font-bold text-foreground">Total due</span>
            <span className="text-xl font-bold text-foreground font-mono">{money(invoice.total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={cn('text-sm font-semibold text-foreground mt-0.5', tone === 'warn' && 'text-amber-600 dark:text-amber-400')}>
        {value}
      </p>
    </div>
  );
}
