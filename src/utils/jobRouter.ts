/**
 * JOB ROUTER (traveller) — turning a won quote into the ordered list of
 * operations the part actually travels through on the shop floor.
 *
 * The estimator already computes a per-setup, per-operation machining PLAN (the
 * same one the price is built from). A router is that plan, bracketed by the
 * real-world steps a plan doesn't cover:
 *
 *   10  Material issue    — call off the bar / billet and saw to length
 *   20+ Machining setups  — one op per setup, from the machining plan
 *   ..  Secondary ops     — subcontract plating / anodise / heat treat
 *   ..  Inspection        — final / FAI
 *   ..  Pack & ship
 *
 * Operations are numbered 10, 20, 30 … the way a shop numbers a route sheet, so
 * the traveller reads like the ones the floor already uses. Planned setup and run
 * times come straight from the quote, which is what makes the quoted-vs-actual
 * comparison (and the self-calibrating estimator) possible: the floor logs actual
 * minutes against the very operations the estimate priced.
 */
import { Job, JobOperation, MachiningCosts, SecondaryOperation, WorkCentreKind } from '../types';
import { generateId } from './idGenerator';

/** Inputs the router needs — everything comes off the quote and its analysis. */
export interface RouterInput {
  /** Machining breakdown from the quote (carries the plan, setups, cycle time). */
  machiningCosts?: MachiningCosts;
  /** Machine the quote was priced on, e.g. 'Multi-Axis Turn-Mill Centre'. */
  machineName?: string;
  /** Secondary operations selected on the quote (plating, inspection, …). */
  secondaryOps?: SecondaryOperation[];
  /** Stock description for the material-issue op, e.g. '⌀45 round bar'. */
  stockDescription?: string;
  materialName?: string;
  /** Batch size — run minutes are per part, so the traveller can show both. */
  quantity: number;
}

/**
 * Recover the secondary operations a quote was priced with.
 *
 * The wizard doesn't persist the selected ops on the quote itself, but the cost
 * breakdown does carry one line per op (`key: 'secondary'`, named after the op),
 * so the selection can be reconstructed by matching those line names against the
 * shop's catalogue — which is also where the category (and so the work centre)
 * comes from. Anything not found in the catalogue is still routed, as a plain
 * subcontract step, rather than being silently dropped from the traveller.
 */
export function secondaryOpsFromCosts(
  mc: MachiningCosts | undefined,
  catalogue: SecondaryOperation[] | undefined
): SecondaryOperation[] {
  const names = (mc?.lineItems ?? []).filter((li) => li.key === 'secondary').map((li) => li.name);
  return names.map(
    (name) =>
      (catalogue ?? []).find((c) => c.name === name) ?? {
        id: `secondary-${name}`,
        name,
        category: 'other' as SecondaryOperation['category'],
        lotCharge: 0,
        perPartCost: 0,
      }
  );
}

const OP_STEP = 10;

/** Minutes, rounded to 0.1 — traveller times don't need more precision. */
const min1 = (v: number) => Math.round(Math.max(0, v) * 10) / 10;

function op(
  opNumber: number,
  name: string,
  kind: WorkCentreKind,
  workCentre: string,
  setupMin: number,
  runMinPerPart: number,
  notes?: string
): JobOperation {
  return {
    id: generateId('op-'),
    opNumber,
    name,
    kind,
    workCentre,
    setupMin: min1(setupMin),
    runMinPerPart: min1(runMinPerPart),
    notes,
    status: 'pending',
  };
}

/**
 * Build the router for a job. Always returns at least material-issue → inspection
 * → ship, so a job created from a non-machining quote still travels sensibly.
 */
