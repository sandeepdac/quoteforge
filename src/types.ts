export type QuoteStatus = 'draft' | 'sent' | 'won' | 'lost' | 'expired';

export interface Material {
  id: string;
  name: string;
  pricePerKg: number;
  density: number; // kg/m3
  thicknessMm: number;
  lastPriceUpdate?: string; // ISO timestamp of the last price change
}

export interface PartFeatures {
  perimeterMm: number;
  pierceCount: number;
  bendCount: number;
  isSimpleBending: boolean;
  weldLengthMm: number;
  weldCount: number;
  holeCount: number;
  surfaceAreaM2: number;
  weightKg: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
}

export interface Part {
  id: string;
  name: string;
  materialId: string;
  thicknessMm: number;
  features: PartFeatures;
  thumbnail: string;
  lastQuotedDate?: string;
  quoteCount: number;
}

export interface Customer {
  id: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  terms: string;
  totalQuotes: number;
  wonQuotes: number;
  totalRevenue: number;
  lastQuoteDate?: string;
}

export interface Quote {
  id: string;
  quoteNumber: string;
  customerId: string;
  partId: string;
  status: QuoteStatus;
  createdDate: string;
  validUntilDate: string;
  quantity: number;
  leadTimeDays: number;
  shippingType: 'pickup' | 'ship';
  isRushOrder: boolean;
  marginPercent: number;
  notes: string;
  
  // Calculated values (cached)
  costs: QuoteCosts;
  totalUnitPrice: number;
  grandTotal: number;
  winProbability: number;
  lossReason?: 'Price too High' | 'Lead Time' | 'Lost to Competitor' | 'Project Cancelled';
  actualLeadTimeDays?: number;
  /** Recorded actual factory cost for a completed job — powers estimator-accuracy analytics. */
  actualCost?: number;
}

export interface QuoteCosts {
  materialCost: number;
  laserCost: number;
  bendCost: number;
  weldCost: number;
  assemblyCost: number;
  finishCost: number;
  subtotal: number;
  overhead: number;
  marginAmount: number;
  rushPremium: number;
}

/** One traceable line in a machining quote — links a cost to the geometry driver. */
export interface CostLineItem {
  key: string;
  name: string;
  /** Human-readable driver, e.g. "12.4 cm³ removed · brass @ 28 cm³/min". */
  driver: string;
  value: number;
  color: string;
}

/** Cost breakdown for a CNC-machined (subtractive) part. */
export interface MachiningCosts {
  stockCost: number;
  roughingCost: number;
  finishingCost: number;
  holeOpsCost: number;
  setupCost: number;
  inspectionCost: number;
  deburrCost: number;
  subtotal: number;
  overhead: number;
  marginAmount: number;
  rushPremium: number;
  /** Itemised lines (positive-cost only) for direct, traceable rendering. */
  lineItems: CostLineItem[];
  // --- measured metrics behind the numbers ---
  partVolumeCm3: number;
  stockVolumeCm3: number;
  removedVolumeCm3: number;
  /** part volume ÷ stock volume — the "buy-to-fly" material yield (0–1). */
  buyToFlyRatio: number;
  machineTimeMin: number;
  setups: number;
}

/** Shop rates/speeds for CNC machining (turning + milling). Advisory defaults. */
export interface CncSettings {
  /** Charge-out rate for spindle time. */
  machineRatePerMin: number;
  /** Charge-out rate for setup / load / offset time. */
  setupRatePerMin: number;
  /** Minutes per setup (fixturing, tool touch-off, first-off check). */
  setupTimeMin: number;
  /** Baseline roughing removal rate for MILD STEEL (cm³/min); scaled by machinability. */
  baseRemovalRateCm3PerMin: number;
  /** Baseline finishing rate for MILD STEEL (cm²/min of finished surface); scaled by machinability. */
  baseFinishingRateCm2PerMin: number;
  /** Minutes per hole (drill/bore); tapped holes add half again. */
  drillTimePerHoleMin: number;
  /** Machining stock allowance added to each face of a milled billet (mm). */
  millingStockAllowanceMm: number;
  /** Diameter allowance over the part ⌀ for round bar (mm). */
  turningStockAllowanceMm: number;
  /** Facing/parting allowance added to bar length (mm). */
  turningFacingAllowanceMm: number;
  /** Inspection: base minutes + minutes per hole. */
  inspectionBaseMin: number;
  inspectionPerHoleMin: number;
  /** Deburr: base minutes + minutes per hole. */
  deburrBaseMin: number;
  deburrPerHoleMin: number;
}

export interface ShopSettings {
  name: string;
  address: string;
  logo: string;
  rates: {
    laserPerMin: number;
    pressBrakePerMin: number;
    welderPerMin: number;
    assemblyPerMin: number;
    finishRatePerM2: number;
  };
  speeds: {
    laserCuttingMmPerMin: number;
    weldingMmPerMin: number;
    bendSetupMin: number;
    bendSimpleMin: number;
    bendCompoundMin: number;
  };
  overheadPercent: number;
  defaultMargin: number;
  rushPremiumPercent: number;
  scrapFactor: number;
  /** CNC machining rates/speeds. Optional so older persisted settings still load. */
  cnc?: CncSettings;
}
