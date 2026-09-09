/**
 * Single source of truth for "what does this quote cost?" — used by both the
 * live preview and the save/send path so the persisted quote can never diverge
 * from what the user was shown.
 *
 * Routes to the right estimator by part class:
 *   • turned solid  → turning cycle-time model
 *   • milled solid  → milling cycle-time model
 *   • everything else → the legacy fabrication model
 *
 * For machining quotes it returns the full `MachiningCosts` (so the UI can show
 * the op-level breakdown, batch curve, etc.) AND a `QuoteCosts`-shaped mapping so
 * persistence and the analytics/detail pages keep a stable, summable shape.
 */
import { CostLineItem, MachiningCosts, PartFeatures, QuoteCosts, ShopSettings } from '../types';
import { calculateQuoteCosts } from './estimator';
import { calculateMachiningCosts } from './cncEstimator';
import { calculateMilledCosts } from './milledEstimator';
import { materialPropsFor } from './materials';
import { MACHINE_CATALOG } from './machineSelection';
import type { RouteSetupOp } from './setupModel';
import type { ExtractedCadAnalysis } from './cadAnalyzer';
import type { SecondaryOperation } from './secondaryOps';

export interface ResolvedQuoteCosts {
  /** QuoteCosts-shaped totals (subtotal/overhead/margin/rush always correct). */
  costs: QuoteCosts;
  /** Itemised lines for the breakdown UI. */
  lineItems: CostLineItem[];
  unitPrice: number;
  grandTotal: number;
  /** Present for machining quotes — the full cycle-time breakdown. */
  machiningCosts?: MachiningCosts;
  machineClass?: 'turn' | 'mill';
}

export interface ResolveParams {
  cadAnalysis?: ExtractedCadAnalysis;
  features: PartFeatures;
  materialName: string;
  materialPricePerKg: number;
  quantity: number;
  isRush: boolean;
  margin: number;
  settings: ShopSettings;
  /**
   * Plating, passivate, FAI and the rest, as chosen on the Review step.
   *
   * These were priced into the preview and then dropped on the way to storage,
   * because this resolver had nowhere to put them: a quote with £200 of gold
   * plating in it was saved without the plating, and the job traveller that
   * reads its line items found no subcontract operation to send the part out on.
   */
  secondaryOps?: SecondaryOperation[];
}

/** Map a machining breakdown onto the QuoteCosts shape (totals preserved exactly). */
function machiningToQuoteCosts(mc: MachiningCosts): QuoteCosts {
  // Everything not carried by the four named buckets (secondary ops, one-time
  // programming NRE, …) lands in finishCost so the parts always sum to subtotal.
  const finishCost = mc.subtotal - (mc.materialCost + mc.machineCost + mc.setupCost + mc.toolingCost);
  return {
    materialCost: mc.materialCost,
    laserCost: mc.machineCost, // machine (cycle) time
    bendCost: mc.setupCost,    // setup, amortised
    weldCost: 0,
    assemblyCost: mc.toolingCost,
    finishCost: Math.max(0, finishCost),
    subtotal: mc.subtotal,
    overhead: mc.overhead,
    marginAmount: mc.marginAmount,
    rushPremium: mc.rushPremium,
  };
}

