import React, { useMemo } from 'react';
import { 
  Users, 
  Truck, 
  Package, 
  Clock, 
  ArrowRight,
  TrendingUp,
  AlertTriangle,
  PieChart as PieChartIcon
} from 'lucide-react';
import { useQuotes } from '../../context/QuoteContext';
import { useSettings } from '../../context/SettingsContext';
import { calculateQuoteCosts } from '../../utils/estimator';
import { calculateMachiningCosts } from '../../utils/cncEstimator';
import { calculateMilledCosts } from '../../utils/milledEstimator';
import { materialPropsFor } from '../../utils/materials';
import { ExtractedCadAnalysis } from '../../utils/cadAnalyzer';
import { CostLineItem, MachiningCosts, PartFeatures } from '../../types';
import { cn } from '../../utils/cn';
import { currencySymbol } from '../../utils/currency';

interface StepQuantityProps {
  data: any;
  cadAnalysis?: ExtractedCadAnalysis;
  onContinue: (config: any) => void;
  onBack: () => void;
  onUpdate: (data: any) => void;
}

export default function StepQuantity({ data, cadAnalysis, onContinue, onBack, onUpdate }: StepQuantityProps) {
  const { customers, materials } = useQuotes();
  const { settings, updateSettings } = useSettings();
  const efficiency = settings.cnc?.efficiencyFactor ?? 0.8;

  const currentMaterial = materials.find(m => m.id === data.features.materialId) || materials[0];

  const f = data.features as PartFeatures;
  // A machined solid was measured → price it from cycle time. Turned parts use the
  // turning model; milled/prismatic parts use the milling model (the 3 AAG rules).
  const isTurnedPart = !!(cadAnalysis?.isTurned && cadAnalysis?.turningProfile);
  const isMilledPart = !!(cadAnalysis?.milledProfile && !cadAnalysis?.isTurned);
  const isMachining = isTurnedPart || isMilledPart;
  const sym = currencySymbol(settings.currency);

  const { costs, lineItems } = useMemo(() => {
    if (isTurnedPart && cadAnalysis?.turningProfile) {
      // Respect user edits: derive volume from the (possibly edited) weight so
      // tweaks in the extraction step flow into the cycle-time price.
      const density = materialPropsFor(currentMaterial.name).densityGCm3;
      const volumeCm3 = f.weightKg > 0 ? (f.weightKg * 1000) / density : cadAnalysis.volumeCm3 ?? 0;
      const mc = calculateMachiningCosts(
        {
          isTurned: true,
          materialName: currentMaterial.name,
          volumeCm3,
          profile: cadAnalysis.turningProfile,
          setups: cadAnalysis.setups ?? 1,
          materialPricePerKg: currentMaterial.pricePerKg,
        },
        data.config.quantity,
        data.config.isRush,
        settings.defaultMargin,
        settings,
        cadAnalysis.machineRecommendation?.rateMultiplier ?? 1
      );
      return { costs: mc, lineItems: mc.lineItems };
    }

    if (isMilledPart && cadAnalysis?.milledProfile) {
      // Respect edits: recompute part/removed volume from the (possibly edited) weight.
      const density = materialPropsFor(currentMaterial.name).densityGCm3;
      const base = cadAnalysis.milledProfile;
      const partVolumeCm3 = f.weightKg > 0 ? (f.weightKg * 1000) / density : base.partVolumeCm3;
      const profile = {
        ...base,
        partVolumeCm3,
        removedVolumeCm3: Math.max(0, base.stockVolumeCm3 - partVolumeCm3),
      };
      const mc = calculateMilledCosts(
        { materialName: currentMaterial.name, profile, materialPricePerKg: currentMaterial.pricePerKg },
        data.config.quantity,
        data.config.isRush,
        settings.defaultMargin,
        settings,
        cadAnalysis.machineRecommendation?.rateMultiplier ?? 1
      );
      return { costs: mc, lineItems: mc.lineItems };
    }

    const qc = calculateQuoteCosts(
      f,
      data.config.quantity,
      data.config.isRush,
      settings.defaultMargin,
      currentMaterial.pricePerKg,
      settings
    );
    // Each process cost tied back to the measured feature that drives it.
    const items: CostLineItem[] = [
      { key: 'material', name: 'Material', driver: `${f.weightKg} kg × ${sym}${currentMaterial.pricePerKg.toFixed(2)}/kg (+${(settings.scrapFactor * 100).toFixed(0)}% scrap)`, value: qc.materialCost, color: '#2563eb' },
      { key: 'laser', name: 'Laser cutting', driver: `${Math.round(f.perimeterMm)} mm cut path · ${f.pierceCount} pierces`, value: qc.laserCost, color: '#3b82f6' },
      { key: 'bending', name: 'Press brake', driver: f.bendCount > 0 ? `${f.bendCount} bend${f.bendCount > 1 ? 's' : ''} (${f.isSimpleBending ? 'simple' : 'compound'}) + setup` : 'no bends', value: qc.bendCost, color: '#60a5fa' },
      { key: 'welding', name: 'Welding', driver: `${Math.round(f.weldLengthMm)} mm · ${f.weldCount} joint${f.weldCount === 1 ? '' : 's'}`, value: qc.weldCost, color: '#8b5cf6' },
      { key: 'handling', name: 'Handling / assembly', driver: `${f.holeCount} hole${f.holeCount === 1 ? '' : 's'} + base handling`, value: qc.assemblyCost, color: '#a78bfa' },
      { key: 'finish', name: 'Finishing', driver: `${f.surfaceAreaM2.toFixed(3)} m² surface`, value: qc.finishCost, color: '#93c5fd' },
    ].filter((li) => li.value > 0.005);
    return { costs: qc, lineItems: items };
  }, [data, settings, currentMaterial, isTurnedPart, isMilledPart, cadAnalysis, f]);

  const unitPrice = costs.subtotal + costs.overhead + costs.marginAmount;
  const grandTotal = (unitPrice * data.config.quantity) + costs.rushPremium;

  const maxItem = Math.max(...lineItems.map((li) => li.value), 0.0001);
  const mc = isMachining ? (costs as MachiningCosts) : null;
  const fmt = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const quantityPresets = [1, 10, 50, 100, 500];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Left Column: Inputs */}
      <div className="lg:col-span-2 space-y-6 animate-in slide-in-from-left-4 duration-500">
        <div className="space-y-6">
          <h2 className="text-xl font-semibold">Quantity & Logistics</h2>
          
          <div className="space-y-4">
            <div className="space-y-3">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Quantity</label>
              <div className="flex flex-wrap gap-2">
                {quantityPresets.map(q => (
                  <button
                    key={q}
                    onClick={() => onUpdate({ ...data, config: { ...data.config, quantity: q }})}
                    className={cn(
                      "px-4 py-2 rounded-md text-sm font-medium border transition-all",
                      data.config.quantity === q 
                        ? "bg-primary border-primary text-primary-foreground shadow-sm" 
                        : "bg-background border-border text-muted-foreground hover:border-primary/50"
                    )}
                  >
                    {q}
                  </button>
                ))}
                <div className="flex-1 min-w-[120px]">
                  <input 
                    type="number" 
                    placeholder="Custom" 
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm h-full"
                    value={data.config.quantity}
                    onChange={(e) => onUpdate({ ...data, config: { ...data.config, quantity: Number(e.target.value) }})}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Customer</label>
                <div className="relative">
                  <Users className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                  <select 
                    className="w-full bg-background border border-border rounded-md pl-10 pr-4 py-2 text-sm appearance-none"
                    value={data.config.customerId}
                    onChange={(e) => onUpdate({ ...data, config: { ...data.config, customerId: e.target.value }})}
                  >
                    <option value="">Select a customer</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" size={14} />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Lead Time (Days)</label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                  <input 
                    type="number" 
                    className="w-full bg-background border border-border rounded-md pl-10 pr-4 py-2 text-sm"
                    value={data.config.leadTimeDays}
                    onChange={(e) => onUpdate({ ...data, config: { ...data.config, leadTimeDays: Number(e.target.value) }})}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Delivery Method</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => onUpdate({ ...data, config: { ...data.config, shippingType: 'pickup' }})}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm border",
                      data.config.shippingType === 'pickup' ? "bg-accent border-primary text-primary" : "border-border text-muted-foreground"
                    )}
                  >
                    <Package size={16} /> Pickup
                  </button>
                  <button
                    onClick={() => onUpdate({ ...data, config: { ...data.config, shippingType: 'ship' }})}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm border",
                      data.config.shippingType === 'ship' ? "bg-accent border-primary text-primary" : "border-border text-muted-foreground"
                    )}
                  >
                    <Truck size={16} /> Ship
                  </button>
                </div>
              </div>
              <div className="space-y-1.5 flex flex-col justify-end">
                <div className="flex items-center justify-between p-2.5 bg-card border border-border rounded-md">
                  <div className="flex items-center gap-2">
                    <TrendingUp className={cn("text-muted-foreground transition-colors", data.config.isRush && "text-orange-500")} size={16} />
                    <span className="text-sm font-medium">Rush Order</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer"
                      checked={data.config.isRush}
                      onChange={(e) => onUpdate({ ...data, config: { ...data.config, isRush: e.target.checked }})}
                    />
                    <div className="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center pt-4">
          <button
            onClick={onBack}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Back to extraction
          </button>
          <button 
            onClick={() => onContinue(data.config)}
            disabled={!data.config.customerId}
            className="bg-primary text-primary-foreground px-10 py-2.5 rounded-md text-sm font-medium hover:bg-primary/90 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary flex items-center gap-2"
          >
            Review Quote <ArrowRight size={18} />
          </button>
        </div>
      </div>

      {/* Right Column: Live Preview */}
      <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
        <div className="bg-card border border-border rounded-xl shadow-lg border-t-4 border-t-primary p-6 sticky top-24">
          <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-6">Quote Preview</h3>
          
          <div className="space-y-6">
            <div className="flex justify-between items-end border-b border-border pb-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Unit Price</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold">{sym}{unitPrice.toFixed(2)}</span>
                  <span className="text-xs text-muted-foreground">/ ea</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Quantity</p>
                <p className="text-lg font-medium">{data.config.quantity}</p>
              </div>
            </div>

            {/* Itemized cost breakdown — each process tied to the measured geometry */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <PieChartIcon size={14} /> Cost Breakdown <span className="normal-case font-normal text-muted-foreground/70">/ unit</span>
              </h4>
              <div className="space-y-2.5">
                {lineItems.map((li) => (
                  <div key={li.key} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: li.color }}></span>
                        <span className="text-sm font-medium text-foreground truncate">{li.name}</span>
                      </div>
                      <span className="text-sm font-semibold text-foreground tabular-nums">{sym}{fmt(li.value)}</span>
                    </div>
                    <div className="flex items-center gap-2 pl-4">
                      <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(li.value / maxItem) * 100}%`, backgroundColor: li.color }}></div>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">{Math.round((li.value / costs.subtotal) * 100)}%</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground/80 pl-4 leading-tight">{li.driver}</p>
                  </div>
                ))}
              </div>
              {mc && cadAnalysis && (
                <div className="rounded-md border border-border bg-muted/40 p-2.5 space-y-1">
                  {cadAnalysis.machineRecommendation && (
                    <div className="flex items-center justify-between text-[11px] pb-1 mb-1 border-b border-border/60">
                      <span className="text-muted-foreground">Machine</span>
                      <span className="font-semibold text-foreground text-right">{cadAnalysis.machineRecommendation.recommendedName}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">
                      {cadAnalysis.partClass === 'turned'
                        ? `Turned from ⌀${cadAnalysis.diameterMm} bar`
                        : mc.stockMm
                          ? `Milled from ${mc.stockMm.x}×${mc.stockMm.y}×${mc.stockMm.z} billet`
                          : 'Milled from billet'}
                    </span>
                    <span className="font-semibold text-foreground">
                      {Math.round(mc.buyToFlyRatio * 100)}% material yield
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full', mc.buyToFlyRatio < 0.15 ? 'bg-amber-500' : 'bg-emerald-500')}
                        style={{ width: `${Math.max(3, Math.min(100, mc.buyToFlyRatio * 100))}%` }}
                      ></div>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground/80 leading-tight">
                    {mc.machineClass === 'mill'
                      ? `~${mc.cycleTimeSec}s cycle · ${mc.removedVolumeCm3} cm³ removed from ${mc.stockVolumeCm3} cm³ billet · ${mc.setups} setup${mc.setups > 1 ? 's' : ''} · ${mc.pocketCount ?? 0} pocket${(mc.pocketCount ?? 0) === 1 ? '' : 's'}${(mc.deepPocketCount ?? 0) > 0 ? ` (${mc.deepPocketCount} deep)` : ''} · ${mc.holeCount ?? 0} hole${(mc.holeCount ?? 0) === 1 ? '' : 's'}`
                      : `~${mc.cycleTimeSec}s cycle · ${mc.removedVolumeCm3} cm³ removed from ${mc.stockVolumeCm3} cm³ bar · ${mc.setups} setup${mc.setups > 1 ? 's' : ''} · buy-to-fly`}
                  </p>
                </div>
              )}
              {cadAnalysis?.formedPart && (
                <div className="flex gap-2 bg-amber-500/10 border border-amber-500/30 rounded-md p-2.5">
                  <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Formed part: laser &amp; finishing are measured from the <strong className="text-foreground">folded shape</strong> and
                    under-estimate the flat-blank cut. Upload the flat DXF/drawing for an accurate cut cost.
                  </p>
                </div>
              )}
            </div>

            {/* Efficiency factor — the primary calibration control (live recalc) */}
            {mc && (
              <div className="space-y-2 border-t border-border pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Shop efficiency</span>
                  <span className="text-sm font-bold text-primary tabular-nums">{Math.round(efficiency * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.6}
                  max={1.0}
                  step={0.05}
                  value={efficiency}
                  onChange={(e) => updateSettings({ cnc: { ...settings.cnc!, efficiencyFactor: Number(e.target.value) } })}
                  className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                />
                <p className="text-[10px] text-muted-foreground/80 leading-tight">
                  Calibrate to a job you know: actual time = book time ÷ efficiency. Every quote recalculates live.
                  Current cycle ~{mc.cycleTimeSec}s.
                </p>
              </div>
            )}

            {/* Batch quantity curve — setup amortisation */}
            {mc && (
              <div className="space-y-2 border-t border-border pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Price per part by quantity</span>
                  <span className="text-[10px] text-muted-foreground flex items-center gap-3">
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-primary" /> First order</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-emerald-500" /> Repeat</span>
                  </span>
                </div>
                <div className="space-y-1.5">
                  {mc.batchCurve.map((pt) => {
                    const maxUp = Math.max(...mc.batchCurve.map((p) => p.unitPrice), 0.0001);
                    const isCurrent = pt.quantity === data.config.quantity;
                    const hasRepeatGap = pt.repeatUnitPrice < pt.unitPrice - 0.01;
                    return (
                      <div key={pt.quantity} className="flex items-center gap-2">
                        <span className={cn('text-[10px] w-8 tabular-nums shrink-0', isCurrent ? 'font-bold text-primary' : 'text-muted-foreground')}>×{pt.quantity}</span>
                        <div className="flex-1 h-3 bg-muted rounded overflow-hidden relative">
                          <div className={cn('h-full rounded', isCurrent ? 'bg-primary' : 'bg-primary/40')} style={{ width: `${(pt.unitPrice / maxUp) * 100}%` }}></div>
                          {hasRepeatGap && (
                            <div className="absolute top-0 h-full w-0.5 bg-emerald-500" style={{ left: `${(pt.repeatUnitPrice / maxUp) * 100}%` }} title={`Repeat order: ${sym}${fmt(pt.repeatUnitPrice)}`}></div>
                          )}
                        </div>
                        <span className={cn('text-[10px] w-14 text-right tabular-nums shrink-0', isCurrent ? 'font-bold text-foreground' : 'text-muted-foreground')}>{sym}{fmt(pt.unitPrice)}</span>
                        <span className="text-[10px] w-14 text-right tabular-nums shrink-0 text-emerald-600 dark:text-emerald-400">{hasRepeatGap ? `${sym}${fmt(pt.repeatUnitPrice)}` : '—'}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground/80 leading-tight">
                  Setup ({mc.setupTimeMin} min) amortises over the batch. <strong className="text-foreground">First order</strong> carries the one-time
                  NRE (CAM programming{mc.machineClass === 'mill' ? ' + soft jaws' : ''}, {sym}{fmt(mc.nreCost)}); the <strong className="text-emerald-600 dark:text-emerald-400">repeat</strong> price drops it.
                </p>
              </div>
            )}

            {/* Roll-up to the unit price */}
            <div className="space-y-2 border-t border-border pt-4">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{isMachining ? 'Machining subtotal' : 'Manufacturing subtotal'}</span>
                <span className="tabular-nums">{sym}{fmt(costs.subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Overhead ({(settings.overheadPercent * 100).toFixed(0)}%)</span>
                <span className="tabular-nums">{sym}{fmt(costs.overhead)}</span>
              </div>
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Margin ({(settings.defaultMargin * 100).toFixed(0)}%)</span>
                <span className="tabular-nums">{sym}{fmt(costs.marginAmount)}</span>
              </div>
              <div className="flex justify-between text-sm font-medium text-foreground pt-1 border-t border-border/60">
                <span>Unit price</span>
                <span className="tabular-nums">{sym}{fmt(unitPrice)}</span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>× {data.config.quantity} unit{data.config.quantity === 1 ? '' : 's'}</span>
                <span className="tabular-nums">{sym}{fmt(unitPrice * data.config.quantity)}</span>
              </div>
              {data.config.isRush && (
                <div className="flex justify-between text-sm text-orange-500 font-medium">
                  <span>Rush premium ({(settings.rushPremiumPercent * 100).toFixed(0)}%)</span>
                  <span className="tabular-nums">+{sym}{fmt(costs.rushPremium)}</span>
                </div>
              )}
              <div className="pt-2 flex justify-between items-center text-xl font-bold text-foreground border-t border-border">
                <span>Total</span>
                <span className="tabular-nums">{sym}{fmt(grandTotal)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Chevron helper missing
const ChevronDown = ({ className, size }: { className?: string, size?: number }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    width={size || 24} 
    height={size || 24} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="m6 9 6 6 6-6"/>
  </svg>
);
