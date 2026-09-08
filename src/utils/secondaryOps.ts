/**
 * SECONDARY OPERATIONS — the non-machining work centres a job passes through
 * after the mill/lathe: subcontract finishing (plating, anodize, coating,
 * heat-treat, passivate) and inspection / first-article. TurnCircuit's routing
 * models these explicitly (op 60 "SCANOD — gold plate", op 70 "IN — final
 * inspection") but leaves them at $0; a real quote has to price them.
 *
 * Cost shape mirrors how a subcontractor bills: a one-time LOT CHARGE (setup /
 * minimum per batch, amortised over the quantity, so it dominates at qty 1 and
 * fades by qty 100) plus a PER-PART cost. They fold into the part subtotal, so
 * the shop's overhead + margin apply the same as the rest of the quote.
 */
import type { CostLineItem, SecondaryOperation } from '../types';

// Re-exported so estimators/UI can import the type alongside these helpers.
export type { SecondaryOperation, SecondaryCategory } from '../types';

/** Teal — distinct from the machining/setup/material palette. */
export const SECONDARY_COLOR = '#14b8a6';

const q1 = (qty: number) => Math.max(1, Math.round(qty || 1));
const nn = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

/** Per-part cost of one secondary op at a given batch qty (lot amortised + per-part). */
export function secondaryOpPerUnit(op: SecondaryOperation, qty: number): number {
  return nn(op.lotCharge) / q1(qty) + nn(op.perPartCost);
}

/** Total per-part secondary-ops cost for a selection at a given batch qty. */
export function secondaryOpsCostPerUnit(ops: SecondaryOperation[] | undefined, qty: number): number {
  if (!ops || ops.length === 0) return 0;
  return ops.reduce((a, o) => a + secondaryOpPerUnit(o, qty), 0);
}

/** One per-part cost line item per selected secondary op (for the breakdown). */
export function secondaryOpsLineItems(ops: SecondaryOperation[] | undefined, qty: number): CostLineItem[] {
  if (!ops || ops.length === 0) return [];
  const q = q1(qty);
  return ops.map((o) => {
    const parts: string[] = [];
    if (nn(o.lotCharge) > 0) parts.push(`$${nn(o.lotCharge).toFixed(0)} lot ÷ ${q}`);
    if (nn(o.perPartCost) > 0) parts.push(`$${nn(o.perPartCost).toFixed(2)}/part`);
    return {
      key: 'secondary',
      name: o.name,
      driver: parts.join(' + ') || 'included',
      value: secondaryOpPerUnit(o, qty),
      color: SECONDARY_COLOR,
    };
  });
}
