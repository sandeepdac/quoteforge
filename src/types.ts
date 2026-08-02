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
}
