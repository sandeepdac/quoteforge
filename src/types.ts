import type { ExtractedCadAnalysis } from './utils/cadAnalyzer';
import type { MachineId } from './utils/machineSelection';

export type QuoteStatus = 'draft' | 'sent' | 'won' | 'lost' | 'expired';

/** One entry in a quote's edit history. */
export interface QuoteRevision {
  /** ISO timestamp of the change. */
  at: string;
  /** Human-readable summary of what changed. */
  summary: string;
  unitPrice: number;
  grandTotal: number;
}

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
  /** Edit history (newest last). Seeded on creation, appended on each edit. */
  revisions?: QuoteRevision[];
  /**
   * CAD extraction persisted so the quote can be re-opened for editing with its
   * features, strategy and cost intact. The heavy tessellated mesh / raw STEP
   * data are stripped before saving (localStorage-friendly), so the live 3D
   * viewer needs the file re-uploaded; everything else restores.
   */
  cadAnalysis?: ExtractedCadAnalysis;
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
  /** Reorder price — one-time NRE (CAM programming + fixturing) already paid. */
  repeatUnitPrice: number;
}

/** One cutting operation inside a setup, as an operator would read a job sheet. */
export interface PlanOperation {
  /** Facing / Roughing / Finishing / Drilling … */
  name: string;
  /** The cutter this op runs, e.g. `12 mm 3F flat end mill`. */
  tool: string;
  /** Estimated time for this op (s), after the efficiency factor. */
  seconds: number;
  /** Machine cost of this op. */
  cost: number;
  /** What drives the time — the number this op was computed from. */
  driver: string;
  /** Chart/legend colour, shared with the cost line items. */
  color: string;
}

/** A single machine setup: one fixturing of the part, with its operations. */
export interface PlanSetup {
  /** 1-based setup number. */
  index: number;
  name: string;
  /** Which way the part is presented to the spindle, when known. */
  orientation?: string;
  operations: PlanOperation[];
  /** Cutting + tool-change seconds in this setup. */
  seconds: number;
  cost: number;
  /** Tool changes attributed to this setup. */
  toolChanges: number;
}

/**
 * A per-setup, per-operation view of the estimate — the same totals as
 * `lineItems`, regrouped the way a machinist reads a job: Setup 1 → its ops →
 * Setup 2 → its ops. Advisory: the split across setups is inferred from the
 * geometry, not from a posted toolpath.
 */
