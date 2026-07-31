import React, { useMemo } from 'react';
import { 
  Users, 
  Truck, 
  Package, 
  Clock, 
  ArrowRight,
  TrendingUp,
  PieChart as PieChartIcon
} from 'lucide-react';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer 
} from 'recharts';
import { useQuotes } from '../../context/QuoteContext';
import { useSettings } from '../../context/SettingsContext';
import { calculateQuoteCosts } from '../../utils/estimator';
import { PartFeatures } from '../../types';
import { cn } from '../../utils/cn';

interface StepQuantityProps {
  data: any;
  onContinue: (config: any) => void;
  onBack: () => void;
  onUpdate: (data: any) => void;
}

export default function StepQuantity({ data, onContinue, onBack, onUpdate }: StepQuantityProps) {
  const { customers, materials } = useQuotes();
  const { settings } = useSettings();

  const currentMaterial = materials.find(m => m.id === data.features.materialId) || materials[0];

  const costs = useMemo(() => {
    return calculateQuoteCosts(
      data.features as PartFeatures,
      data.config.quantity,
      data.config.isRush,
      settings.defaultMargin, // Logic is handled in context or here
      currentMaterial.pricePerKg,
      settings
    );
  }, [data, settings, currentMaterial]);

  const unitPrice = costs.subtotal + costs.overhead + costs.marginAmount;
  const grandTotal = (unitPrice * data.config.quantity) + costs.rushPremium;

  const pieData = [
    { name: 'Material', value: costs.materialCost },
    { name: 'Laser', value: costs.laserCost },
    { name: 'Labor/Bending', value: costs.bendCost + costs.weldCost + costs.assemblyCost },
    { name: 'Finish', value: costs.finishCost },
  ];

  const COLORS = ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd'];

  const quantityPresets = [1, 10, 50, 100, 500];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
      {/* Left Column: Inputs */}
      <div className="lg:col-span-2 space-y-8 animate-in slide-in-from-left-4 duration-500">
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

        <div className="flex justify-between items-center pt-8">
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
                  <span className="text-3xl font-bold">${unitPrice.toFixed(2)}</span>
                  <span className="text-xs text-muted-foreground">/ ea</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Quantity</p>
                <p className="text-lg font-medium">{data.config.quantity}</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Material & Processing</span>
                <span>${(costs.subtotal + costs.overhead).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Margin ({(settings.defaultMargin * 100).toFixed(0)}%)</span>
                <span>${costs.marginAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
              {data.config.isRush && (
                <div className="flex justify-between text-sm text-orange-500 font-medium">
                  <span>Rush Premium (20%)</span>
                  <span>+${costs.rushPremium.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              )}
              <div className="pt-2 flex justify-between items-center text-xl font-bold text-foreground border-t border-border">
                <span>Total</span>
                <span>${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

            <div className="pt-4 space-y-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <PieChartIcon size={14} /> Cost Breakdown
              </h4>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={55}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-y-2">
                {pieData.map((item, idx) => (
                  <div key={item.name} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[idx] }}></div>
                    <span className="text-[10px] text-muted-foreground font-medium uppercase truncate">{item.name}</span>
                  </div>
                ))}
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
