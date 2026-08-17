import React, { useState, useMemo } from 'react';
import { 
  Send, 
  Download, 
  Save, 
  MapPin, 
  Calendar, 
  Hammer,
  Zap,
  AlertTriangle,
  ChevronRight
} from 'lucide-react';
import { useQuotes } from '../../context/QuoteContext';
import { useSettings } from '../../context/SettingsContext';
import { calculateQuoteCosts } from '../../utils/estimator';
import { calculateMachiningCosts } from '../../utils/cncEstimator';
import { calculateMilledCosts } from '../../utils/milledEstimator';
import { materialPropsFor } from '../../utils/materials';
import { currencySymbol } from '../../utils/currency';
import { dimsDesc } from '../../utils/dims';
import { DEFAULT_SECONDARY_OPS } from '../../constants';
import { generatePartThumbnail } from '../../utils/partThumbnail';
import { generateTurningToolpath } from '../../utils/toolpath';
import ToolpathPreview from '../cad/ToolpathPreview';
import MachiningCostTable from '../quote/MachiningCostTable';
import MilledOperationStrategy from '../quote/MilledOperationStrategy';
import { ExtractedCadAnalysis } from '../../utils/cadAnalyzer';
import { CostLineItem, MachiningCosts, PartFeatures } from '../../types';
import { cn } from '../../utils/cn';

interface StepReviewProps {
  data: any;
  cadAnalysis?: ExtractedCadAnalysis;
  /** Rendered still of the 3D model captured on the extraction step (real part image). */
  partImage?: string;
  quoteNumber: string;
  onSend: (opts: { margin: number; notes: string }) => void;
  onSaveDraft: (opts: { margin: number; notes: string }) => void;
  onBack: () => void;
  onUpdate?: (updater: (prev: any) => any) => void;
}

