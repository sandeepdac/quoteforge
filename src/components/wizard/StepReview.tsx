import React, { useState, useMemo } from 'react';
import { 
  Send, 
  Download, 
  Save, 
  MapPin, 
  Calendar, 
  Hammer,
  Zap,
  Info,
  AlertTriangle,
  ChevronRight
} from 'lucide-react';
import { useQuotes } from '../../context/QuoteContext';
import { useSettings } from '../../context/SettingsContext';
import { calculateQuoteCosts, calculateWinProbability } from '../../utils/estimator';
import { calculateMachiningCosts } from '../../utils/cncEstimator';
import { calculateMilledCosts } from '../../utils/milledEstimator';
import { materialPropsFor } from '../../utils/materials';
import { generatePartThumbnail } from '../../utils/partThumbnail';
import { generateTurningToolpath } from '../../utils/toolpath';
import ToolpathPreview from '../cad/ToolpathPreview';
import MachiningPlanPanel from '../quote/MachiningPlanPanel';
import { ExtractedCadAnalysis } from '../../utils/cadAnalyzer';
import { CostLineItem, MachiningCosts, PartFeatures } from '../../types';
import { cn } from '../../utils/cn';

interface StepReviewProps {
  data: any;
  cadAnalysis?: ExtractedCadAnalysis;
  quoteNumber: string;
  onSend: (opts: { margin: number; notes: string }) => void;
  onSaveDraft: (opts: { margin: number; notes: string }) => void;
  onBack: () => void;
}

