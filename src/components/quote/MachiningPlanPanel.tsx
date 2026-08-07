import React, { useState } from 'react';
import { ChevronRight, Layers, Wrench, AlertTriangle } from 'lucide-react';
import { MachiningPlan } from '../../types';

interface Props {
  plan: MachiningPlan;
  /** Setup charge is separate from cutting time; shown for completeness. */
  setupTimeMin?: number;
  currency?: string;
}

const secs = (s: number) => {
  const t = Math.round(s);
  if (t < 60) return `${t}s`;
  const m = Math.floor(t / 60);
  const r = t % 60;
  if (m < 60) return r ? `${m}m ${r}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

/**
 * The estimate regrouped as a job sheet: Setup → operations → tool, the way a
 * machinist reads it. Same totals as the cost breakdown, different cut.
 */
export default function MachiningPlanPanel({ plan, setupTimeMin, currency = '$' }: Props) {
  const [open, setOpen] = useState<Record<number, boolean>>({ 1: true });
  const money = (v: number) => `${currency}${v.toFixed(2)}`;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Layers size={15} className="text-primary" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Machining Plan</h3>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
            Estimated
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          <span className="font-semibold text-foreground">{secs(plan.totalSeconds)}</span> cutting ·{' '}
          <span className="font-semibold text-foreground">{money(plan.totalCost)}</span>
          {setupTimeMin ? <> · {Math.round(setupTimeMin)} min setup</> : null}
        </div>
      </div>

      {/* Setups → operations */}
      <div className="divide-y divide-border">
        {plan.setups.map((s) => {
          const isOpen = open[s.index] !== false;
          return (
            <div key={s.index}>
              <button
                onClick={() => setOpen((o) => ({ ...o, [s.index]: !isOpen }))}
                className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-accent/30 transition-colors text-left"
              >
                <ChevronRight
                  size={14}
                  className={`text-muted-foreground shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                />
                <span className="text-sm font-semibold text-foreground flex-1">{s.name}</span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {s.toolChanges} tool change{s.toolChanges === 1 ? '' : 's'}
                </span>
                <span className="text-xs font-semibold text-foreground tabular-nums w-20 text-right">{secs(s.seconds)}</span>
                <span className="text-xs font-semibold text-foreground tabular-nums w-20 text-right">{money(s.cost)}</span>
              </button>

              {isOpen && (
                <div className="pb-2">
                  {s.operations.map((op, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 pl-10 pr-4 py-1.5 hover:bg-accent/20 transition-colors"
                    >
                      <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: op.color }} />
                      <span className="flex-1 min-w-0">
                        <span className="text-[13px] text-foreground">{op.name}</span>
                        <span className="block text-[10px] text-muted-foreground truncate">
                          {op.tool} · {op.driver}
                        </span>
                      </span>
                      <span className="text-[11px] text-muted-foreground tabular-nums w-20 text-right shrink-0">{secs(op.seconds)}</span>
                      <span className="text-[11px] text-muted-foreground tabular-nums w-20 text-right shrink-0">{money(op.cost)}</span>
                    </div>
                  ))}
                  {s.operations.length === 0 && (
                    <p className="pl-10 pr-4 py-1.5 text-[11px] text-muted-foreground">No cutting time in this setup.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Tool summary */}
      {plan.tools.length > 0 && (
        <div className="border-t border-border px-4 py-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Wrench size={12} className="text-muted-foreground" />
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Tools</h4>
          </div>
          <div className="space-y-1">
            {plan.tools.map((t) => (
              <div key={t.name} className="flex items-center gap-2 text-[11px]">
                <span className="flex-1 truncate text-foreground">{t.name}</span>
                <span className="text-muted-foreground tabular-nums">{t.ops} op{t.ops === 1 ? '' : 's'}</span>
                <span className="text-muted-foreground tabular-nums w-16 text-right">{secs(t.seconds)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 pb-3 pt-1 flex items-start gap-2">
        <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Operations and tools are <strong className="text-foreground">inferred from the geometry</strong>, not read from a posted
          toolpath. The number of setups is measured, but which feature falls in which setup is an even split — treat the per-setup
          times as indicative and the <strong className="text-foreground">total</strong> as the estimate.
        </p>
      </div>
    </div>
  );
}
