/**
 * JOBS (work orders) — the MRP layer on top of quoting.
 *
 * A won quote is converted into a Job, which freezes a SNAPSHOT of what was
 * quoted and carries a ROUTER of the operations the part travels through. The
 * snapshot matters: once a job is on the floor, editing the quote must not
 * silently change the work order the shop is building to.
 *
 * Jobs live in their own persisted collection, alongside quotes/parts/customers,
 * and are keyed by quote so a quote can show whether it has already been
 * converted.
 */
import React, { createContext, useContext, ReactNode } from 'react';
import { Job, JobOperation, Quote, SecondaryOperation, ShopSettings } from '../types';
import { usePersistentState } from '../hooks/usePersistentState';
import { generateId, nextDocNumber } from '../utils/idGenerator';
import { buildJobRouter, deriveJobStatus, secondaryOpsFromCosts } from '../utils/jobRouter';
import { dimsDesc } from '../utils/dims';

interface JobContextType {
  jobs: Job[];
  addJob: (job: Job) => void;
  updateJob: (job: Job) => void;
  deleteJob: (id: string) => void;
  getJobById: (id: string) => Job | undefined;
  /** The job created from a quote, if it has already been converted. */
  getJobByQuoteId: (quoteId: string) => Job | undefined;
  /** Build (but don't save) a job from a won quote. */
  buildJobFromQuote: (quote: Quote, ctx: BuildJobContext) => Job;
  /** Build + save, returning the created job. */
  createJobFromQuote: (quote: Quote, ctx: BuildJobContext) => Job;
  /** Update one operation on a job, re-deriving the job's status. */
  updateJobOperation: (jobId: string, opId: string, patch: Partial<JobOperation>) => void;
}

/** What the job builder needs beyond the quote itself. */
export interface BuildJobContext {
  /** Shop settings — supplies the secondary-op catalogue. */
  settings?: ShopSettings;
  /** Customer PO reference, when known at conversion time. */
  poNumber?: string;
  /** Explicit due date; otherwise derived from the quote's lead time. */
  dueDate?: string;
}

const JobContext = createContext<JobContextType | undefined>(undefined);

/** Human-readable stock line for the traveller's material-issue op. */
function stockDescriptionFor(quote: Quote): string | undefined {
  const mc = quote.machiningCosts;
  if (!mc) return undefined;
  if (mc.fromBarStock && mc.barDiameterMm) return `⌀${mc.barDiameterMm} round bar`;
  if (mc.machineClass === 'turn' && mc.barDiameterMm) return `⌀${mc.barDiameterMm} bar`;
  if (mc.stockMm) return `${dimsDesc(mc.stockMm)} mm billet`;
  return undefined;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + Math.max(0, Math.round(days || 0)));
  return d.toISOString();
}

export const JobProvider = ({ children }: { children: ReactNode }) => {
  const [jobs, setJobs] = usePersistentState<Job[]>('jobs_v1', []);

  const addJob = (job: Job) => setJobs([job, ...jobs]);
  const updateJob = (updated: Job) => setJobs(jobs.map((j) => (j.id === updated.id ? updated : j)));
  const deleteJob = (id: string) => setJobs(jobs.filter((j) => j.id !== id));
  const getJobById = (id: string) => jobs.find((j) => j.id === id);
  const getJobByQuoteId = (quoteId: string) => jobs.find((j) => j.quoteId === quoteId);

  const buildJobFromQuote = (quote: Quote, ctx: BuildJobContext = {}): Job => {
    const mc = quote.machiningCosts;
    const catalogue: SecondaryOperation[] | undefined = ctx.settings?.secondaryOps;
    const secondaryOps = secondaryOpsFromCosts(mc, catalogue);
    const machineName = quote.cadAnalysis?.machineRecommendation?.recommendedName;
    const materialName = quote.cadAnalysis?.materialName;
    const stockDescription = stockDescriptionFor(quote);

    const router = buildJobRouter({
      machiningCosts: mc,
      machineName,
      secondaryOps,
      stockDescription,
      materialName,
      quantity: quote.quantity,
    });

    const createdDate = new Date().toISOString();
    // Estimated factory cost for the batch — the yardstick the captured actuals
    // are later compared against (and what feeds estimator self-calibration).
    const estFactoryCost = (quote.costs.subtotal + quote.costs.overhead) * quote.quantity;

    return {
      id: generateId('job-'),
      jobNumber: nextDocNumber(jobs.map((j) => j.jobNumber), 'JOB'),
      quoteId: quote.id,
      customerId: quote.customerId,
      partId: quote.partId,
      poNumber: ctx.poNumber,
      status: 'planned',
      quantity: quote.quantity,
      createdDate,
      dueDate: ctx.dueDate ?? addDays(createdDate, quote.leadTimeDays),
      router,
      costSnapshot: {
        unitPrice: quote.totalUnitPrice,
        grandTotal: quote.grandTotal,
        estFactoryCost,
        cycleTimeSec: mc?.cycleTimeSec,
        setups: mc?.setups,
        stockDescription,
        materialName,
      },
      notes: quote.notes,
    };
  };

  const createJobFromQuote = (quote: Quote, ctx: BuildJobContext = {}): Job => {
    const job = buildJobFromQuote(quote, ctx);
    setJobs([job, ...jobs]);
    return job;
  };

  const updateJobOperation = (jobId: string, opId: string, patch: Partial<JobOperation>) => {
    setJobs(
      jobs.map((j) => {
        if (j.id !== jobId) return j;
        const router = j.router.map((o) =>
          o.id === opId
            ? {
                ...o,
                ...patch,
                // Stamp the completion time when an op is marked done, and clear
                // it if the op is re-opened, so the traveller shows when work
                // actually finished. A patch that doesn't touch status leaves it.
                completedAt:
                  patch.status === undefined
                    ? o.completedAt
                    : patch.status === 'done'
                      ? o.completedAt ?? new Date().toISOString()
                      : undefined,
              }
            : o
        );
        const withRouter: Job = { ...j, router };
        const status = deriveJobStatus(withRouter);
        return {
          ...withRouter,
          status,
          completedDate:
            status === 'complete' ? withRouter.completedDate ?? new Date().toISOString() : withRouter.completedDate,
        };
      })
    );
  };

  return (
    <JobContext.Provider
      value={{
        jobs,
        addJob,
        updateJob,
        deleteJob,
        getJobById,
        getJobByQuoteId,
        buildJobFromQuote,
        createJobFromQuote,
        updateJobOperation,
      }}
    >
      {children}
    </JobContext.Provider>
  );
};

export const useJobs = () => {
  const ctx = useContext(JobContext);
  if (!ctx) throw new Error('useJobs must be used within a JobProvider');
  return ctx;
};
