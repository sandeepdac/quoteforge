import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { 
  ArrowLeft, 
  Send, 
  Download, 
  Trash2, 
  ChevronRight,
  MapPin,
  Calendar,
  Hammer,
  FileText,
  CheckCircle,
  XCircle,
  History,
  Info,
  Copy,
  Pencil
} from 'lucide-react';
import { useQuotes } from '../context/QuoteContext';
import { useMoney } from '../utils/useMoney';
import { useSettings } from '../context/SettingsContext';
import StatusPill from '../components/common/StatusPill';
import { cn } from '../utils/cn';
import { downloadQuotePDF } from '../utils/pdfGenerator';

export default function QuoteDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getQuoteById, getCustomerById, getPartById, getMaterialById, deleteQuote, updateQuote } = useQuotes();
  const { settings } = useSettings();
  const { symbol } = useMoney();

  const quote = getQuoteById(id || '');
  const [actualCostInput, setActualCostInput] = useState(
    quote?.actualCost != null ? String(quote.actualCost) : ''
  );
  if (!quote) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold">Quote not found</h2>
        <Link to="/quotes" className="text-primary hover:underline mt-4 inline-block">Back to quotes</Link>
      </div>
    );
  }

  const customer = getCustomerById(quote.customerId);
  const part = getPartById(quote.partId);
  const material = part ? getMaterialById(part.materialId) : undefined;
  const mc = quote.machiningCosts;

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this quote?')) {
      deleteQuote(quote.id);
      navigate('/quotes');
    }
  };

  const setStatus = (status: any) => {
    updateQuote({ ...quote, status });
  };

  const handleClone = () => {
    navigate('/quotes/new', { state: { cloneData: quote, partData: part, cloneCad: quote.cadAnalysis } });
  };

  const handleEdit = () => {
    navigate('/quotes/new', { state: { editQuote: quote, editPart: part, editCad: quote.cadAnalysis } });
  };

  const handleDownload = () => {
    downloadQuotePDF(quote, customer, part, material, settings);
  };

  const estFactoryCost = (quote.costs.subtotal + quote.costs.overhead) * quote.quantity;
  const saveActualCost = () => {
    const val = parseFloat(actualCostInput);
    updateQuote({ ...quote, actualCost: Number.isFinite(val) && val > 0 ? val : undefined });
  };
  const costVariancePct =
    quote.actualCost != null && estFactoryCost > 0
      ? ((quote.actualCost - estFactoryCost) / estFactoryCost) * 100
      : null;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-accent rounded-full transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{quote.quoteNumber}</h1>
            <StatusPill status={quote.status} />
          </div>
          <p className="text-sm text-muted-foreground">Created for {customer?.name} on {new Date(quote.createdDate).toLocaleDateString()}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 pb-6 border-b border-border">
        {quote.status === 'draft' && (
          <button onClick={() => setStatus('sent')} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-all">
            <Send size={16} /> Send Quote
          </button>
        )}
        {(quote.status === 'draft' || quote.status === 'sent') && (
          <button onClick={handleEdit} className="flex items-center gap-2 px-4 py-2 border border-border rounded-md text-sm font-medium hover:bg-accent transition-all">
            <Pencil size={16} /> Edit
          </button>
        )}
        {quote.status === 'sent' && (
          <>
            <button onClick={() => setStatus('won')} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 transition-all">
              <CheckCircle size={16} /> Mark as Won
            </button>
            <button onClick={() => setStatus('lost')} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 transition-all">
              <XCircle size={16} /> Mark as Lost
            </button>
          </>
        )}
        <button onClick={handleClone} className="flex items-center gap-2 px-4 py-2 border border-border rounded-md text-sm font-medium hover:bg-accent transition-all">
          <Copy size={16} /> Clone Quote
        </button>
        <button onClick={handleDownload} className="flex items-center gap-2 px-4 py-2 border border-border rounded-md text-sm font-medium hover:bg-accent transition-all">
          <Download size={16} /> Download PDF
        </button>
        <div className="flex-1"></div>
        <button onClick={handleDelete} className="flex items-center gap-2 px-4 py-2 bg-destructive/10 text-destructive border border-destructive/20 rounded-md text-sm font-medium hover:bg-destructive/20 transition-all">
          <Trash2 size={16} /> Delete
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-card border border-border p-5 rounded-lg space-y-4">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2 border-b border-border pb-3">
                <MapPin size={14} /> Customer
              </h3>
              <div className="space-y-1">
                <Link to={`/customers/${customer?.id}`} className="text-sm font-semibold text-primary hover:underline">{customer?.name}</Link>
                <p className="text-xs text-muted-foreground">{customer?.contactName}</p>
                <p className="text-xs text-muted-foreground mt-2">{customer?.email}</p>
                <p className="text-xs text-muted-foreground">{customer?.phone}</p>
              </div>
            </div>

            <div className="bg-card border border-border p-5 rounded-lg space-y-4">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2 border-b border-border pb-3">
                <FileText size={14} /> Quote Info
              </h3>
              <div className="grid grid-cols-2 gap-y-3">
                <div>
                  <p className="text-[10px] text-muted-foreground font-bold uppercase">Quantity</p>
                  <p className="text-sm font-medium">{quote.quantity}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground font-bold uppercase">Lead Time</p>
                  <p className="text-sm font-medium">{quote.leadTimeDays} Days</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground font-bold uppercase">Valid Until</p>
                  <p className="text-sm font-medium">{new Date(quote.validUntilDate).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground font-bold uppercase">Rush Order</p>
                  <p className={cn("text-sm font-medium", quote.isRushOrder ? "text-orange-500" : "")}>
                    {quote.isRushOrder ? 'YES' : 'NO'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border p-6 rounded-lg space-y-6">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2 border-b border-border pb-3">
              <Hammer size={14} /> Part & Features
            </h3>
            <div className="flex flex-col md:flex-row gap-8">
              <div className="w-full md:w-48 aspect-square bg-muted rounded-lg overflow-hidden border border-border shrink-0">
                <img src={part?.thumbnail} alt={part?.name} className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 space-y-6">
                <div>
                  <Link to={`/parts/${part?.id}`} className="text-lg font-semibold text-primary hover:underline">{part?.name}</Link>
                  <p className="text-sm text-muted-foreground">
                    {material?.name}
                    {quote.machineClass
                      ? ` · ${quote.machineClass === 'turn' ? 'Turned' : 'Milled'} part`
                      : ` ${material?.thicknessMm}mm`}
                  </p>
                </div>

                {quote.machineClass ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
                    <Feature label="Setups" value={mc?.setups ?? '—'} />
                    <Feature label="Holes" value={mc?.holeCount ?? part?.features.holeCount ?? 0} />
                    <Feature
                      label="Stock"
                      value={mc?.stockMm
                        ? `${mc.stockMm.x}×${mc.stockMm.y}×${mc.stockMm.z} mm`
                        : mc?.barDiameterMm
                          ? `⌀${mc.barDiameterMm} bar`
                          : '—'}
                    />
                    <Feature label="Cycle time" value={mc?.cycleTimeSec != null ? `${mc.cycleTimeSec} s` : '—'} />
                    <Feature label="Material yield" value={mc?.buyToFlyRatio != null ? `${Math.round(mc.buyToFlyRatio * 100)}%` : '—'} />
                    <Feature label="Weight" value={`${part?.features.weightKg.toFixed(2)} kg`} />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
                    <Feature label="Perimeter" value={`${part?.features.perimeterMm} mm`} />
                    <Feature label="Bends" value={part?.features.bendCount ?? 0} />
                    <Feature label="Pierces" value={part?.features.pierceCount ?? 0} />
                    <Feature label="Welding" value={`${part?.features.weldLengthMm} mm`} />
                    <Feature label="Holes" value={part?.features.holeCount ?? 0} />
                    <Feature label="Weight" value={`${part?.features.weightKg.toFixed(2)} kg`} />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="p-4 bg-muted/30 border-b border-border">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Pricing History & Notes</h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Internal Notes</p>
                <div className="p-4 bg-muted/20 border border-border rounded-md text-sm italic">
                  {quote.notes || 'No specific notes for this quote.'}
                </div>
              </div>
              <div className="space-y-3 pt-4">
                 <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                   <History size={14} /> Version History
                 </p>
                 <div className="space-y-4 border-l-2 border-border ml-2 pl-4 py-2">
                   {(quote.revisions && quote.revisions.length > 0
                     ? quote.revisions
                     : [{ at: quote.createdDate, summary: 'Quote created from CAD extraction', unitPrice: quote.totalUnitPrice, grandTotal: quote.grandTotal }]
                   )
                     .slice()
                     .reverse()
                     .map((rev, i) => (
                       <div className="relative" key={rev.at + i}>
                         <div className={cn('absolute -left-[24px] top-1.5 w-3 h-3 rounded-full ring-4 ring-background', i === 0 ? 'bg-primary' : 'bg-muted-foreground/40')}></div>
                         <div className="flex items-baseline justify-between gap-3">
                           <p className="text-xs font-bold">{new Date(rev.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>
                           <span className="text-[11px] font-mono text-muted-foreground">{symbol}{rev.unitPrice.toFixed(2)}/ea</span>
                         </div>
                         <p className="text-xs text-muted-foreground">{rev.summary}</p>
                       </div>
                     ))}
                 </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-card border border-border p-6 rounded-xl shadow-sm border-t-4 border-t-primary space-y-6">
             <div className="space-y-4">
               <div>
                  <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">Grand Total</p>
                  <p className="text-3xl font-black text-foreground">{symbol}{quote.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
               </div>
               <div className="pt-4 space-y-3 border-t border-border">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Unit Price</span>
                    <span className="font-bold">{symbol}{quote.totalUnitPrice.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Quantity</span>
                    <span className="font-bold">{quote.quantity}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Margin</span>
                    <span className="font-medium">{(quote.marginPercent * 100).toFixed(0)}%</span>
                  </div>
               </div>
             </div>
             
             <div className="pt-4 space-y-4">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Cost Breakdown</h4>
                <div className="space-y-2">
                  {quote.machineClass ? (
                    <>
                      <BreakdownRow label="Material / stock" value={quote.costs.materialCost} />
                      <BreakdownRow label="Machine time (cycle)" value={quote.costs.laserCost} />
                      <BreakdownRow label="Setup (amortised)" value={quote.costs.bendCost} />
                      <BreakdownRow label="Tooling / fixture" value={quote.costs.assemblyCost} />
                      <BreakdownRow label="Overhead" value={quote.costs.overhead} />
                    </>
                  ) : (
                    <>
                      <BreakdownRow label="Material" value={quote.costs.materialCost} />
                      <BreakdownRow label="Laser Processing" value={quote.costs.laserCost} />
                      <BreakdownRow label="Fabrication/Bending" value={quote.costs.bendCost + quote.costs.weldCost} />
                      <BreakdownRow label="Assembly & Finish" value={quote.costs.assemblyCost + quote.costs.finishCost} />
                      <BreakdownRow label="Overhead" value={quote.costs.overhead} />
                    </>
                  )}
                  {quote.costs.rushPremium > 0 && (
                    <BreakdownRow label="Rush Premium (order)" value={quote.costs.rushPremium} />
                  )}
                </div>
             </div>
          </div>

          <div className="p-6 rounded-xl border border-border bg-card flex flex-col items-center text-center space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Win Probability
            </div>
            <div className="text-4xl font-black text-primary">{quote.winProbability}%</div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${quote.winProbability}%` }}></div>
            </div>
            <p className="text-[10px] text-muted-foreground uppercase font-bold">Confidence: Medium</p>
          </div>
          
          {quote.status === 'won' && (
            <div className="bg-card border border-border p-5 rounded-lg space-y-3">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Estimator Accuracy</h3>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Estimated factory cost</span>
                <span className="font-mono font-medium">{symbol}{estFactoryCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Actual production cost ($)</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={actualCostInput}
                    onChange={(e) => setActualCostInput(e.target.value)}
                    placeholder="Enter actual…"
                    className="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button
                    onClick={saveActualCost}
                    className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-bold hover:bg-primary/90 transition-colors"
                  >
                    Save
                  </button>
                </div>
              </div>
              {costVariancePct !== null && (
                <div className="flex justify-between text-sm pt-1 border-t border-border">
                  <span className="text-muted-foreground">Variance vs estimate</span>
                  <span className={cn('font-bold', costVariancePct > 0 ? 'text-red-500' : 'text-green-600')}>
                    {costVariancePct > 0 ? '+' : ''}{costVariancePct.toFixed(1)}%
                  </span>
                </div>
              )}
            </div>
          )}

          {quote.status === 'lost' && (
            <div className="p-5 bg-red-100/30 border border-red-200 dark:bg-red-900/10 dark:border-red-900/30 rounded-lg space-y-3">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-400 font-bold text-xs uppercase tracking-widest">
                <Info size={14} /> Loss Analysis
              </div>
              <p className="text-xs text-red-700/80 dark:text-red-400/80 leading-relaxed">
                {quote.lossReason
                  ? `Marked lost — reason: ${quote.lossReason}.`
                  : 'Marked lost. No specific reason was recorded.'}
                {` ${part?.name ?? 'This part'} in ${material?.name ?? 'the selected material'} was quoted at ${symbol}${quote.totalUnitPrice.toFixed(2)}/ea over ${quote.leadTimeDays} days.`}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Feature({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground font-bold uppercase">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

function BreakdownRow({ label, value }: { label: string; value: number }) {
  const { symbol } = useMoney();
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground font-medium">{symbol}{value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    </div>
  );
}
