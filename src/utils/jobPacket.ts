/**
 * JOB PACKET — the handoff to a shop's existing MRP (and to the shop floor).
 *
 * A shop that already runs an MRP shouldn't have to abandon it to use QuoteForge.
 * The packet is the bridge: everything the MRP needs to open the works order —
 * header, customer, material, the full router with work-centre codes and planned
 * times, and the money — in three renderings of the SAME data:
 *
 *   • JSON — the machine-readable handoff for an MRP import / integration.
 *   • CSV  — flat router rows, for the many MRPs that import a spreadsheet.
 *   • PDF  — a printed traveller for the floor (see jobTravellerPdf).
 *
 * Work-centre MAPPING matters: our internal names ("Multi-Axis Turn-Mill Centre")
 * mean nothing to their system, which knows "TM01". The shop maps ours → theirs
 * once in Settings, and every export speaks their language from then on.
 */
import { Customer, Job, JobOperation, Part, Quote, WorkCentreKind } from '../types';

/** One shop-configured mapping from our work centre to the MRP's own code. */
export interface WorkCentreMapping {
  /** Our work-centre name as it appears on the router. */
  from: string;
  /** The code their MRP expects, e.g. 'TM01'. */
  to: string;
}

export interface JobPacketInput {
  job: Job;
  customer?: Customer;
  part?: Part;
  quote?: Quote;
  /** Shop-configured work-centre code mapping. */
  mappings?: WorkCentreMapping[];
  shopName?: string;
  currency?: string;
}

/** The exported packet's shape — stable, documented, and safe to integrate against. */
export interface JobPacket {
  /** Bumped when the packet's shape changes, so an importer can branch on it. */
  packetVersion: 1;
  generatedAt: string;
  source: { app: 'QuoteForge'; shopName?: string };
  job: {
    jobNumber: string;
    status: string;
    quantity: number;
    poNumber?: string;
    createdDate: string;
    dueDate?: string;
    releasedDate?: string;
    notes?: string;
  };
  customer: { name?: string; contactName?: string; email?: string; terms?: string };
  part: { name?: string; material?: string; stock?: string };
  router: Array<{
    opNumber: number;
    name: string;
    kind: WorkCentreKind;
    /** Our work-centre name. */
    workCentre: string;
    /** The MRP's own code when mapped, else the same as `workCentre`. */
    workCentreCode: string;
    setupMin: number;
    runMinPerPart: number;
    /** Setup once + run × qty. */
    totalPlannedMin: number;
    actualMin?: number;
    status: string;
    notes?: string;
  }>;
  totals: {
    plannedSetupMin: number;
    plannedRunMin: number;
    plannedTotalMin: number;
    actualMin?: number;
  };
  costs: {
    currency?: string;
    unitPrice: number;
    grandTotal: number;
    estFactoryCost: number;
    quoteNumber?: string;
  };
}

const r1 = (v: number) => Math.round((Number.isFinite(v) ? v : 0) * 10) / 10;

/** Apply the shop's work-centre mapping (case-insensitive), else pass through. */
export function mapWorkCentre(name: string, mappings?: WorkCentreMapping[]): string {
  const hit = (mappings ?? []).find(
    (m) => m.from.trim().toLowerCase() === (name ?? '').trim().toLowerCase() && m.to.trim()
  );
  return hit ? hit.to.trim() : name;
}

function opPlannedMin(op: JobOperation, qty: number): number {
  return r1(op.setupMin + op.runMinPerPart * Math.max(1, qty));
}

export function buildJobPacket(input: JobPacketInput): JobPacket {
  const { job, customer, part, quote, mappings } = input;
  const qty = Math.max(1, Math.round(job.quantity || 1));

  const router = job.router.map((o) => ({
    opNumber: o.opNumber,
    name: o.name,
    kind: o.kind,
    workCentre: o.workCentre,
    workCentreCode: mapWorkCentre(o.workCentre, mappings),
    setupMin: r1(o.setupMin),
    runMinPerPart: r1(o.runMinPerPart),
    totalPlannedMin: opPlannedMin(o, qty),
    actualMin: o.actualMin,
    status: o.status,
    notes: o.notes,
  }));

  const plannedSetupMin = r1(job.router.reduce((s, o) => s + o.setupMin, 0));
  const plannedRunMin = r1(job.router.reduce((s, o) => s + o.runMinPerPart * qty, 0));
  const loggedOps = job.router.filter((o) => o.actualMin != null);

  return {
    packetVersion: 1,
    generatedAt: new Date().toISOString(),
    source: { app: 'QuoteForge', shopName: input.shopName },
    job: {
      jobNumber: job.jobNumber,
      status: job.status,
      quantity: qty,
      poNumber: job.poNumber,
      createdDate: job.createdDate,
      dueDate: job.dueDate,
      releasedDate: job.releasedDate,
      notes: job.notes,
    },
    customer: {
      name: customer?.name,
      contactName: customer?.contactName,
      email: customer?.email,
      terms: customer?.terms,
    },
    part: {
      name: part?.name,
      material: job.costSnapshot.materialName,
      stock: job.costSnapshot.stockDescription,
    },
    router,
    totals: {
      plannedSetupMin,
      plannedRunMin,
      plannedTotalMin: r1(plannedSetupMin + plannedRunMin),
      actualMin: loggedOps.length ? r1(loggedOps.reduce((s, o) => s + (o.actualMin ?? 0), 0)) : undefined,
    },
    costs: {
      currency: input.currency,
      unitPrice: job.costSnapshot.unitPrice,
      grandTotal: job.costSnapshot.grandTotal,
      estFactoryCost: job.costSnapshot.estFactoryCost,
      quoteNumber: quote?.quoteNumber,
    },
  };
}

/** Quote a CSV field only when it needs it, escaping embedded quotes. */
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Router as CSV — one row per operation, with the job header repeated on each
 * row. Repetition is deliberate: most MRP spreadsheet imports read rows
 * independently, so each row has to stand on its own.
 */
export function jobPacketToCsv(packet: JobPacket): string {
  const header = [
    'job_number', 'po_number', 'customer', 'part', 'quantity', 'due_date',
    'op_number', 'operation', 'work_centre_code', 'work_centre', 'op_kind',
    'setup_min', 'run_min_per_part', 'total_planned_min', 'actual_min', 'op_status', 'notes',
  ];
  const rows = packet.router.map((o) =>
    [
      packet.job.jobNumber,
      packet.job.poNumber ?? '',
      packet.customer.name ?? '',
      packet.part.name ?? '',
      packet.job.quantity,
      packet.job.dueDate ? packet.job.dueDate.slice(0, 10) : '',
      o.opNumber,
      o.name,
      o.workCentreCode,
      o.workCentre,
      o.kind,
      o.setupMin,
      o.runMinPerPart,
      o.totalPlannedMin,
      o.actualMin ?? '',
      o.status,
      o.notes ?? '',
    ].map(csvCell).join(',')
  );
  // CRLF: the line ending Excel and most MRP importers expect.
  return [header.join(','), ...rows].join('\r\n');
}

/** Trigger a browser download for a text payload. */
export function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
