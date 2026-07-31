import { PartFeatures, QuoteCosts, ShopSettings } from '../types';

export function calculateQuoteCosts(
  features: PartFeatures,
  quantity: number,
  isRush: boolean,
  marginPercent: number,
  materialPricePerKg: number,
  settings: ShopSettings
): QuoteCosts {
  const { rates, speeds, scrapFactor, overheadPercent, rushPremiumPercent } = settings;

  // Material cost
  const materialCost = features.weightKg * materialPricePerKg * (1 + scrapFactor);

  // Cutting cost (Laser)
  const laserCutTimeMin = (features.perimeterMm / speeds.laserCuttingMmPerMin) + (features.pierceCount * 0.5);
  const laserCost = laserCutTimeMin * rates.laserPerMin;

  // Bending cost
  const bendTimeMin = (features.bendCount * (features.isSimpleBending ? speeds.bendSimpleMin : speeds.bendCompoundMin)) + speeds.bendSetupMin;
  const bendCost = bendTimeMin * rates.pressBrakePerMin;

  // Welding cost
  const weldTimeMin = (features.weldLengthMm / speeds.weldingMmPerMin) + (features.weldCount * 2); // 2 min setup per weld joint
  const weldCost = weldTimeMin * rates.welderPerMin;

  // Assembly/handling (base handling + complexity)
  const baseHandling = 5; // $5 base
  const complexityFactor = 1.2;
  const assemblyCost = baseHandling + (complexityFactor * features.holeCount * rates.assemblyPerMin);

  // Finishing
  const finishCost = features.surfaceAreaM2 * rates.finishRatePerM2;

  // Totals
  const subtotal = materialCost + laserCost + bendCost + weldCost + assemblyCost + finishCost;
  const overhead = subtotal * overheadPercent;
  const marginAmount = (subtotal + overhead) * marginPercent;
  
  const unitPrice = subtotal + overhead + marginAmount;
  const quoteTotal = unitPrice * quantity;
  const rushPremium = isRush ? quoteTotal * rushPremiumPercent : 0;

  return {
    materialCost,
    laserCost,
    bendCost,
    weldCost,
    assemblyCost,
    finishCost,
    subtotal,
    overhead,
    marginAmount,
    rushPremium
  };
}

export function calculateWinProbability(margin: number, leadTime: number): number {
  // Simple mock logic: higher margin = lower probability, shorter lead time = higher probability
  let base = 90;
  base -= (margin * 100) * 1.2; // 25% margin -> 30% drop
  if (leadTime < 5) base += 5;
  if (leadTime > 14) base -= 10;
  
  return Math.min(Math.max(Math.floor(base), 5), 98);
}
