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
  /** Set for CNC machining quotes so the detail view labels the breakdown correctly. */
  machineClass?: 'turn' | 'mill';
  /** Full machining cost breakdown (cycle-time model) when this is a machining quote. */
  machiningCosts?: MachiningCosts;
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

/** Per-part price at a given batch quantity (setup amortised over the batch). */
export interface BatchPricePoint {
  quantity: number;
  unitPrice: number;
  /** Setup portion of the unit price at this quantity (for the curve annotation). */
  setupPerUnit: number;
}

/**
 * Cost breakdown for a TURNED part, driven by cycle time.
 * The op-level detail (facing/rough/finish/drill/…) lives in `lineItems`.
 */
export interface MachiningCosts {
  materialCost: number;
  machineCost: number;
  setupCost: number;
  toolingCost: number;
  subtotal: number;
  overhead: number;
  marginAmount: number;
  rushPremium: number;
  /** Itemised lines (positive-cost only), each with a time/geometry driver. */
  lineItems: CostLineItem[];
  // --- metrics behind the numbers ---
  partVolumeCm3: number;
  stockVolumeCm3: number;
  removedVolumeCm3: number;
  /** part volume ÷ stock volume — "buy-to-fly" material yield (0–1). */
  buyToFlyRatio: number;
  /** Standard bar diameter selected (mm). */
  barDiameterMm: number;
  /** Per-part cycle time (spindle + air), after the efficiency factor (s). */
  cycleTimeSec: number;
  /** Total setup time for the job (min), amortised over the batch. */
  setupTimeMin: number;
  setups: number;
  efficiencyFactor: number;
  /** Price per part across standard batch sizes (setup amortisation curve). */
  batchCurve: BatchPricePoint[];
  // --- milled-part metadata (present when machineClass === 'mill') ---
  /** Which machining route this quote costed. */
  machineClass?: 'turn' | 'mill';
  /** Billet stock dimensions (mm) for a milled part. */
  stockMm?: { x: number; y: number; z: number };
  pocketCount?: number;
  bossCount?: number;
  deepPocketCount?: number;
  holeCount?: number;
}

/**
 * Shop rates/speeds for CNC TURNING. Advisory defaults; the efficiency factor
 * is the primary calibration control.
 */
/** The turning operations the reference toolpath expands, in machining order. */
export type TurningOp = 'face' | 'rough' | 'drill' | 'finish' | 'partoff';

/**
 * One entry in the shop's turning tool library — maps an operation to the real
 * turret station and tool the shop runs, so the reference G-code and preview
 * reflect *this* shop's tooling rather than a generic assumption.
 */
export interface ShopTool {
  op: TurningOp;
  /** Turret station + offset call, e.g. "T0101". */
  station: string;
  /** Tool / insert description, e.g. "DCLNR 2020 + CNMG 120408-PM". */
  description: string;
  /** Insert nose radius (mm), optional. */
  noseRadiusMm?: number;
}

export interface CncSettings {
  /** Charge-out for spindle time (per minute). */
  machineRatePerMin: number;
  /** Charge-out for setup labour (per minute). */
  setupRatePerMin: number;
  /** Baseline first-op setup (min): fixturing, tool touch-off, first-off check. */
  setupTimeFirstOpMin: number;
  /** Added setup per distinct tool (min). */
  setupTimePerToolMin: number;
  /** Added setup for a second op (back-face / turn-around) (min). */
  secondOpSetupMin: number;
  /**
   * Shop efficiency factor (0.6–1.0). actual_time = theoretical_time / factor.
   * The single most important calibration parameter — expose it prominently.
   */
  efficiencyFactor: number;
  /** Spindle rpm ceiling. */
  maxRpm: number;
  /** Turret index / tool-change time (s each). */
  toolChangeSec: number;
  /** Load / unload / bar-feed time per part (s). */
  barLoadSec: number;
  /** Consumable tooling allowance per operation. */
  toolingCostPerOp: number;
  /** Radial stock allowance over the OD before choosing the next standard bar (mm). */
  radialStockAllowanceMm: number;
  /** Extra bar length for facing both ends (mm). */
  facingAllowanceMm: number;
  /** Material lost to the parting tool (mm). */
  partingWidthMm: number;
  /** Bar length held in the collet / lost to grip (mm). */
  gripLengthMm: number;
  /** Fraction of swarf value recovered (0–1). */
  scrapRecovery: number;
  /** Shop turning tool library — drives the reference toolpath's stations/tools. */
  toolLibrary?: ShopTool[];
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
