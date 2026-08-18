/**
 * JOBS — the shop's work orders, created from won quotes.
 *
 * This is the MRP view of the business: what's on the floor, what it's worth,
 * and how far along it is. Quoting answers "what should this cost?"; this
 * answers "what are we actually building, and is it on time?".
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Search, AlertTriangle } from 'lucide-react';
import { useJobs } from '../context/JobContext';
import { useQuotes } from '../context/QuoteContext';
import { useMoney } from '../utils/useMoney';
import StatusPill from '../components/common/StatusPill';
import { JobStatus } from '../types';
import { jobProgress, plannedJobMinutes } from '../utils/jobRouter';
import { cn } from '../utils/cn';

/** Statuses that still represent work in the shop (not finished or killed). */
const OPEN: JobStatus[] = ['planned', 'released', 'in-progress', 'on-hold'];

export default function JobsListPage() {
  const { jobs } = useJobs();
  const { customers, parts } = useQuotes();
  const { money } = useMoney();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all' | 'open'>('open');

  const nameOf = (id: string, list: Array<{ id: string; name: string }>) =>
    list.find((x) => x.id === id)?.name ?? '—';

  const filtered = jobs.filter((j) => {
    const customer = nameOf(j.customerId, customers);
    const part = nameOf(j.partId, parts);
    const term = search.trim().toLowerCase();
    const matchesSearch =
      !term ||
      j.jobNumber.toLowerCase().includes(term) ||
      customer.toLowerCase().includes(term) ||
      part.toLowerCase().includes(term) ||
      (j.poNumber ?? '').toLowerCase().includes(term);
    const matchesStatus =
      statusFilter === 'all' ? true : statusFilter === 'open' ? OPEN.includes(j.status) : j.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const openJobs = jobs.filter((j) => OPEN.includes(j.status));
  const wipValue = openJobs.reduce((s, j) => s + j.costSnapshot.grandTotal, 0);
  const openHours = openJobs.reduce((s, j) => s + plannedJobMinutes(j.router, j.quantity) / 60, 0);
  const today = new Date();
  const lateCount = openJobs.filter((j) => j.dueDate && new Date(j.dueDate) < today).length;

  const filters: Array<{ id: JobStatus | 'all' | 'open'; label: string }> = [
    { id: 'open', label: 'Open' },
    { id: 'all', label: 'All' },
    { id: 'planned', label: 'Planned' },
    { id: 'released', label: 'Released' },
    { id: 'in-progress', label: 'In progress' },
    { id: 'complete', label: 'Complete' },
    { id: 'shipped', label: 'Shipped' },
    { id: 'on-hold', label: 'On hold' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Jobs</h1>
        <p className="text-muted-foreground">Work orders on the shop floor, created from won quotes.</p>
      </div>

      {/* WIP summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Open jobs</p>
          <p className="text-2xl font-bold text-foreground mt-1">{openJobs.length}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">WIP value</p>
          <p className="text-2xl font-bold text-foreground mt-1">{money(wipValue)}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{openHours.toFixed(1)} planned hours</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Past due</p>
          <p className={cn('text-2xl font-bold mt-1', lateCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground')}>
            {lateCount}
          </p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-sm">
        <div className="p-4 border-b border-border space-y-4">
          <div className="flex flex-wrap gap-2">
            {filters.map((f) => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-medium transition-colors border',
                  statusFilter === f.id
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
              placeholder="Search job number, customer, part or PO…"
              className="w-full bg-background border border-border rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <ClipboardList size={40} className="mx-auto text-muted-foreground/40" />
            <p className="mt-3 font-semibold text-foreground">
              {jobs.length === 0 ? 'No jobs yet' : 'No jobs match this filter'}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {jobs.length === 0 ? (
                <>Mark a quote as <strong className="text-foreground">won</strong>, then convert it to a job.</>
              ) : (
                'Try a different status or search term.'
              )}
            </p>
            {jobs.length === 0 && (
              <Link to="/quotes" className="text-primary hover:underline text-sm mt-3 inline-block">
                Go to quotes
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Job</th>
                  <th className="px-4 py-3 font-semibold">Customer / Part</th>
                  <th className="px-4 py-3 font-semibold text-right">Qty</th>
                  <th className="px-4 py-3 font-semibold">Progress</th>
                  <th className="px-4 py-3 font-semibold">Due</th>
                  <th className="px-4 py-3 font-semibold text-right">Value</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((j) => {
                  const pct = Math.round(jobProgress(j.router) * 100);
                  const late = j.dueDate && new Date(j.dueDate) < today && OPEN.includes(j.status);
                  return (
                    <tr key={j.id} className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors">
                      <td className="px-4 py-3">
                        <Link to={`/jobs/${j.id}`} className="font-semibold text-primary hover:underline">
                          {j.jobNumber}
                        </Link>
                        {j.poNumber && <p className="text-[11px] text-muted-foreground">PO {j.poNumber}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{nameOf(j.customerId, customers)}</p>
                        <p className="text-[11px] text-muted-foreground">{nameOf(j.partId, parts)}</p>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{j.quantity}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[11px] text-muted-foreground tabular-nums">{pct}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('text-xs', late && 'text-amber-600 dark:text-amber-400 font-semibold')}>
                          {j.dueDate ? new Date(j.dueDate).toLocaleDateString() : '—'}
                        </span>
                        {late && <AlertTriangle size={12} className="inline ml-1 text-amber-600 dark:text-amber-400" />}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{money(j.costSnapshot.grandTotal)}</td>
                      <td className="px-4 py-3"><StatusPill status={j.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
