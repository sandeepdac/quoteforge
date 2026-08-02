import React from 'react';
import { ShieldCheck, AlertTriangle, XCircle, CheckCircle2, Info } from 'lucide-react';
import { DfmReport, DfmSeverity } from '../../utils/dfm';

const SEVERITY: Record<DfmSeverity, { icon: typeof Info; color: string; ring: string }> = {
  fail: { icon: XCircle, color: 'text-red-600 dark:text-red-400', ring: 'bg-red-500/10 border-red-500/30' },
  warn: { icon: AlertTriangle, color: 'text-amber-600 dark:text-amber-400', ring: 'bg-amber-500/10 border-amber-500/30' },
  pass: { icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400', ring: 'bg-emerald-500/10 border-emerald-500/30' },
  info: { icon: Info, color: 'text-sky-600 dark:text-sky-400', ring: 'bg-sky-500/10 border-sky-500/30' },
};

function scoreColor(score: number): string {
  if (score >= 85) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 60) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

export default function DfmPanel({ dfm }: { dfm: DfmReport }) {
  if (!dfm || dfm.findings.length === 0) return null;

  const { counts } = dfm;

  return (
    <div className="bg-card border border-border p-4 rounded-xl space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
          <ShieldCheck size={14} className="text-primary" />
          Manufacturability (DFM)
        </span>
        <span className={`text-sm font-bold tabular-nums ${scoreColor(dfm.score)}`}>
          {dfm.score}<span className="text-muted-foreground font-medium">/100</span>
        </span>
      </div>

      {/* Severity summary */}
      <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
        {counts.fail > 0 && (
          <span className="px-2 py-0.5 rounded-full border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400">
            {counts.fail} blocker{counts.fail > 1 ? 's' : ''}
          </span>
        )}
        {counts.warn > 0 && (
          <span className="px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
            {counts.warn} caution{counts.warn > 1 ? 's' : ''}
          </span>
        )}
        {counts.pass > 0 && (
          <span className="px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            {counts.pass} pass{counts.pass > 1 ? 'es' : ''}
          </span>
        )}
      </div>

      <ul className="space-y-2">
        {dfm.findings.map((f) => {
          const s = SEVERITY[f.severity];
          const Icon = s.icon;
          return (
            <li key={f.id} className={`rounded-lg border p-2.5 ${s.ring}`}>
              <div className="flex items-start gap-2">
                <Icon size={15} className={`${s.color} mt-0.5 shrink-0`} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground leading-snug">{f.title}</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{f.detail}</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1 font-mono">Guideline: {f.rule}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-[10px] text-muted-foreground/80 leading-relaxed border-t border-border pt-2.5">
        Advisory checks against standard sheet-metal guidelines, computed from the measured geometry.
        Tune thresholds to your own machines and tolerances before treating them as pass/fail gates.
        {!dfm.hasGeometry && ' Positional checks (bend radius, hole-to-bend) need a measured solid and were skipped for this input.'}
      </p>
    </div>
  );
}
