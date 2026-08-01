import React from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Plus, Calendar, Hammer, Layers, Ruler, Weight, History, FileText, Zap } from 'lucide-react';
import { useQuotes } from '../context/QuoteContext';
import StatusPill from '../components/common/StatusPill';
import { cn } from '../utils/cn';

export default function PartDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getPartById, getMaterialById, quotes, customers } = useQuotes();

  const part = getPartById(id || '');
  if (!part) {
    return <div className="text-center py-20"><h2 className="text-2xl font-bold">Part not found</h2><Link to="/parts" className="text-primary hover:underline">Back to parts</Link></div>;
  }

  const material = getMaterialById(part.materialId);
  const partQuotes = quotes.filter(q => q.partId === part.id).sort((a, b) => new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime());

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-accent rounded-full transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold">{part.name}</h1>
          <p className="text-sm text-muted-foreground">Internal Part ID: {part.id.toUpperCase()}</p>
        </div>
        <div className="flex-1"></div>
        <Link
          to="/quotes/new"
          state={{ partData: part }}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90 transition-shadow shadow"
        >
          <Plus size={18} /> New Quote for this Part
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="bg-card border border-border rounded-lg overflow-hidden flex flex-col md:flex-row">
            <div className="w-full md:w-80 aspect-square bg-muted shrink-0 border-r border-border">
              <img src={part.thumbnail} alt={part.name} className="w-full h-full object-cover" />
            </div>
            <div className="p-6 flex-1 space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest flex items-center gap-1"><Layers size={12} /> Material</p>
                  <p className="text-sm font-semibold">{material?.name} {part.thicknessMm}mm</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest flex items-center gap-1"><Ruler size={12} /> Dimensions</p>
                  <p className="text-sm font-semibold">{part.features.lengthMm} x {part.features.widthMm} x {part.features.heightMm} mm</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest flex items-center gap-1"><Weight size={12} /> Weight</p>
                  <p className="text-sm font-semibold">{part.features.weightKg.toFixed(2)} kg</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest flex items-center gap-1"><History size={12} /> Last Quoted</p>
                  <p className="text-sm font-semibold">{part.lastQuotedDate ? new Date(part.lastQuotedDate).toLocaleDateString() : 'N/A'}</p>
                </div>
              </div>
              
              <div className="pt-4 border-t border-border space-y-4">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Extraction Features</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <FeatureStat label="Perimeter" value={`${part.features.perimeterMm}mm`} />
                  <FeatureStat label="Pierces" value={part.features.pierceCount} />
                  <FeatureStat label="Bends" value={part.features.bendCount} />
                  <FeatureStat label="Holes" value={part.features.holeCount} />
                  <FeatureStat label="Weld Len" value={`${part.features.weldLengthMm}mm`} />
                  <FeatureStat label="Welds" value={part.features.weldCount} />
                  <FeatureStat label="Area" value={`${part.features.surfaceAreaM2.toFixed(3)}m²`} />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <FileText size={16} /> Quote History 
              <span className="text-xs font-normal">({partQuotes.length} total)</span>
            </h3>
            <div className="bg-card border border-border rounded-lg overflow-hidden">
               <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-6 py-3 text-[10px] font-bold text-muted-foreground uppercase">Quote #</th>
                      <th className="px-6 py-3 text-[10px] font-bold text-muted-foreground uppercase">Customer</th>
                      <th className="px-6 py-3 text-[10px] font-bold text-muted-foreground uppercase">Qty</th>
                      <th className="px-6 py-3 text-[10px] font-bold text-muted-foreground uppercase">Price ea.</th>
                      <th className="px-6 py-3 text-[10px] font-bold text-muted-foreground uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {partQuotes.map(q => {
                      const customer = customers.find(c => c.id === q.customerId);
                      return (
                        <tr key={q.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-6 py-4">
                            <Link to={`/quotes/${q.id}`} className="text-sm font-medium text-primary hover:underline">{q.quoteNumber}</Link>
                          </td>
                          <td className="px-6 py-4 text-sm font-medium">{customer?.name}</td>
                          <td className="px-6 py-4 text-sm underline-offset-4">{q.quantity}</td>
                          <td className="px-6 py-4 text-sm font-mono">${q.totalUnitPrice.toFixed(2)}</td>
                          <td className="px-6 py-4"><StatusPill status={q.status} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
               </table>
            </div>
          </div>
        </div>

        <div className="space-y-6">
           <div className="bg-card border border-border p-6 rounded-lg space-y-6">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest border-b border-border pb-3">Part Performance</h3>
              <div className="space-y-4">
                 <div>
                    <p className="text-xs text-muted-foreground mb-1 uppercase leading-none">Win Rate</p>
                    <div className="flex items-end gap-2">
                      <p className="text-3xl font-black text-foreground">
                        {partQuotes.length > 0 
                          ? Math.round((partQuotes.filter(q => q.status === 'won').length / partQuotes.length) * 100) 
                          : 0}%
                      </p>
                      <span className="text-xs text-muted-foreground mb-1">of all quotes</span>
                    </div>
                 </div>
                 <div>
                    <p className="text-xs text-muted-foreground mb-1 uppercase leading-none">Avg. Quote Value</p>
                    <p className="text-xl font-bold text-foreground">
                      ${partQuotes.length > 0 
                        ? (partQuotes.reduce((acc, q) => acc + q.grandTotal, 0) / partQuotes.length).toLocaleString(undefined, { maximumFractionDigits: 0 }) 
                        : 0}
                    </p>
                 </div>
              </div>
           </div>
           
           <div className="bg-primary/5 border border-primary/20 p-5 rounded-lg space-y-3">
              <div className="flex items-center gap-2 text-primary font-bold text-xs uppercase tracking-widest leading-snug">
                <Zap size={14} fill="currentColor" /> Reusable Part
              </div>
              <p className="text-xs text-primary/80 leading-relaxed">
                Geometry measured from CAD: {part.features.holeCount} holes, {part.features.bendCount} bends,
                {' '}{part.features.weightKg.toFixed(2)} kg. Quoted {part.quoteCount}× — start a new quote to reuse
                these features without re-uploading.
              </p>
           </div>
        </div>
      </div>
    </div>
  );
}

function FeatureStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-muted/50 p-2 rounded border border-border text-center">
      <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-tight">{label}</p>
      <p className="text-xs font-semibold text-foreground truncate">{value}</p>
    </div>
  );
}
