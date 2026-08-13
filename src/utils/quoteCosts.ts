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
import type { ExtractedCadAnalysis } from './cadAnalyzer';

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
  const rateMult = cadAnalysis?.machineRecommendation?.rateMultiplier ?? 1;
  const density = materialPropsFor(p.materialName).densityGCm3;

  if (isTurnedPart && cadAnalysis?.turningProfile) {
    const volumeCm3 = f.weightKg > 0 ? (f.weightKg * 1000) / density : cadAnalysis.volumeCm3 ?? 0;
    const mc = calculateMachiningCosts(
      { isTurned: true, materialName: p.materialName, volumeCm3, profile: cadAnalysis.turningProfile, setups: cadAnalysis.setups ?? 1, materialPricePerKg: p.materialPricePerKg },
      p.quantity, p.isRush, p.margin, settings, rateMult
    );
    const unitPrice = mc.subtotal + mc.overhead + mc.marginAmount;
    return { costs: machiningToQuoteCosts(mc), lineItems: mc.lineItems, unitPrice, grandTotal: unitPrice * p.quantity + mc.rushPremium, machiningCosts: mc, machineClass: mc.machineClass ?? 'turn' };
  }

  if (isMilledPart && cadAnalysis?.milledProfile) {
    const base = cadAnalysis.milledProfile;
    const partVolumeCm3 = f.weightKg > 0 ? (f.weightKg * 1000) / density : base.partVolumeCm3;
    const profile = { ...base, partVolumeCm3, removedVolumeCm3: Math.max(0, base.stockVolumeCm3 - partVolumeCm3) };
    const mc = calculateMilledCosts(
      { materialName: p.materialName, profile, materialPricePerKg: p.materialPricePerKg },
      p.quantity, p.isRush, p.margin, settings, rateMult
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
