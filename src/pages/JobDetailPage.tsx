/**
 * JOB DETAIL — the work order / traveller.
 *
 * This is the shop-floor view of a job: the ordered operations, what each was
 * PLANNED to take (straight from the quote that priced it), and what it ACTUALLY
 * took. That planned-vs-actual pairing is the whole point — it's what tells the
 * shop whether the estimate held up, and it's the data the self-calibrating
 * estimator learns from.
 */
import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Play,
  CheckCircle2,
  Package,
  Cpu,
  Beaker,
  Search as SearchIcon,
  Truck,
  Trash2,
  Clock,
} from 'lucide-react';
import { useJobs } from '../context/JobContext';
import { useQuotes } from '../context/QuoteContext';
import { useMoney } from '../utils/useMoney';
import StatusPill from '../components/common/StatusPill';
import { cn } from '../utils/cn';
import { JobOperation, JobStatus, WorkCentreKind } from '../types';
import { actualJobMinutes, jobProgress, plannedJobMinutes } from '../utils/jobRouter';

const KIND_ICON: Record<WorkCentreKind, React.ElementType> = {
  material: Package,
  machining: Cpu,
  secondary: Beaker,
  inspection: SearchIcon,
  shipping: Truck,
};

export default function JobDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getJobById, updateJob, updateJobOperation, deleteJob } = useJobs();
  const { getCustomerById, getPartById, getQuoteById } = useQuotes();
  const { money } = useMoney();

  const job = getJobById(id || '');
  if (!job) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold">Job not found</h2>
        <Link to="/jobs" className="text-primary hover:underline mt-4 inline-block">Back to jobs</Link>
      </div>
    );
  }

  const customer = getCustomerById(job.customerId);
  const part = getPartById(job.partId);
  const quote = getQuoteById(job.quoteId);

  const plannedMin = plannedJobMinutes(job.router, job.quantity);
  const actualMin = actualJobMinutes(job.router);
  const pct = Math.round(jobProgress(job.router) * 100);
  const loggedOps = job.router.filter((o) => o.actualMin != null);
  const anyActuals = loggedOps.length > 0;
  // Compare like with like: variance is only meaningful against the PLANNED time
  // of the operations that have actually been logged. Measuring a part-logged job
  // against the whole plan would always read wildly under-run.
  const plannedForLogged = plannedJobMinutes(loggedOps, job.quantity);
  const timeVariancePct =
    anyActuals && plannedForLogged > 0 ? ((actualMin - plannedForLogged) / plannedForLogged) * 100 : null;
  const allLogged = anyActuals && loggedOps.length === job.router.length;

  const setStatus = (status: JobStatus) => {
    const patch: Partial<typeof job> = { status };
    if (status === 'released' && !job.releasedDate) patch.releasedDate = new Date().toISOString();
    updateJob({ ...job, ...patch });
  };

  const handleDelete = () => {
    if (confirm(`Delete ${job.jobNumber}? This does not affect the quote.`)) {
      deleteJob(job.id);
      navigate('/jobs');
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
            <h1 className="text-2xl font-bold">{job.jobNumber}</h1>
            <StatusPill status={job.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {customer?.name} · {part?.name} · qty {job.quantity}
            {job.poNumber ? ` · PO ${job.poNumber}` : ''}
            {quote && (
              <>
                {' · from '}
                <Link to={`/quotes/${quote.id}`} className="text-primary hover:underline">{quote.quoteNumber}</Link>
              </>
            )}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3 pb-6 border-b border-border">
        {job.status === 'planned' && (
          <button onClick={() => setStatus('released')} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-all">
            <Play size={16} /> Release to floor
          </button>
        )}
        {job.status === 'complete' && (
          <button onClick={() => setStatus('shipped')} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 transition-all">
            <Truck size={16} /> Mark shipped
          </button>
        )}
        {(job.status === 'released' || job.status === 'in-progress') && (
          <button onClick={() => setStatus('on-hold')} className="flex items-center gap-2 px-4 py-2 border border-border rounded-md text-sm font-medium hover:bg-accent transition-all">
            Put on hold
          </button>
        )}
        {job.status === 'on-hold' && (
          <button onClick={() => setStatus('released')} className="flex items-center gap-2 px-4 py-2 border border-border rounded-md text-sm font-medium hover:bg-accent transition-all">
            <Play size={16} /> Resume
          </button>
        )}
        <div className="flex-1" />
        <button onClick={handleDelete} className="flex items-center gap-2 px-4 py-2 bg-destructive/10 text-destructive border border-destructive/20 rounded-md text-sm font-medium hover:bg-destructive/20 transition-all">
          <Trash2 size={16} /> Delete
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Progress" value={`${pct}%`} sub={`${job.router.filter((o) => o.status === 'done').length} of ${job.router.length} ops`} />
        <Stat label="Planned time" value={`${(plannedMin / 60).toFixed(1)} h`} sub={`${plannedMin.toFixed(0)} min for ${job.quantity} off`} />
        <Stat
          label="Actual time"
          value={anyActuals ? `${(actualMin / 60).toFixed(1)} h` : '—'}
          sub={
            timeVariancePct == null
              ? 'log minutes below'
              : `${timeVariancePct > 0 ? '+' : ''}${timeVariancePct.toFixed(0)}% vs plan · ${
                  allLogged ? 'all ops logged' : `${loggedOps.length} of ${job.router.length} ops logged`
                }`
          }
          tone={timeVariancePct == null ? undefined : timeVariancePct > 10 ? 'warn' : 'good'}
        />
        <Stat label="Job value" value={money(job.costSnapshot.grandTotal)} sub={`est. cost ${money(job.costSnapshot.estFactoryCost)}`} />
      </div>

      {/* Router / traveller */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-5 border-b border-border">
          <h2 className="font-bold text-foreground">Router / traveller</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Operations this part travels through. Planned times come from the estimate that priced the quote —
            log what each step <strong className="text-foreground">actually</strong> took to see where the estimate held up.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground bg-accent/30">
                <th className="px-4 py-3 font-semibold">Op</th>
                <th className="px-4 py-3 font-semibold">Operation</th>
                <th className="px-4 py-3 font-semibold">Work centre</th>
                <th className="px-4 py-3 font-semibold text-right">Setup</th>
                <th className="px-4 py-3 font-semibold text-right">Run/part</th>
                <th className="px-4 py-3 font-semibold text-right">Planned</th>
                <th className="px-4 py-3 font-semibold text-right">Actual</th>
                <th className="px-4 py-3 font-semibold">Done</th>
              </tr>
            </thead>
            <tbody>
              {job.router.map((o) => (
                <RouterRow
                  key={o.id}
                  op={o}
                  quantity={job.quantity}
                  onChange={(patch) => updateJobOperation(job.id, o.id, patch)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quoted snapshot */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <h2 className="font-bold text-foreground">Quoted snapshot</h2>
        <p className="text-xs text-muted-foreground">
          Frozen when the job was created, so editing the quote later can't change what the floor is building to.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-1">
          <Stat small label="Unit price" value={money(job.costSnapshot.unitPrice)} />
          <Stat small label="Stock" value={job.costSnapshot.stockDescription ?? '—'} />
          <Stat small label="Material" value={job.costSnapshot.materialName ?? '—'} />
          <Stat
            small
            label="Planned cycle"
            value={job.costSnapshot.cycleTimeSec ? `${job.costSnapshot.cycleTimeSec} s` : '—'}
            sub={job.costSnapshot.setups ? `${job.costSnapshot.setups} setup${job.costSnapshot.setups > 1 ? 's' : ''}` : undefined}
          />
        </div>
      </div>
    </div>
  );
}

function RouterRow({
  op,
  quantity,
  onChange,
}: {
  op: JobOperation;
  quantity: number;
  onChange: (patch: Partial<JobOperation>) => void;
}) {
  const [draft, setDraft] = useState(op.actualMin != null ? String(op.actualMin) : '');
  const Icon = KIND_ICON[op.kind] ?? Cpu;
  const planned = op.setupMin + op.runMinPerPart * Math.max(1, quantity);
  const done = op.status === 'done';

  const commit = () => {
    const v = parseFloat(draft);
    onChange({ actualMin: Number.isFinite(v) && v >= 0 ? v : undefined });
  };

  return (
    <tr className={cn('border-b border-border last:border-0 transition-colors', done ? 'bg-emerald-500/5' : 'hover:bg-accent/30')}>
      <td className="px-4 py-3 font-mono text-muted-foreground">{op.opNumber}</td>
      <td className="px-4 py-3">
        <div className="flex items-start gap-2">
          <Icon size={14} className="text-muted-foreground shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className={cn('font-medium', done ? 'text-muted-foreground line-through' : 'text-foreground')}>{op.name}</p>
            {op.notes && <p className="text-[11px] text-muted-foreground leading-snug">{op.notes}</p>}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{op.workCentre}</td>
      <td className="px-4 py-3 text-right font-mono text-xs">{op.setupMin ? `${op.setupMin}m` : '—'}</td>
      <td className="px-4 py-3 text-right font-mono text-xs">{op.runMinPerPart ? `${op.runMinPerPart}m` : '—'}</td>
      <td className="px-4 py-3 text-right font-mono text-xs">{planned.toFixed(0)}m</td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <Clock size={11} className="text-muted-foreground/60" />
          <input
            type="number"
            min="0"
            step="1"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            placeholder="—"
            aria-label={`Actual minutes for ${op.name}`}
            className="w-16 bg-background border border-border rounded px-2 py-1 text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </td>
      <td className="px-4 py-3">
        <button
          onClick={() => onChange({ status: done ? 'pending' : 'done' })}
          aria-label={done ? `Mark ${op.name} not done` : `Mark ${op.name} done`}
          className={cn(
            'p-1.5 rounded-md border transition-colors',
            done
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
              : 'border-border text-muted-foreground hover:bg-accent'
          )}
        >
          <CheckCircle2 size={16} />
        </button>
      </td>
    </tr>
  );
}

function Stat({
  label,
  value,
  sub,
  small,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  small?: boolean;
  tone?: 'good' | 'warn';
}) {
  return (
    <div className={cn(!small && 'bg-card border border-border rounded-lg p-4')}>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p
        className={cn(
          small ? 'text-sm font-semibold' : 'text-xl font-bold',
          'text-foreground mt-0.5',
          tone === 'warn' && 'text-amber-600 dark:text-amber-400',
          tone === 'good' && 'text-emerald-600 dark:text-emerald-400'
        )}
      >
        {value}
      </p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}