export interface MachiningPlan {
  setups: PlanSetup[];
  /** Distinct cutters across the whole job. */
  tools: Array<{ name: string; ops: number; seconds: number }>;
  totalSeconds: number;
  totalCost: number;
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
  /** True when the part is too sparse for a solid billet, so material + roughing
   * were priced on an assumed near-net stock (capped yield) rather than the block. */
  nearNetStock?: boolean;
  /** Standard bar diameter selected (mm). */
  barDiameterMm: number;
  /** Per-part cycle time (spindle + air), after the efficiency factor (s). */
  cycleTimeSec: number;
  /** Total setup time for the job (min), amortised over the batch. */
  setupTimeMin: number;
  setups: number;
  /** One-time NRE for the job (CAM programming + soft jaws/fixture), not per part. */
  nreCost: number;
  /** Per-part price on a REORDER (NRE already paid) at the quoted quantity. */
  repeatUnitPrice: number;
  efficiencyFactor: number;
  /** Price per part across standard batch sizes (setup amortisation curve). */
  batchCurve: BatchPricePoint[];
  /** Per-setup / per-operation view of the same cycle time (milled parts). */
  plan?: MachiningPlan;
  // --- milled-part metadata (present when machineClass === 'mill') ---
  /** Which machining route this quote costed. */
  machineClass?: 'turn' | 'mill';
  /** Billet stock dimensions (mm) for a milled part. */
  stockMm?: { x: number; y: number; z: number };
  /** True when a milled part is cut from ROUND BAR on a turn-mill (one op) rather
   *  than a rectangular billet — `barDiameterMm` then holds the bar size. */
  fromBarStock?: boolean;
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
export type TurningOp = 'face' | 'rough' | 'drill' | 'bore' | 'finish' | 'partoff';

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
   * Optional FLAT charge per setup (currency). Reference CAM quotes bill a fixed
   * sum per setup (e.g. $150/setup). 0 = off (default), amortised over the batch
   * like the rest of setup. How it combines with the time-based cost is set by
   * `setupBillingMode`.
   */
  flatSetupChargePerSetup?: number;
  /**
   * How setup is billed:
   *  • 'time'  — time-based labour only (the flat charge is ignored).
   *  • 'flat'  — the flat per-setup charge only (replaces time labour; matches how
   *              CAM quotes bill a fixed Setup Charge per setup).
   *  • 'both'  — time labour + the flat charge (default).
   */
  setupBillingMode?: 'time' | 'flat' | 'both';
  /**
   * Shop efficiency factor (0.6–1.0). actual_time = theoretical_time / factor.
   * The single most important calibration parameter — expose it prominently.
   */
  efficiencyFactor: number;
  /**
   * Client-facing feedrate override (%), mirroring a CAM estimator's "Feedrate
   * Ratio". 100 = run cutting at the programmed feed (default); below 100 runs
   * slower (more cutting time), above 100 faster. Scales CUTTING time only —
   * tool changes, rapids and setup are unaffected.
   */
  feedrateRatioPercent?: number;
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
  /** Largest hole drillable from solid (mm). Bigger bores are drilled + bored out. */
  maxDrillDiaMm?: number;
  // --- milling-specific (the turning values above describe a lathe) ---------
  /** Milling spindle rpm ceiling — a VMC spins far faster than a bar lathe. */
  millMaxRpm?: number;
  /** Roughing end-mill ⌀ (mm) assumed for milling MRR. */
  millToolDiaMm?: number;
  /** ATC tool-change time (s) — slower than a lathe turret index. */
  millToolChangeSec?: number;
  /**
   * One-time CAM programming time per setup (min). This is NRE — writing and
   * proving the toolpaths is done once for the part design and does NOT recur on
   * a reorder. Amortised over the first batch; excluded from the repeat price.
   */
  programmingMinPerSetup?: number;
  /** Baseline setup time for a milled op (min): vise/soft jaws, tram, probe, touch-off. */
  millSetupFirstOpMin?: number;
  /** Added setup per extra milled setup (min) — re-fixture and re-probe. */
  millSetupPerExtraOpMin?: number;
  /** Fraction of swarf value recovered (0–1). */
  scrapRecovery: number;
  /** Shop turning tool library — drives the reference toolpath's stations/tools. */
  toolLibrary?: ShopTool[];
  /**
   * Machines the shop actually owns. Machine selection compares only these when
   * choosing the best route for a part (e.g. a 5-axis mill vs a 5-axis turn-mill).
   * Omitted / empty → the whole catalog is considered (back-compat default).
   */
  machines?: MachineId[];
}

export type SecondaryCategory =
  | 'plating'
  | 'anodize'
  | 'coating'
  | 'passivate'
  | 'heattreat'
  | 'inspection'
  | 'other';

/**
 * A non-machining work centre a job passes through after the mill/lathe:
 * subcontract finishing (plating, anodise, coating, heat-treat) or inspection.
 * Billed as a one-time lot charge (amortised over the batch) plus a per-part cost.
 */
export interface SecondaryOperation {
  id: string;
  name: string;
  category: SecondaryCategory;
  /** One-time charge per batch (subcon minimum / lot fee); amortised over qty. */
  lotCharge: number;
  /** Cost per part. */
  perPartCost: number;
  /** Informational turnaround (days). */
  leadTimeDays?: number;
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
  /** ISO 4217 currency code the shop quotes in (e.g. 'USD', 'EUR', 'GBP'). */
  currency?: string;
  /** Shop catalogue of secondary operations (finishing / inspection). */
  secondaryOps?: SecondaryOperation[];
  /** CNC machining rates/speeds. Optional so older persisted settings still load. */
  cnc?: CncSettings;
}