export function resolveQuoteCosts(p: ResolveParams): ResolvedQuoteCosts {
  const { cadAnalysis, features: f, settings } = p;
  const isTurnedPart = !!(cadAnalysis?.isTurned && cadAnalysis?.turningProfile);
  const isMilledPart = !!(cadAnalysis?.milledProfile && !cadAnalysis?.isTurned);
  // SETUP is DERIVED from this part — its tools, fixturings and features — and
  // no longer copied from what Lance booked on his machines. That swap costs
  // accuracy on his seven parts (spread 3.3 -> 5.4) and buys the only thing that
  // matters for a quoting tool: an answer for a part nobody has quoted yet. The
  // lookup could not speak at all for four of the seven machines, because each
  // of those figures came from a single job. See setupModel.ts.
  //
  // The RATE is deliberately left alone. Lance charges a flat GBP 30/hr and our
  // catalog spreads 40-135, so flattening it looks obviously right — but measured
  // on its own it makes the spread WORSE (6.8 -> 8.8) and drags this change back
  // from 3.5 to 3.8. Our rates are absorbing cycle-time error, and cycle time is
  // still 3-50x too fast. Flatten the rate only once cycle time is fixed.
  const rateMult = cadAnalysis?.machineRecommendation?.rateMultiplier ?? 1;
  const routeSetupMin = cadAnalysis?.machineRecommendation?.machineRoute?.totalSetupMin ?? 0;
  // THE WHOLE ROUTE, not just its first machine.
  //
  // `machineRoute` has named every op and its machine for a while, and the price
  // only ever saw the primary: a part routed NTX 1000 -> Mini Mill was charged
  // the NTX's dial-in and the Mini Mill's not at all, and its extra holdings were
  // billed as if they happened on the NTX. Passing the ops lets setup be derived
  // on each machine that actually runs one (setupModel.ts).
  //
  // Ops carry their own holding count, so a 3-axis part needing five clamps is
  // five, not the two that `ops.length` used to report.
  const routeOps: RouteSetupOp[] | undefined = (() => {
    const ops = cadAnalysis?.machineRecommendation?.machineRoute?.ops;
    if (!ops?.length) {
      const id = cadAnalysis?.machineRecommendation?.recommended;
      const spec = id ? MACHINE_CATALOG[id] : undefined;
      return spec ? [{ machine: spec, setups: 1 }] : undefined;
    }
    return ops
      .map((o) => ({ machine: MACHINE_CATALOG[o.machine], setups: o.setups }))
      .filter((o) => !!o.machine);
  })();
  const density = materialPropsFor(p.materialName).densityGCm3;

  if (isTurnedPart && cadAnalysis?.turningProfile) {
    const volumeCm3 = cadAnalysis.volumeCm3 ?? (f.weightKg > 0 ? (f.weightKg * 1000) / density : 0);
    const mc = calculateMachiningCosts(
      { isTurned: true, materialName: p.materialName, volumeCm3, profile: cadAnalysis.turningProfile, setups: cadAnalysis.setups ?? 1, materialPricePerKg: p.materialPricePerKg, secondaryOps: p.secondaryOps },
      p.quantity, p.isRush, p.margin, settings, rateMult, routeSetupMin, routeOps
    );
    const unitPrice = mc.subtotal + mc.overhead + mc.marginAmount;
    return { costs: machiningToQuoteCosts(mc), lineItems: mc.lineItems, unitPrice, grandTotal: unitPrice * p.quantity + mc.rushPremium, machiningCosts: mc, machineClass: mc.machineClass ?? 'turn' };
  }

  if (isMilledPart && cadAnalysis?.milledProfile) {
    const base = cadAnalysis.milledProfile;
    const partVolumeCm3 = base.partVolumeCm3;
    const profile = { ...base, partVolumeCm3, removedVolumeCm3: Math.max(0, base.stockVolumeCm3 - partVolumeCm3) };
    const mc = calculateMilledCosts(
      { materialName: p.materialName, profile, materialPricePerKg: p.materialPricePerKg, secondaryOps: p.secondaryOps },
      p.quantity, p.isRush, p.margin, settings, rateMult, routeSetupMin, routeOps
    );
    const unitPrice = mc.subtotal + mc.overhead + mc.marginAmount;
    return { costs: machiningToQuoteCosts(mc), lineItems: mc.lineItems, unitPrice, grandTotal: unitPrice * p.quantity + mc.rushPremium, machiningCosts: mc, machineClass: 'mill' };
  }

  // Legacy fabrication path.
  const qc = calculateQuoteCosts(f, p.quantity, p.isRush, p.margin, p.materialPricePerKg, settings);
  const unitPrice = qc.subtotal + qc.overhead + qc.marginAmount;
  const lineItems: CostLineItem[] = [
    { key: 'material', name: 'Material', driver: `${f.weightKg} kg × $${p.materialPricePerKg.toFixed(2)}/kg`, value: qc.materialCost, color: '#2563eb' },
    { key: 'laser', name: 'Laser cutting', driver: `${Math.round(f.perimeterMm)} mm · ${f.pierceCount} pierces`, value: qc.laserCost, color: '#3b82f6' },
    { key: 'bending', name: 'Press brake', driver: f.bendCount > 0 ? `${f.bendCount} bend(s)` : 'no bends', value: qc.bendCost, color: '#60a5fa' },
    { key: 'welding', name: 'Welding', driver: `${Math.round(f.weldLengthMm)} mm · ${f.weldCount} joint(s)`, value: qc.weldCost, color: '#8b5cf6' },
    { key: 'handling', name: 'Handling / assembly', driver: `${f.holeCount} hole(s)`, value: qc.assemblyCost, color: '#a78bfa' },
    { key: 'finish', name: 'Finishing', driver: `${f.surfaceAreaM2.toFixed(3)} m²`, value: qc.finishCost, color: '#93c5fd' },
  ].filter((li) => li.value > 0.005);
  return { costs: qc, lineItems, unitPrice, grandTotal: unitPrice * p.quantity + qc.rushPremium };
}