export default function StepReview({ data, cadAnalysis, partImage, quoteNumber, onSend, onSaveDraft, onBack, onUpdate }: StepReviewProps) {
  const { customers, materials } = useQuotes();
  const { settings } = useSettings();
  const [margin, setMargin] = useState(settings.defaultMargin);
  const [notes, setNotes] = useState('');

  // Secondary operations (finishing / inspection) the shop offers, and which
  // ones the estimator applies to this quote.
  const secondaryCatalog = settings.secondaryOps ?? DEFAULT_SECONDARY_OPS;
  const [secondaryIds, setSecondaryIds] = useState<string[]>([]);
  const selectedSecondaryOps = secondaryCatalog.filter((o) => secondaryIds.includes(o.id));
  const toggleSecondary = (id: string) =>
    setSecondaryIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const customer = customers.find(c => c.id === data.config.customerId);
  const material = materials.find(m => m.id === data.features.materialId) || materials[0];

  const f = data.features as PartFeatures;
  const isTurnedPart = !!(cadAnalysis?.isTurned && cadAnalysis?.turningProfile);
  const isMilledPart = !!(cadAnalysis?.milledProfile && !cadAnalysis?.isTurned);
  const isMachining = isTurnedPart || isMilledPart;

  const sym = currencySymbol(settings.currency);
  const money = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const { costs, lineItems } = useMemo(() => {
    if (isTurnedPart && cadAnalysis?.turningProfile) {
      const density = materialPropsFor(material.name).densityGCm3;
      const volumeCm3 = f.weightKg > 0 ? (f.weightKg * 1000) / density : cadAnalysis.volumeCm3 ?? 0;
      const mc = calculateMachiningCosts(
        {
          isTurned: true,
          materialName: material.name,
          volumeCm3,
          profile: cadAnalysis.turningProfile,
          setups: cadAnalysis.setups ?? 1,
          materialPricePerKg: material.pricePerKg,
          secondaryOps: selectedSecondaryOps,
        },
        data.config.quantity,
        data.config.isRush,
        margin,
        settings,
        cadAnalysis.machineRecommendation?.rateMultiplier ?? 1
      );
      return { costs: mc, lineItems: mc.lineItems };
    }

    if (isMilledPart && cadAnalysis?.milledProfile) {
      const density = materialPropsFor(material.name).densityGCm3;
      const base = cadAnalysis.milledProfile;
      const partVolumeCm3 = f.weightKg > 0 ? (f.weightKg * 1000) / density : base.partVolumeCm3;
      const profile = {
        ...base,
        partVolumeCm3,
        removedVolumeCm3: Math.max(0, base.stockVolumeCm3 - partVolumeCm3),
      };
      const mc = calculateMilledCosts(
        { materialName: material.name, profile, materialPricePerKg: material.pricePerKg, secondaryOps: selectedSecondaryOps },
        data.config.quantity,
        data.config.isRush,
        margin,
        settings,
        cadAnalysis.machineRecommendation?.rateMultiplier ?? 1
      );
      return { costs: mc, lineItems: mc.lineItems };
    }
    const qc = calculateQuoteCosts(
      f,
      data.config.quantity,
      data.config.isRush,
      margin,
      material.pricePerKg,
      settings
    );
    const items: CostLineItem[] = [
      { key: 'material', name: 'Material Cost', driver: `${f.weightKg.toFixed(2)}kg @ ${sym}${material.pricePerKg.toFixed(2)}/kg`, value: qc.materialCost, color: '#2563eb' },
      { key: 'laser', name: 'Laser Cutting', driver: `${f.perimeterMm}mm perimeter, ${f.pierceCount} pierces`, value: qc.laserCost, color: '#3b82f6' },
      { key: 'bending', name: 'Bending & Forming', driver: `${f.bendCount} bends, ${f.isSimpleBending ? 'Simple' : 'Compound'}`, value: qc.bendCost, color: '#60a5fa' },
      { key: 'weld', name: 'Welding & Assembly', driver: `${f.weldLengthMm}mm welding, ${f.holeCount} holes`, value: qc.weldCost + qc.assemblyCost, color: '#8b5cf6' },
      { key: 'finish', name: 'Finishing (Applied)', driver: `${f.surfaceAreaM2.toFixed(3)}m² surface area`, value: qc.finishCost, color: '#93c5fd' },
    ].filter((li) => li.value > 0.005);
    return { costs: qc, lineItems: items };
  }, [data, settings, material, margin, isTurnedPart, isMilledPart, cadAnalysis, f, secondaryIds]);

  const unitPrice = costs.subtotal + costs.overhead + costs.marginAmount;
  const grandTotal = (unitPrice * data.config.quantity) + costs.rushPremium;
  const mc = isMachining ? (costs as MachiningCosts) : null;

  // Reference turning toolpath (preview + downloadable G-code) for turned parts.
  const toolpath = useMemo(() => {
    if (!isTurnedPart || !cadAnalysis?.turningProfile) return null;
    const bar = cadAnalysis.barDiameterMm ?? cadAnalysis.turningProfile.odMm + 4;
    return generateTurningToolpath(
      cadAnalysis.turningProfile,
      bar,
      materialPropsFor(material.name),
      undefined,
      settings.cnc?.toolLibrary
    );
  }, [isTurnedPart, cadAnalysis, material, settings.cnc?.toolLibrary]);

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 30);

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in zoom-in-95 duration-500">
      {/* Price-forward header — the quote total is the first thing you see. */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 bg-card border border-border rounded-2xl p-5 shadow-sm">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold">{quoteNumber}</h2>
            <span className="bg-muted text-muted-foreground px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest">Draft</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Hammer size={13} /> {customer?.name ?? 'No customer selected'}</span>
            <span className="flex items-center gap-1"><Calendar size={13} /> Valid until {validUntil.toLocaleDateString()}</span>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right leading-tight">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Grand Total</p>
            <p className="text-3xl font-black text-primary">{sym}{money(grandTotal)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {sym}{money(unitPrice)}/unit × {data.config.quantity}
              {mc && mc.repeatUnitPrice < unitPrice - 0.01 && (
                <span className="text-emerald-600 dark:text-emerald-400"> · repeat {sym}{money(mc.repeatUnitPrice)}</span>
              )}
            </p>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <button onClick={() => onSend({ margin, notes })} className="flex items-center justify-center gap-2 px-5 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-shadow shadow">
              <Send size={15} /> Send to Customer
            </button>
            <button onClick={() => onSaveDraft({ margin, notes })} className="flex items-center justify-center gap-2 px-5 py-2 rounded-md text-sm font-medium border border-border hover:bg-accent transition-colors">
              <Save size={15} /> Save Draft
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Customer & Part Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card border border-border p-5 rounded-lg space-y-4">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2 border-b border-border pb-3">
                <MapPin size={14} /> Customer Details
              </h3>
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold">{customer?.name}</p>
                  <p className="text-xs text-muted-foreground">{customer?.contactName}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">{customer?.email}</p>
                  <p className="text-xs text-muted-foreground">{customer?.address}</p>
                </div>
              </div>
            </div>

            <div className="bg-card border border-border p-5 rounded-lg space-y-4">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2 border-b border-border pb-3">
                <Hammer size={14} /> Part Summary
              </h3>
              <div className="flex gap-4">
                <div className="w-16 h-16 bg-muted rounded border border-border overflow-hidden">
                  <img
                    src={partImage || generatePartThumbnail(data.partName || 'Custom Machined Part', data.features)}
                    alt={data.partName || 'Part'}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold">{data.partName || 'Custom Machined Part'}</p>
                  <p className="text-xs text-muted-foreground">{material.name} {material.thicknessMm}mm</p>
                  <p className="text-xs text-muted-foreground">{data.features.lengthMm} x {data.features.widthMm} x {data.features.heightMm} mm</p>
                </div>
              </div>
            </div>
          </div>

          {/* Cost breakdown table */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="p-4 bg-muted/30 border-b border-border space-y-1">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Detailed Cost Breakdown</h3>
              <p className="text-[11px] text-muted-foreground">
                {isMachining
                  ? 'Grouped by setup — each operation shows the cutter from your shop tool library, its time and cost.'
                  : 'Each line is priced from a dimension measured from your CAD file.'}
              </p>
              {cadAnalysis?.machineRecommendation && (
                <p className="text-[11px] text-muted-foreground">
                  <strong className="text-foreground">Machine:</strong> {cadAnalysis.machineRecommendation.recommendedName}
                  <span className="text-muted-foreground/70"> · {Math.round(cadAnalysis.machineRecommendation.rateMultiplier * 100)}% of base spindle rate</span>
                </p>
              )}
              {mc && mc.machineClass === 'mill' && (
                <p className="text-[11px] text-muted-foreground">
                  Milled from {mc.stockMm ? dimsDesc(mc.stockMm) : '—'} billet · ~{mc.cycleTimeSec}s cycle @ {Math.round(mc.efficiencyFactor * 100)}% efficiency
                  · <strong className="text-foreground">{Math.round(mc.buyToFlyRatio * 100)}% material yield</strong> · {mc.setups} setup{mc.setups > 1 ? 's' : ''}
                  · {mc.pocketCount ?? 0} pocket{(mc.pocketCount ?? 0) === 1 ? '' : 's'}{(mc.deepPocketCount ?? 0) > 0 ? ` (${mc.deepPocketCount} deep)` : ''} · {mc.holeCount ?? 0} hole{(mc.holeCount ?? 0) === 1 ? '' : 's'}.
                </p>
              )}
              {mc && mc.machineClass !== 'mill' && (
                <p className="text-[11px] text-muted-foreground">
                  Turned from ⌀{mc.barDiameterMm} bar · ~{mc.cycleTimeSec}s cycle @ {Math.round(mc.efficiencyFactor * 100)}% efficiency
                  · <strong className="text-foreground">{Math.round(mc.buyToFlyRatio * 100)}% material yield</strong> · {mc.setups} setup{mc.setups > 1 ? 's' : ''}.
                </p>
              )}
              {cadAnalysis?.formedPart && (
                <div className="flex gap-2 mt-2 bg-amber-500/10 border border-amber-500/30 rounded-md p-2">
                  <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Formed part — perimeter &amp; area are from the folded shape, so laser/finishing under-estimate the flat-blank cut.
                    Upload the flat DXF or drawing for an accurate cut cost.
                  </p>
                </div>
              )}
            </div>
            {isMachining && secondaryCatalog.length > 0 && (
              <div className="px-4 py-3 border-b border-border bg-muted/10">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                  Secondary operations <span className="font-normal normal-case tracking-normal">— finishing &amp; inspection, added to the quote</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {secondaryCatalog.map((op) => {
                    const on = secondaryIds.includes(op.id);
                    const sym = currencySymbol(settings.currency);
                    return (
                      <button
                        key={op.id}
                        onClick={() => toggleSecondary(op.id)}
                        className={cn(
                          'text-left rounded-md border px-3 py-1.5 text-xs transition-colors',
                          on
                            ? 'border-teal-500 bg-teal-500/10 text-foreground'
                            : 'border-border bg-background text-muted-foreground hover:border-teal-500/50 hover:text-foreground'
                        )}
                        title={op.leadTimeDays ? `~${op.leadTimeDays} day turnaround` : undefined}
                      >
                        <span className={cn('inline-block w-2 h-2 rounded-full mr-2 align-middle', on ? 'bg-teal-500' : 'bg-muted-foreground/30')} />
                        <span className="font-semibold">{op.name}</span>
                        <span className="block text-[10px] text-muted-foreground mt-0.5">
                          {op.lotCharge > 0 ? `${sym}${op.lotCharge.toFixed(0)} lot` : ''}{op.lotCharge > 0 && op.perPartCost > 0 ? ' + ' : ''}{op.perPartCost > 0 ? `${sym}${op.perPartCost.toFixed(2)}/part` : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {isMachining && mc?.plan && mc.plan.setups.length > 0 ? (
              <MachiningCostTable costs={mc} overheadPercent={settings.overheadPercent} currency={currencySymbol(settings.currency)} />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border">
                    <th className="px-4 py-3 font-medium">Operation / Item</th>
                    <th className="px-4 py-3 font-medium text-right">Details</th>
                    <th className="px-4 py-3 font-medium text-right">Ext. Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lineItems.map((li) => (
                    <tr key={li.key}>
                      <td className="px-4 py-3">{li.name}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{li.driver}</td>
                      <td className="px-4 py-3 text-right font-medium">{sym}{li.value.toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr className="bg-muted/10 font-semibold">
                    <td className="px-4 py-3" colSpan={2}>{isMachining ? 'Machining' : 'Factory'} Subtotal (incl. {settings.overheadPercent*100}% overhead)</td>
                    <td className="px-4 py-3 text-right">{sym}{(costs.subtotal + costs.overhead).toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>

          {mc && mc.machineClass === 'mill' && mc.stockMm && (
            <MilledOperationStrategy
              stockMm={mc.stockMm}
              counts={{
                pocketCount: mc.pocketCount ?? 0,
                bossCount: mc.bossCount ?? 0,
                deepPocketCount: mc.deepPocketCount ?? 0,
                holeCount: mc.holeCount ?? 0,
              }}
              removedVolumeCm3={mc.removedVolumeCm3}
            />
          )}

          {toolpath && (
            <ToolpathPreview toolpath={toolpath} partName={data.partName} materialName={material.name} />
          )}

          <div className="space-y-3">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Notes for customer</label>
            <textarea
              placeholder="Add any specific assumptions or notes for this quote..."
              className="w-full bg-background border border-border rounded-md p-4 text-sm min-h-[100px] focus:outline-none focus:ring-1 focus:ring-primary"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            ></textarea>
          </div>
        </div>

        <div className="space-y-6">
          {/* Material confirm — last chance to correct before the quote is sent */}
          {onUpdate && (
            <div className="bg-card border border-border p-4 rounded-xl shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Material</h3>
                {isMachining && <span className="text-[10px] text-muted-foreground">drives cutting speeds &amp; cost</span>}
              </div>
              <select
                value={material?.id}
                onChange={(e) => onUpdate((prev) => ({ ...prev, features: { ...prev.features, materialId: e.target.value } }))}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}{typeof m.pricePerKg === 'number' ? ` — ${sym}${m.pricePerKg.toFixed(2)}/kg` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Pricing Controls */}
          <div className="bg-card border border-border p-6 rounded-xl shadow-sm space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Margin Adjuster</h3>
                <span className="text-xl font-bold text-primary">{(margin * 100).toFixed(0)}%</span>
              </div>
              <input 
                type="range" 
                min="0.05" 
                max="0.5" 
                step="0.01" 
                className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                value={margin}
                onChange={(e) => setMargin(Number(e.target.value))}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground font-bold font-mono">
                <span>5% MIN</span>
                <span>50% MAX</span>
              </div>
            </div>

            <div className="space-y-4 pt-6 border-t border-border">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Unit Cost</span>
                <span className="font-medium font-mono">{sym}{(costs.subtotal + costs.overhead).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Unit Margin</span>
                <span className="font-medium font-mono">{sym}{costs.marginAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center py-2 px-3 bg-accent/50 rounded-lg">
                <span className="text-sm font-bold">Total Unit Price</span>
                <span className="text-lg font-black text-foreground">{sym}{unitPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-border border-dashed">
                <span className="text-sm text-muted-foreground">Quantity x {data.config.quantity}</span>
                <span className="text-sm font-medium">{sym}{(unitPrice * data.config.quantity).toFixed(2)}</span>
              </div>
              {costs.rushPremium > 0 && (
                <div className="flex justify-between items-center text-orange-500 font-medium">
                  <span className="text-xs uppercase tracking-wider font-bold italic flex items-center gap-1"><Zap size={10} fill="currentColor" /> Rush Premium</span>
                  <span className="text-sm font-bold">+{sym}{costs.rushPremium.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-2">
                <span className="text-base font-bold">Grand Total</span>
                <span className="text-2xl font-black text-primary">{currencySymbol(settings.currency)}{grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              {mc && mc.repeatUnitPrice < unitPrice - 0.01 && (
                <div className="flex justify-between items-center pt-2 mt-2 border-t border-dashed border-border text-sm">
                  <span className="text-muted-foreground">
                    Repeat order <span className="text-[10px]">(NRE {currencySymbol(settings.currency)}{mc.nreCost.toFixed(0)} already paid)</span>
                  </span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">
                    {currencySymbol(settings.currency)}{mc.repeatUnitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/part
                  </span>
                </div>
              )}
            </div>
          </div>

          <button
            onClick={onBack}
            className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors group"
          >
            Something looks wrong? Back to edit <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </div>
    </div>
  );
}
