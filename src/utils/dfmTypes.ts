/** Shared Design-for-Manufacturing report types (rendered by DfmPanel). */

export type DfmSeverity = 'fail' | 'warn' | 'pass' | 'info';

export interface DfmFinding {
  id: string;
  severity: DfmSeverity;
  title: string;
  detail: string;
  /** The guideline this check is based on, shown as a small caption. */
  rule: string;
}

export interface DfmReport {
  findings: DfmFinding[];
  counts: { fail: number; warn: number; pass: number; info: number };
  /** 0–100 manufacturability score (100 = no issues found). */
  score: number;
  /** True when the checks could run against measured geometry. */
  hasGeometry: boolean;
}