export function buildJobRouter(input: RouterInput): JobOperation[] {
  const mc = input.machiningCosts;
  const ops: JobOperation[] = [];
  let n = OP_STEP;
  const next = () => {
    const cur = n;
    n += OP_STEP;
    return cur;
  };

  // --- Material issue -------------------------------------------------------
  const stock = input.stockDescription || 'stock';
  ops.push(
    op(
      next(),
      'Material issue',
      'material',
      'Stores / saw',
      5,
      0.5,
      `Issue ${stock}${input.materialName ? ` — ${input.materialName}` : ''}; saw to length.`
    )
  );

  // --- Machining setups -----------------------------------------------------
  const machine = input.machineName || (mc?.machineClass === 'turn' ? 'Lathe' : 'Machining centre');
  const plan = mc?.plan;
  if (plan && plan.setups.length > 0) {
    // Setup time is quoted for the whole job; split it across the setups so each
    // traveller line carries its share.
    const setupEach = (mc?.setupTimeMin ?? 0) / plan.setups.length;
    for (const s of plan.setups) {
      const tools = s.operations.map((o) => o.tool).filter(Boolean);
      const uniqueTools = Array.from(new Set(tools));
      const opNames = s.operations.map((o) => o.name).join(', ');
      ops.push(
        op(
          next(),
          s.name || `Setup ${s.index}`,
          'machining',
          machine,
          setupEach,
          s.seconds / 60,
          [
            s.orientation ? `Orientation: ${s.orientation}.` : '',
            opNames ? `Ops: ${opNames}.` : '',
            uniqueTools.length ? `Tools: ${uniqueTools.join(' · ')}.` : '',
          ]
            .filter(Boolean)
            .join(' ')
        )
      );
    }
  } else if (mc) {
    // A machining quote without a per-setup plan (e.g. a turned part): one
    // machining line carrying the whole cycle.
    ops.push(
      op(
        next(),
        mc.setups > 1 ? `Machining (${mc.setups} setups)` : 'Machining',
        'machining',
        machine,
        mc.setupTimeMin ?? 0,
        (mc.cycleTimeSec ?? 0) / 60,
        'Cycle time from the quoted estimate.'
      )
    );
  }

  // --- Secondary / subcontract operations -----------------------------------
  for (const sop of input.secondaryOps ?? []) {
    ops.push(
      op(
        next(),
        sop.name,
        sop.category === 'inspection' ? 'inspection' : 'secondary',
        sop.category === 'inspection' ? 'Inspection' : 'Subcontract',
        0,
        0,
        sop.leadTimeDays ? `Allow ${sop.leadTimeDays} days turnaround.` : undefined
      )
    );
  }

  // --- Final inspection + despatch -----------------------------------------
  ops.push(op(next(), 'Deburr & final inspection', 'inspection', 'Inspection', 0, 1.5));
  ops.push(op(next(), 'Pack & ship', 'shipping', 'Despatch', 0, 0.5));

  return ops;
}

/** Planned minutes for the whole batch: setup once + run per part. */
export function plannedJobMinutes(router: JobOperation[], quantity: number): number {
  const qty = Math.max(1, Math.round(quantity || 1));
  return min1(
    router.reduce((sum, o) => sum + o.setupMin + o.runMinPerPart * qty, 0)
  );
}

/** Actual minutes logged so far across the router. */
export function actualJobMinutes(router: JobOperation[]): number {
  return min1(router.reduce((sum, o) => sum + (o.actualMin ?? 0), 0));
}

/** Fraction of operations marked done (0–1) — the job's progress bar. */
export function jobProgress(router: JobOperation[]): number {
  if (!router.length) return 0;
  return router.filter((o) => o.status === 'done').length / router.length;
}

/**
 * Derive the status a job should be in from its router, without overriding the
 * states a human sets deliberately (on-hold / cancelled / shipped and beyond).
 */
export function deriveJobStatus(job: Job): Job['status'] {
  const terminal: Array<Job['status']> = ['shipped', 'invoiced', 'closed', 'on-hold', 'cancelled'];
  if (terminal.includes(job.status)) return job.status;
  const done = job.router.filter((o) => o.status === 'done').length;
  if (done === 0) return job.status === 'planned' ? 'planned' : 'released';
  if (done === job.router.length) return 'complete';
  return 'in-progress';
}
