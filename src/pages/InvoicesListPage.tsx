/**
 * INVOICES — the accounts end of the quote → job → invoice loop.
 *
 * Overdue is DERIVED (sent, unpaid, past its due date) rather than stored, so a
 * list left open overnight can't show a stale "sent" for something now late.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Receipt, Search, AlertTriangle } from 'lucide-react';
import { useJobs } from '../context/JobContext';
import { useQuotes } from '../context/QuoteContext';
import { useMoney } from '../utils/useMoney';
import StatusPill from '../components/common/StatusPill';
import { InvoiceStatus } from '../types';
import { displayInvoiceStatus } from '../utils/invoiceBuilder';
import { cn } from '../utils/cn';

export default function InvoicesListPage() {
  const { invoices, jobs } = useJobs();
  const { customers } = useQuotes();
  const { money } = useMoney();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<InvoiceStatus | 'all' | 'outstanding'>('outstanding');

  const now = new Date();
  const customerName = (id: string) => customers.find((c) => c.id === id)?.name ?? '—';
  const jobNumber = (id: string) => jobs.find((j) => j.id === id)?.jobNumber ?? '—';

  const rows = invoices.map((i) => ({ inv: i, shown: displayInvoiceStatus(i, now) }));
  const filtered = rows.filter(({ inv, shown }) => {
    const term = search.trim().toLowerCase();
    const matchesSearch =
      !term ||
      inv.invoiceNumber.toLowerCase().includes(term) ||
      customerName(inv.customerId).toLowerCase().includes(term) ||
      (inv.poNumber ?? '').toLowerCase().includes(term);
    const matchesStatus =
      filter === 'all'
        ? true
        : filter === 'outstanding'
          ? shown === 'draft' || shown === 'sent' || shown === 'overdue'
          : shown === filter;
    return matchesSearch && matchesStatus;
  });

  const outstanding = rows.filter(({ shown }) => shown === 'sent' || shown === 'overdue');
  const outstandingValue = outstanding.reduce((s, { inv }) => s + inv.total, 0);
  const overdueRows = rows.filter(({ shown }) => shown === 'overdue');
  const paidValue = rows.filter(({ shown }) => shown === 'paid').reduce((s, { inv }) => s + inv.total, 0);

  const filters: Array<{ id: InvoiceStatus | 'all' | 'outstanding'; label: string }> = [
    { id: 'outstanding', label: 'Outstanding' },
    { id: 'all', label: 'All' },
    { id: 'draft', label: 'Draft' },
    { id: 'sent', label: 'Sent' },
    { id: 'overdue', label: 'Overdue' },
    { id: 'paid', label: 'Paid' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Invoices</h1>
        <p className="text-muted-foreground">Raised from completed jobs.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Outstanding</p>
          <p className="text-2xl font-bold text-foreground mt-1">{money(outstandingValue)}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{outstanding.length} invoice(s)</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Overdue</p>
          <p className={cn('text-2xl font-bold mt-1', overdueRows.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground')}>
            {overdueRows.length}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {money(overdueRows.reduce((s, { inv }) => s + inv.total, 0))}
          </p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Paid</p>
          <p className="text-2xl font-bold text-foreground mt-1">{money(paidValue)}</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-sm">
        <div className="p-4 border-b border-border space-y-4">
          <div className="flex flex-wrap gap-2">
            {filters.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-medium transition-colors border',
                  filter === f.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:bg-accent'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search invoice number, customer or PO…"
              className="w-full bg-background border border-border rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Receipt size={40} className="mx-auto text-muted-foreground/40" />
            <p className="mt-3 font-semibold text-foreground">
              {invoices.length === 0 ? 'No invoices yet' : 'No invoices match this filter'}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {invoices.length === 0 ? 'Complete a job, then raise its invoice.' : 'Try a different status or search term.'}
            </p>
            {invoices.length === 0 && (
              <Link to="/jobs" className="text-primary hover:underline text-sm mt-3 inline-block">Go to jobs</Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Invoice</th>
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="px-4 py-3 font-semibold">Job</th>
                  <th className="px-4 py-3 font-semibold">Issued</th>
                  <th className="px-4 py-3 font-semibold">Due</th>
                  <th className="px-4 py-3 font-semibold text-right">Total</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ inv, shown }) => (
                  <tr key={inv.id} className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors">
                    <td className="px-4 py-3">
                      <Link to={`/invoices/${inv.id}`} className="font-semibold text-primary hover:underline">
                        {inv.invoiceNumber}
                      </Link>
                      {inv.poNumber && <p className="text-[11px] text-muted-foreground">PO {inv.poNumber}</p>}
                    </td>
                    <td className="px-4 py-3 text-foreground">{customerName(inv.customerId)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{jobNumber(inv.jobId)}</td>
                    <td className="px-4 py-3 text-xs">{new Date(inv.issueDate).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <span className={cn('text-xs', shown === 'overdue' && 'text-amber-600 dark:text-amber-400 font-semibold')}>
                        {new Date(inv.dueDate).toLocaleDateString()}
                      </span>
                      {shown === 'overdue' && <AlertTriangle size={12} className="inline ml-1 text-amber-600 dark:text-amber-400" />}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{money(inv.total)}</td>
                    <td className="px-4 py-3"><StatusPill status={shown} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
