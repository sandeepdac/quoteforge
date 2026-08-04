/**
 * CNC machining cost model (SUBTRACTIVE).
 *
 * Unlike sheet-metal fabrication (cut a flat blank, then form it), machining
 * starts from a solid stock and removes material. The cost drivers are therefore
 * completely different:
 *
 *   • Stock      — you buy the whole billet / bar, then cut most of it into chips.
 *   • Roughing   — time to remove (stock − part) volume, at a rate set by the
 *                  material's machinability.
 *   • Finishing  — time proportional to the finished surface area.
 *   • Hole ops   — drilling / boring / tapping.
 *   • Setups     — each fixturing / re-orientation adds load + touch-off time.
 *   • Inspection & deburr.
 *
 * Every line is traceable to a measured driver (volume removed, surface area,
 * hole count, ⌀). Nothing is invented — if the geometry wasn't measured, the
 * caller shouldn't build a machining quote from it.
 */
import {
  CostLineItem,
  MachiningCosts,
  ShopSettings,
} from '../types';
import { DEFAULT_CNC_SETTINGS } from '../constants';
import { materialPropsFor } from './materials';
import { PartClass } from './partClass';

export interface MachiningInput {
  partClass: PartClass;
  materialName: string;
  /** Measured enclosed volume of the finished part. */
  volumeCm3: number;
  /** Measured wetted surface area of the finished part. */
  surfaceAreaCm2: number;
  boundingBoxMm: { lengthMm: number; widthMm: number; heightMm: number };
  /** For turned parts: round-bar ⌀ and length along the axis (from partClass). */
  diameterMm: number;
  axisLengthMm: number;
  holeCount: number;
  holeDetails: Array<{ diameterMm: number; count: number }>;
  /** Number of machine setups (fixturings / re-orientations). */
  setups: number;
  /** Material $/kg. */
  materialPricePerKg: number;
}

const COLORS = {
  stock: '#0891b2',
  roughing: '#2563eb',
  finishing: '#3b82f6',
  holes: '#8b5cf6',
  setup: '#f59e0b',
  inspection: '#a78bfa',
  deburr: '#93c5fd',
};

const cm3 = (v: number) => Math.round(v * 10) / 10;

/**
 * Compute the raw stock volume (cm³) the part is machined from.
 *   • turned → round bar: (⌀ + allowance)² and (length + facing allowance)
 *   • milled → rectangular billet: each face grown by the machining allowance
 */
export function stockVolumeCm3(input: MachiningInput, cnc = DEFAULT_CNC_SETTINGS): number {
  if (input.partClass === 'turned' && input.diameterMm > 0 && input.axisLengthMm > 0) {
    const barDia = input.diameterMm + cnc.turningStockAllowanceMm;
    const barLen = input.axisLengthMm + cnc.turningFacingAllowanceMm;
    return (Math.PI / 4) * barDia * barDia * barLen / 1000;
  }
  const a = cnc.millingStockAllowanceMm * 2;
  const { lengthMm, widthMm, heightMm } = input.boundingBoxMm;
  return ((lengthMm + a) * (widthMm + a) * (heightMm + a)) / 1000;
}

