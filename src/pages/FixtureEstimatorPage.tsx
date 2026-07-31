import React, { useState, useEffect, useMemo } from 'react';
import { 
  Hammer, 
  MapPin, 
  User, 
  FileText, 
  Calculator, 
  Ship, 
  Percent, 
  CheckCircle,
  Download,
  Plus,
  Layers,
  Settings as SettingsIcon,
  Archive,
  Truck
} from 'lucide-react';
import { cn } from '../utils/cn';
import { useSettings } from '../context/SettingsContext';
import { useQuotes } from '../context/QuoteContext';

interface FixtureData {
  type: string;
  description: string;
  partNo: string;
  partName: string;
  location: string;
  manufacturedFor: string;
  
  // Technical Features (Sheet 2 logic)
  complexity: 'Low' | 'Medium' | 'High';
  estimatedHours: number;
  setupTime: number;
  materialWeight: number; // kg
  
  // Costs (Sheet 3 logic)
  materialId?: string;
  baseCost: number;
  shippingCost: number;
  taxPercent: number;
}

type TabType = 'summary' | 'details' | 'bom' | 'logistics';

export default function FixtureEstimatorPage() {
  const { settings } = useSettings();
  const { materials } = useQuotes();
  
  const [activeTab, setActiveTab] = useState<TabType>('summary');
  const [data, setData] = useState<FixtureData>({
    type: 'FABRICATION',
    description: '',
    partNo: '',
    partName: '',
    location: 'INDIA',
    manufacturedFor: '',
    complexity: 'Medium',
    estimatedHours: 12,
    setupTime: 2.5,
    materialWeight: 45,
    baseCost: 0,
    shippingCost: 0,
    taxPercent: 18,
  });

  // New itemized state for "lots of logic" sheets
  const [bomItems, setBomItems] = useState<{ id: string; name: string; qty: number; weight: number; cost: number }[]>([
    { id: '1', name: 'Base Plate 20mm', qty: 1, weight: 15.5, cost: 180 },
    { id: '2', name: 'Side Pillars', qty: 4, weight: 2.2, cost: 45 }
  ]);

  const [laborItems, setLaborItems] = useState<{ id: string; type: string; hours: number; rate: number }[]>([
    { id: '1', type: 'VMC Machining', hours: 4, rate: 25 },
    { id: '2', type: 'Surface Grinding', hours: 2, rate: 18 }
  ]);

  const [standardItems, setStandardItems] = useState<{ id: string; name: string; qty: number; unitPrice: number }[]>([
    { id: '1', name: 'Toggle Clamps GH-12132', qty: 4, unitPrice: 12.5 },
    { id: '2', name: 'Locating Pins 12mm', qty: 6, unitPrice: 3.2 }
  ]);

  // Sophisticated Sheet Formulas (Derived Data)
  const calculations = useMemo(() => {
    // 1. BOM Total
    const totalMaterialCost = bomItems.reduce((acc, item) => acc + (item.qty * item.cost), 0);
    const totalWeight = bomItems.reduce((acc, item) => acc + (item.qty * item.weight), 0);

    // 2. Labor Total
    const totalLaborCost = laborItems.reduce((acc, item) => acc + (item.hours * item.rate), 0);

    // 3. Standards Total
    const totalStandardsCost = standardItems.reduce((acc, item) => acc + (item.qty * item.unitPrice), 0);

    // 4. Overhead & Margin
    const shopOverheadRate = settings.overheadPercent / 100;
    const subtotal = totalMaterialCost + totalLaborCost + totalStandardsCost;
    const overheadAmount = subtotal * shopOverheadRate;
    
    // Profit Margin
    const marginRate = settings.defaultMargin / 100;
    const preTaxTotal = (subtotal + overheadAmount) * (1 + marginRate);

    // 5. Final Totals with India-specific GST logic (18%)
    const shipping = data.shippingCost;
    const taxValue = (preTaxTotal + shipping) * (data.taxPercent / 100);
    const grandTotal = preTaxTotal + shipping + taxValue;

    return {
      materialCost: totalMaterialCost,
      laborCost: totalLaborCost,
      standardsCost: totalStandardsCost,
      overheadAmount,
      subtotal,
      preTaxTotal,
      tax: taxValue,
      grandTotal,
      weight: totalWeight
    };
  }, [data, settings, bomItems, laborItems, standardItems]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setData(prev => ({
      ...prev,
      [name]: e.target.type === 'number' ? parseFloat(value) || 0 : value
    }));
  };

  const handleExport = () => {
    window.print();
  };

  const addItem = (type: 'bom' | 'labor' | 'standard') => {
    if (type === 'bom') {
      setBomItems([...bomItems, { id: Date.now().toString(), name: 'New Item', qty: 1, weight: 0, cost: 0 }]);
    } else if (type === 'labor') {
      setLaborItems([...laborItems, { id: Date.now().toString(), type: 'New Process', hours: 1, rate: 20 }]);
    } else {
      setStandardItems([...standardItems, { id: Date.now().toString(), name: 'New component', qty: 1, unitPrice: 0 }]);
    }
  };

  const updateItem = (itemType: 'bom' | 'labor' | 'standard', id: string, field: string, value: any) => {
    if (itemType === 'bom') {
      setBomItems(prev => prev.map(item => item.id === id ? { ...item, [field]: field === 'name' ? value : parseFloat(value) || 0 } : item));
    } else if (itemType === 'labor') {
      setLaborItems(prev => prev.map(item => item.id === id ? { ...item, [field]: field === 'type' ? value : parseFloat(value) || 0 } : item));
    } else {
      setStandardItems(prev => prev.map(item => item.id === id ? { ...item, [field]: field === 'name' ? value : parseFloat(value) || 0 } : item));
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-6xl mx-auto pb-20">
      {/* Header with Sheet Navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0a0a0a] flex items-center gap-2">
            <Archive className="text-primary" size={24} />
            Multi-Sheet Advanced Estimator
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Unified calculator with full BOM and Labor itemization logic.</p>
        </div>
        <div className="flex gap-2 text-print-hidden">
          <button onClick={handleExport} className="btn-secondary flex items-center gap-2">
            <Download size={16} /> Export PDF
          </button>
          <button className="btn-primary flex items-center gap-2">
            <Plus size={16} /> Save Worksheet
          </button>
        </div>
      </div>

      {/* Sheet Tabs */}
      <div className="flex gap-1 p-1 bg-muted/30 rounded-lg border border-border w-fit text-print-hidden">
        <TabButton id="summary" label="1. Project ID" active={activeTab} onClick={setActiveTab} icon={FileText} />
        <TabButton id="bom" label="2. Bill of Materials" active={activeTab} onClick={setActiveTab} icon={Layers} />
        <TabButton id="details" label="3. Labor & Process" active={activeTab} onClick={setActiveTab} icon={SettingsIcon} />
        <TabButton id="logistics" label="4. Standards & Tax" active={activeTab} onClick={setActiveTab} icon={Truck} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-6">
          {/* SHEET 1: SUMMARY */}
          {activeTab === 'summary' && (
            <div className="bg-white border border-border rounded-xl shadow-sm overflow-hidden animate-in slide-in-from-left-4 duration-300">
              <div className="p-5 border-b border-border bg-[#fafaf9] flex items-center justify-between">
                <h3 className="text-[10px] font-black text-[#525252] uppercase tracking-[0.2em] flex items-center gap-2">
                  <FileText size={14} className="text-primary" /> Primary Identification
                </h3>
              </div>
              <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                <InputGroup label="Type of Fixture">
                   <select name="type" value={data.type} onChange={handleChange} className="input-field">
                      <option value="FABRICATION">FABRICATION</option>
                      <option value="WELDING">WELDING</option>
                      <option value="INSPECTION">INSPECTION</option>
                   </select>
                </InputGroup>
                <InputGroup label="Manufactured Location">
                   <input name="location" value={data.location} onChange={handleChange} className="input-field" placeholder="INDIA" />
                </InputGroup>
                <InputGroup label="Part Number">
                   <input name="partNo" value={data.partNo} onChange={handleChange} className="input-field" />
                </InputGroup>
                <InputGroup label="Part Name">
                   <input name="partName" value={data.partName} onChange={handleChange} className="input-field" />
                </InputGroup>
                <InputGroup label="Manufactured For" className="md:col-span-2">
                   <input name="manufacturedFor" value={data.manufacturedFor} onChange={handleChange} className="input-field" />
                </InputGroup>
                <InputGroup label="Project Description" className="md:col-span-2">
                   <textarea name="description" value={data.description} onChange={handleChange} className="input-field min-h-[100px]" placeholder="Brief project scope..." />
                </InputGroup>
              </div>
            </div>
          )}

          {/* SHEET 2: BOM */}
          {activeTab === 'bom' && (
            <div className="bg-white border border-border rounded-xl shadow-sm overflow-hidden animate-in slide-in-from-left-4 duration-300">
              <div className="p-5 border-b border-border bg-[#fafaf9] flex items-center justify-between">
                 <h3 className="text-[10px] font-black text-[#525252] uppercase tracking-[0.2em]">Material Breakdown (BOM)</h3>
                 <button onClick={() => addItem('bom')} className="text-[10px] font-bold text-primary flex items-center gap-1 hover:underline">
                   <Plus size={12} /> Add Item
                 </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#fafaf9] border-b border-border font-bold uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Item Description</th>
                      <th className="px-4 py-3 text-right">Qty</th>
                      <th className="px-4 py-3 text-right">Weight (Kg)</th>
                      <th className="px-4 py-3 text-right">Cost ($)</th>
                      <th className="px-4 py-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {bomItems.map(item => (
                      <tr key={item.id}>
                        <td className="px-4 py-2"><input value={item.name} onChange={(e) => updateItem('bom', item.id, 'name', e.target.value)} className="bg-transparent border-none w-full focus:ring-0" /></td>
                        <td className="px-4 py-2 text-right"><input type="number" value={item.qty} onChange={(e) => updateItem('bom', item.id, 'qty', e.target.value)} className="bg-transparent border-none w-12 text-right focus:ring-0" /></td>
                        <td className="px-4 py-2 text-right"><input type="number" value={item.weight} onChange={(e) => updateItem('bom', item.id, 'weight', e.target.value)} className="bg-transparent border-none w-16 text-right focus:ring-0" /></td>
                        <td className="px-4 py-2 text-right"><input type="number" value={item.cost} onChange={(e) => updateItem('bom', item.id, 'cost', e.target.value)} className="bg-transparent border-none w-20 text-right focus:ring-0" /></td>
                        <td className="px-4 py-2 text-right font-bold">${(item.qty * item.cost).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SHEET 3: LABOR */}
          {activeTab === 'details' && (
            <div className="bg-white border border-border rounded-xl shadow-sm overflow-hidden animate-in slide-in-from-left-4 duration-300">
              <div className="p-5 border-b border-border bg-[#fafaf9] flex items-center justify-between">
                 <h3 className="text-[10px] font-black text-[#525252] uppercase tracking-[0.2em]">Process & Machining Hours</h3>
                 <button onClick={() => addItem('labor')} className="text-[10px] font-bold text-primary flex items-center gap-1 hover:underline">
                   <Plus size={12} /> Add Process
                 </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#fafaf9] border-b border-border font-bold uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Process / Resource</th>
                      <th className="px-4 py-3 text-right">Hours</th>
                      <th className="px-4 py-3 text-right">Rate ($/Hr)</th>
                      <th className="px-4 py-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {laborItems.map(item => (
                      <tr key={item.id}>
                        <td className="px-4 py-2"><input value={item.type} onChange={(e) => updateItem('labor', item.id, 'type', e.target.value)} className="bg-transparent border-none w-full focus:ring-0" /></td>
                        <td className="px-4 py-2 text-right"><input type="number" value={item.hours} onChange={(e) => updateItem('labor', item.id, 'hours', e.target.value)} className="bg-transparent border-none w-16 text-right focus:ring-0" /></td>
                        <td className="px-4 py-2 text-right"><input type="number" value={item.rate} onChange={(e) => updateItem('labor', item.id, 'rate', e.target.value)} className="bg-transparent border-none w-20 text-right focus:ring-0" /></td>
                        <td className="px-4 py-2 text-right font-bold">${(item.hours * item.rate).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SHEET 4: LOGISTICS & TAX */}
          {activeTab === 'logistics' && (
            <div className="space-y-6">
              <div className="bg-white border border-border rounded-xl shadow-sm overflow-hidden animate-in slide-in-from-left-4 duration-300">
                <div className="p-5 border-b border-border bg-[#fafaf9] flex items-center justify-between">
                   <h3 className="text-[10px] font-black text-[#525252] uppercase tracking-[0.2em]">Standards & Bought-outs</h3>
                   <button onClick={() => addItem('standard')} className="text-[10px] font-bold text-primary flex items-center gap-1 hover:underline">
                     <Plus size={12} /> Add component
                   </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#fafaf9] border-b border-border font-bold uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Component Description</th>
                        <th className="px-4 py-3 text-right">Qty</th>
                        <th className="px-4 py-3 text-right">Unit Price</th>
                        <th className="px-4 py-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {standardItems.map(item => (
                        <tr key={item.id}>
                          <td className="px-4 py-2"><input value={item.name} onChange={(e) => updateItem('standard', item.id, 'name', e.target.value)} className="bg-transparent border-none w-full focus:ring-0" /></td>
                          <td className="px-4 py-2 text-right"><input type="number" value={item.qty} onChange={(e) => updateItem('standard', item.id, 'qty', e.target.value)} className="bg-transparent border-none w-12 text-right focus:ring-0" /></td>
                          <td className="px-4 py-2 text-right"><input type="number" value={item.unitPrice} onChange={(e) => updateItem('standard', item.id, 'unitPrice', e.target.value)} className="bg-transparent border-none w-20 text-right focus:ring-0" /></td>
                          <td className="px-4 py-2 text-right font-bold">${(item.qty * item.unitPrice).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white border border-border rounded-xl shadow-sm overflow-hidden">
                <div className="p-5 border-b border-border bg-[#fafaf9]">
                   <h3 className="text-[10px] font-black text-[#525252] uppercase tracking-[0.2em]">Shipping & Taxation Logic</h3>
                </div>
                <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                  <InputGroup label="Global Shipping ($)">
                     <input type="number" name="shippingCost" value={data.shippingCost} onChange={handleChange} className="input-field" />
                  </InputGroup>
                  <InputGroup label="Tax Percentage (GST %)">
                     <input type="number" name="taxPercent" value={data.taxPercent} onChange={handleChange} className="input-field" />
                  </InputGroup>
                  <div className="md:col-span-2 p-4 bg-orange-50 rounded-lg border border-orange-200">
                     <p className="text-[10px] font-bold text-orange-700 uppercase tracking-widest mb-1 text-print-hidden">Logistics Verification</p>
                     <p className="text-xs text-orange-800 leading-relaxed italic">"Shipping is calculated based on the total BOM weight of {calculations.weight.toFixed(1)}kg. India-specific GST rules apply."</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Dynamic Sidebar - Global Result */}
        <div className="lg:col-span-4 lg:sticky lg:top-24 h-fit">
          <div className="bg-[#0c0c0b] text-white p-6 rounded-xl border border-[#262626] shadow-2xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none group-hover:opacity-10 transition-opacity">
               <Calculator size={120} />
            </div>
            
            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-[#2563eb] mb-8 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#2563eb] animate-pulse"></span>
              Worksheet Results
            </h3>
            
            <div className="space-y-4">
              <ResultRow label="Total Bill of Materials" value={calculations.materialCost} />
              <ResultRow label="Accumulated Labor" value={calculations.laborCost} />
              <ResultRow label="Standard & Bought-outs" value={calculations.standardsCost} />
              <ResultRow label={`Overhead (${settings.overheadPercent}%)`} value={calculations.overheadAmount} />
              <ResultRow label="Margin Applied" value={calculations.preTaxTotal - (calculations.subtotal + calculations.overheadAmount)} />
              <ResultRow label="Shipping" value={data.shippingCost} />
              <ResultRow label={`GST / Tax (${data.taxPercent}%)`} value={calculations.tax} />

              <div className="pt-8 border-t border-[#262626] mt-4">
                <p className="text-[10px] font-bold text-[#a3a3a3] uppercase tracking-[0.2em] mb-2">Grand Total Quote</p>
                <div className="flex items-baseline gap-1">
                   <span className="text-xl font-bold text-[#2563eb]">$</span>
                   <span className="text-5xl font-black text-white tracking-tighter">
                     {calculations.grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                   </span>
                   <span className="text-lg font-bold text-[#525252]">.{(calculations.grandTotal % 1).toFixed(2).split('.')[1]}</span>
                </div>
              </div>

              <div className="mt-8 pt-8 border-t border-[#262626] space-y-3 print:hidden">
                 <button className="w-full py-4 bg-[#2563eb] text-white rounded-md text-[10px] font-black uppercase tracking-[0.2em] hover:bg-[#3b82f6] transition-all shadow-lg active:scale-95">
                   Finalize Worksheet
                 </button>
                 <div className="flex items-center justify-center gap-2 text-[10px] text-[#525252] font-bold uppercase tracking-widest">
                   <CheckCircle size={10} className="text-[#16a34a]" /> Sheets Logic Computed
                 </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TabButton({ id, label, active, onClick, icon: Icon }: { id: TabType, label: string, active: TabType, onClick: (id: TabType) => void, icon: any }) {
  const isActive = active === id;
  return (
    <button 
      onClick={() => onClick(id)}
      className={cn(
        "flex items-center gap-2 px-4 py-2 text-[10px] font-black uppercase tracking-[0.1em] rounded-md transition-all",
        isActive 
          ? "bg-white text-primary shadow-sm ring-1 ring-border" 
          : "text-muted-foreground hover:text-foreground hover:bg-white/50"
      )}
    >
      <Icon size={12} className={isActive ? "text-primary" : "text-muted-foreground"} />
      {label}
    </button>
  );
}

function InputGroup({ label, children, className }: { label: string, children: React.ReactNode, className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      <label className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground leading-none">{label}</label>
      {children}
    </div>
  );
}

function ResultRow({ label, value }: { label: string, value: number }) {
  return (
    <div className="flex justify-between items-center text-sm group">
      <span className="text-[#a3a3a3] font-medium group-hover:text-white transition-colors">{label}</span>
      <span className="font-mono font-bold text-[#e5e5e5]">${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    </div>
  );
}
