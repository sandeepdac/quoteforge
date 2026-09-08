import React from 'react';
import { MachiningCosts, CostLineItem } from '../../types';

interface Props {
  costs: MachiningCosts;
  overheadPercent: number;
  currency?: string;
}

const secs = (s: number) => {
  const t = Math.round(s);
  if (t <= 0) return '—';
  if (t < 60) return `${t}s`;
  const m = Math.floor(t / 60);
  const r = t % 60;
  if (m < 60) return r ? `${m}m ${r}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

/**
 * A CAM-style cost breakdown: material, then each SETUP with its operations
 * (operation · tool · time · cost), then the setup / fixturing / tooling charges,
 * then the subtotal — laid out the way the reference quoting tool prints a job.
 *
 * The cutting operations come from the machining plan; the non-cutting rows come
 * from the cost line items. They reconcile to the same subtotal as the estimate.
 */
export default function MachiningCostTable({ costs, overheadPercent, currency = '$' }: Props) {
  const money = (v: number) => `${currency}${v.toFixed(2)}`;
  const li = (key: string): CostLineItem | undefined => costs.lineItems.find((l) => l.key === key);
  const plan = costs.plan;

  const material = li('material');
  const noncut = li('noncut');
  const setup = li('setup');
  const setupCharge = li('setupCharge');
  const nre = li('nre');
  const fixture = li('fixture');
  const tooling = li('tooling');
  const secondaries = costs.lineItems.filter((l) => l.key === 'secondary');

  const cell = 'px-4 py-2 text-sm';
  const num = 'px-4 py-2 text-sm text-right tabular-nums whitespace-nowrap';

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
          <thead>
            <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border">
              <th className="px-4 py-2.5">Operation</th>
              <th className="px-4 py-2.5">Tool</th>
              <th className="px-4 py-2.5 text-right">Time</th>
              <th className="px-4 py-2.5 text-right">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {/* Material */}
            {material && (
              <tr>
                <td className={cell}>
                  <span className="font-medium text-foreground">{material.name}</span>
                  <span className="block text-[10px] text-muted-foreground">{material.driver}</span>
                </td>
                <td className={cell}>—</td>
                <td className={num}>—</td>
                <td className={`${num} font-medium`}>{money(material.value)}</td>
              </tr>
            )}

            {/* Setups → operations */}
            {plan?.setups.map((s) => {
              const cutSec = s.operations.reduce((a, o) => a + o.seconds, 0);
              const cutCost = s.operations.reduce((a, o) => a + o.cost, 0);
              return (
                <React.Fragment key={s.index}>
                  <tr className="bg-muted/20">
                    <td className={`${cell} font-bold text-foreground`} colSpan={2}>{s.name}</td>
                    <td className={`${num} font-semibold`}>{secs(cutSec)}</td>
                    <td className={`${num} font-semibold`}>{money(cutCost)}</td>
                  </tr>
                  {s.operations.map((o, i) => (
                    <tr key={i}>
                      <td className={`${cell} pl-8`}>
                        <span className="inline-flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: o.color }} />
                          <span className="text-foreground">{o.name}</span>
                        </span>
                      </td>
                      <td className={`${cell} text-muted-foreground`}>{o.tool}</td>
                      <td className={`${num} text-muted-foreground`}>{secs(o.seconds)}</td>
                      <td className={num}>{money(o.cost)}</td>
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}

            {/* Non-cutting machine + shop charges */}
            {noncut && noncut.value > 0.005 && (
              <tr>
                <td className={cell}><span className="text-foreground">Tool changes &amp; rapids</span></td>
                <td className={`${cell} text-muted-foreground`}>{noncut.driver}</td>
                <td className={num}>—</td>
                <td className={num}>{money(noncut.value)}</td>
              </tr>
            )}
            {[setup, setupCharge, nre, fixture, tooling]
              .filter((x): x is CostLineItem => !!x && x.value > 0.005)
              .map((x) => (
                <tr key={x.key}>
                  <td className={cell}>
                    <span className="text-foreground">{x.name}</span>
                    {x.driver ? <span className="block text-[10px] text-muted-foreground">{x.driver}</span> : null}
                  </td>
                  <td className={cell}>—</td>
                  <td className={num}>—</td>
                  <td className={num}>{money(x.value)}</td>
                </tr>
              ))}

            {/* Secondary operations (finishing / inspection) */}
            {secondaries.length > 0 && (
              <tr className="bg-muted/20">
                <td className={`${cell} font-bold text-foreground`} colSpan={3}>Secondary operations</td>
                <td className={`${num} font-semibold`}>{money(secondaries.reduce((a, s) => a + s.value, 0))}</td>
              </tr>
            )}
            {secondaries.map((x, i) => (
              <tr key={`sec-${i}`}>
                <td className={`${cell} pl-8`}>
                  <span className="inline-flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: x.color }} />
                    <span className="text-foreground">{x.name}</span>
                  </span>
                </td>
                <td className={`${cell} text-muted-foreground`}>{x.driver}</td>
                <td className={num}>—</td>
                <td className={num}>{money(x.value)}</td>
              </tr>
            ))}

            {/* Subtotal */}
            <tr className="bg-muted/10 font-semibold border-t-2 border-border">
              <td className={cell} colSpan={3}>
                Subtotal <span className="text-muted-foreground font-normal">(incl. {Math.round(overheadPercent * 100)}% overhead)</span>
              </td>
              <td className={num}>{money(costs.subtotal + costs.overhead)}</td>
            </tr>
          </tbody>
        </table>
    </div>
  );
}