export function calculateMachiningCosts(
  input: MachiningInput,
  quantity: number,
  isRush: boolean,
  marginPercent: number,
  settings: ShopSettings
): MachiningCosts {
  const cnc = settings.cnc ?? DEFAULT_CNC_SETTINGS;
  const { overheadPercent, rushPremiumPercent, scrapFactor } = settings;
  const mat = materialPropsFor(input.materialName);

  // --- Stock ---------------------------------------------------------------
  const stockVol = stockVolumeCm3(input, cnc);
  const partVol = Math.max(0, input.volumeCm3);
  const removedVol = Math.max(0, stockVol - partVol);
  const stockWeightKg = (stockVol * mat.densityGCm3) / 1000;
  const stockCost = stockWeightKg * input.materialPricePerKg * (1 + scrapFactor);

  // --- Roughing (material removal) -----------------------------------------
  // Removal rate scales with machinability (brass/aluminium fast, Ti/SS slow).
  const removalRate = cnc.baseRemovalRateCm3PerMin * mat.machinability;
  const roughingMin = removalRate > 0 ? removedVol / removalRate : 0;
  const roughingCost = roughingMin * cnc.machineRatePerMin;

  // --- Finishing (surface area) --------------------------------------------
  const finishRate = cnc.baseFinishingRateCm2PerMin * mat.machinability;
  const finishingMin = finishRate > 0 ? input.surfaceAreaCm2 / finishRate : 0;
  const finishingCost = finishingMin * cnc.machineRatePerMin;

  // --- Hole / bore ops -----------------------------------------------------
  const holeMin = input.holeCount * cnc.drillTimePerHoleMin;
  const holeOpsCost = holeMin * cnc.machineRatePerMin;

  // --- Setups --------------------------------------------------------------
  const setups = Math.max(1, Math.round(input.setups || 1));
  const setupMin = setups * cnc.setupTimeMin;
  const setupCost = setupMin * cnc.setupRatePerMin;

  // --- Inspection & deburr -------------------------------------------------
  const inspectionMin = cnc.inspectionBaseMin + input.holeCount * cnc.inspectionPerHoleMin;
  const inspectionCost = inspectionMin * cnc.setupRatePerMin;
  const deburrMin = cnc.deburrBaseMin + input.holeCount * cnc.deburrPerHoleMin;
  const deburrCost = deburrMin * cnc.setupRatePerMin;

  const machineTimeMin = roughingMin + finishingMin + holeMin;

  // --- Roll-up -------------------------------------------------------------
  const subtotal =
    stockCost + roughingCost + finishingCost + holeOpsCost + setupCost + inspectionCost + deburrCost;
  const overhead = subtotal * overheadPercent;
  const marginAmount = (subtotal + overhead) * marginPercent;
  const unitPrice = subtotal + overhead + marginAmount;
  const quoteTotal = unitPrice * quantity;
  const rushPremium = isRush ? quoteTotal * rushPremiumPercent : 0;

  const buyToFlyRatio = stockVol > 0 ? partVol / stockVol : 0;

  const holeSummary = input.holeDetails.length
    ? input.holeDetails.map((h) => `${h.count}×⌀${h.diameterMm}`).join(', ')
    : `${input.holeCount} holes`;

  const lineItems: CostLineItem[] = [
    {
      key: 'stock',
      name: input.partClass === 'turned' ? 'Bar stock' : 'Billet stock',
      driver: `${cm3(stockVol)} cm³ ${mat.label} (${stockWeightKg.toFixed(2)} kg @ $${input.materialPricePerKg.toFixed(2)}/kg)`,
      value: stockCost,
      color: COLORS.stock,
    },
    {
      key: 'roughing',
      name: 'Roughing (material removal)',
      driver: `${cm3(removedVol)} cm³ removed · ${mat.label} @ ${removalRate.toFixed(0)} cm³/min`,
      value: roughingCost,
      color: COLORS.roughing,
    },
    {
      key: 'finishing',
      name: 'Finishing passes',
      driver: `${cm3(input.surfaceAreaCm2)} cm² surface @ ${finishRate.toFixed(0)} cm²/min`,
      value: finishingCost,
      color: COLORS.finishing,
    },
    {
      key: 'holes',
      name: 'Drilling / boring',
      driver: holeSummary,
      value: holeOpsCost,
      color: COLORS.holes,
    },
    {
      key: 'setup',
      name: 'Setups',
      driver: `${setups} setup${setups > 1 ? 's' : ''} × ${cnc.setupTimeMin} min`,
      value: setupCost,
      color: COLORS.setup,
    },
    {
      key: 'inspection',
      name: 'Inspection',
      driver: `${inspectionMin.toFixed(1)} min (first-off + ${input.holeCount} features)`,
      value: inspectionCost,
      color: COLORS.inspection,
    },
    {
      key: 'deburr',
      name: 'Deburr / clean',
      driver: `${deburrMin.toFixed(1)} min`,
      value: deburrCost,
      color: COLORS.deburr,
    },
  ].filter((li) => li.value > 0.005);

  return {
    stockCost,
    roughingCost,
    finishingCost,
    holeOpsCost,
    setupCost,
    inspectionCost,
    deburrCost,
    subtotal,
    overhead,
    marginAmount,
    rushPremium,
    lineItems,
    partVolumeCm3: cm3(partVol),
    stockVolumeCm3: cm3(stockVol),
    removedVolumeCm3: cm3(removedVol),
    buyToFlyRatio: Math.round(buyToFlyRatio * 100) / 100,
    machineTimeMin: Math.round(machineTimeMin * 10) / 10,
    setups,
  };
}
