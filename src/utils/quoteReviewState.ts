import type { Quote, SecondaryOperation } from '../types';
import { secondaryOpsFromCosts } from './jobRouter';

export function restoreReviewState(quote: Quote, catalogue: SecondaryOperation[]) {
  return {
    margin: quote.marginPercent,
    notes: quote.notes,
    secondaryOps: quote.secondaryOps ?? secondaryOpsFromCosts(quote.machiningCosts, catalogue).map((op) => {
      if (catalogue.some((item) => item.name === op.name)) return op;
      // Old quotes did not store the lot/per-part split. Preserve the quoted
      // unit allowance rather than silently making a removed operation free.
      const line = quote.machiningCosts?.lineItems.find((item) => item.key === 'secondary' && item.name === op.name);
      return { ...op, perPartCost: line?.value ?? 0 };
    }),
    ...(quote.secondaryOps === undefined && quote.machiningCosts?.lineItems.some((line) => line.key === 'secondary')
      ? { warning: 'Legacy finishing selections recovered from cost lines. Confirm current prices and lot charges before saving or changing quantity.' }
      : {}),
  };
}