export default function StepReview({ data, cadAnalysis, quoteNumber, onSend, onSaveDraft, onBack }: StepReviewProps) {
  const { customers, materials } = useQuotes();
  const { settings } = useSettings();
  const [margin, setMargin] = useState(settings.defaultMargin);
  const [notes, setNotes] = useState('');

  const customer = customers.find(c => c.id === data.config.customerId);
  const material = materials.find(m => m.id === data.features.materialId) || materials[0];

  const f = data.features as PartFeatures;
  const isTurnedPart = !!(cadAnalysis?.isTurned && cadAnalysis?.turningProfile);
  const isMilledPart = !!(cadAnalysis?.milledProfile && !cadAnalysis?.isTurned);
  const isMachining = isTurnedPart || isMilledPart;

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
        { materialName: material.name, profile, materialPricePerKg: material.pricePerKg },
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
      { key: 'material', name: 'Material Cost', driver: `${f.weightKg.toFixed(2)}kg @ $${material.pricePerKg.toFixed(2)}/kg`, value: qc.materialCost, color: '#2563eb' },
      { key: 'laser', name: 'Laser Cutting', driver: `${f.perimeterMm}mm perimeter, ${f.pierceCount} pierces`, value: qc.laserCost, color: '#3b82f6' },
      { key: 'bending', name: 'Bending & Forming', driver: `${f.bendCount} bends, ${f.isSimpleBending ? 'Simple' : 'Compound'}`, value: qc.bendCost, color: '#60a5fa' },
      { key: 'weld', name: 'Welding & Assembly', driver: `${f.weldLengthMm}mm welding, ${f.holeCount} holes`, value: qc.weldCost + qc.assemblyCost, color: '#8b5cf6' },
      { key: 'finish', name: 'Finishing (Applied)', driver: `${f.surfaceAreaM2.toFixed(3)}m² surface area`, value: qc.finishCost, color: '#93c5fd' },
    ].filter((li) => li.value > 0.005);
    return { costs: qc, lineItems: items };
  }, [data, settings, material, margin, isTurnedPart, isMilledPart, cadAnalysis, f]);

  const unitPrice = costs.subtotal + costs.overhead + costs.marginAmount;
  const grandTotal = (unitPrice * data.config.quantity) + costs.rushPremium;
  const winProb = calculateWinProbability(margin, data.config.leadTimeDays);
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

  const getWinProbColor = (prob: number) => {
    if (prob > 80) return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
    if (prob > 60) return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
    if (prob > 40) return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400";
    return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
  };

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 30);

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in zoom-in-95 duration-500">
      <div className="flex flex-col md:flex-row justify-between gap-6 pb-6 border-b border-border">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold">{quoteNumber}</h2>
            <span className="bg-muted text-muted-foreground px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest">Draft</span>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1"><Calendar size={14} /> Created: {new Date().toLocaleDateString()}</div>
            <div className="flex items-center gap-1"><Calendar size={14} /> Valid Until: {validUntil.toLocaleDateString()}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => onSaveDraft({ margin, notes })} className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium border border-border hover:bg-accent transition-colors">
            <Save size={16} /> Save Draft
          </button>
          <button onClick={() => onSend({ margin, notes })} className="flex items-center gap-2 px-6 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-shadow shadow">
            <Send size={16} /> Send to Customer
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {/* Customer & Part Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                    src={generatePartThumbnail(data.partName || 'Custom Machined Part', data.features)}
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
              <p className="text-[11px] text-muted-foreground">Each line is priced from a dimension measured from your CAD file.</p>
              {cadAnalysis?.machineRecommendation && (
                <p className="text-[11px] text-muted-foreground">
                  <strong className="text-foreground">Machine:</strong> {cadAnalysis.machineRecommendation.recommendedName}
                  <span className="text-muted-foreground/70"> · {Math.round(cadAnalysis.machineRecommendation.rateMultiplier * 100)}% of base spindle rate</span>
                </p>
              )}
              {mc && mc.machineClass === 'mill' && (
                <p className="text-[11px] text-muted-foreground">
                  Milled from {mc.stockMm?.x}×{mc.stockMm?.y}×{mc.stockMm?.z} billet · ~{mc.cycleTimeSec}s cycle @ {Math.round(mc.efficiencyFactor * 100)}% efficiency
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
                    <td className="px-4 py-3 text-right font-medium">${li.value.toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="bg-muted/10 font-semibold">
                  <td className="px-4 py-3" colSpan={2}>{isMachining ? 'Machining' : 'Factory'} Subtotal (incl. {settings.overheadPercent*100}% overhead)</td>
                  <td className="px-4 py-3 text-right">${(costs.subtotal + costs.overhead).toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {mc?.plan && mc.plan.setups.length > 0 && (
            <MachiningPlanPanel plan={mc.plan} setupTimeMin={mc.setupTimeMin} />
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
                <span className="font-medium font-mono">${(costs.subtotal + costs.overhead).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Unit Margin</span>
                <span className="font-medium font-mono">${costs.marginAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center py-2 px-3 bg-accent/50 rounded-lg">
                <span className="text-sm font-bold">Total Unit Price</span>
                <span className="text-lg font-black text-foreground">${unitPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-border border-dashed">
                <span className="text-sm text-muted-foreground">Quantity x {data.config.quantity}</span>
                <span className="text-sm font-medium">${(unitPrice * data.config.quantity).toFixed(2)}</span>
              </div>
              {costs.rushPremium > 0 && (
                <div className="flex justify-between items-center text-orange-500 font-medium">
                  <span className="text-xs uppercase tracking-wider font-bold italic flex items-center gap-1"><Zap size={10} fill="currentColor" /> Rush Premium</span>
                  <span className="text-sm font-bold">+${costs.rushPremium.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-2">
                <span className="text-base font-bold">Grand Total</span>
                <span className="text-2xl font-black text-primary">${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          <div className={cn("p-6 rounded-xl border flex flex-col items-center text-center space-y-4", getWinProbColor(winProb))}>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-widest">Win Probability</h3>
              <Info size={14} className="opacity-50" />
            </div>
            <div className="text-4xl font-black">{winProb}%</div>
            <p className="text-xs font-medium leading-relaxed opacity-80">
              Based on historical data for {customer?.name} and current material market volatility.
            </p>
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
