import React from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  PieChart, 
  Pie, 
  Cell, 
  AreaChart, 
  Area,
  ScatterChart,
  Scatter,
  ZAxis
} from 'recharts';
import { 
  TrendingUp, 
  Target, 
  Clock, 
  ArrowUpRight, 
  AlertCircle,
  HelpCircle
} from 'lucide-react';
import { useQuotes } from '../context/QuoteContext';
import { useTheme } from '../context/ThemeContext';
import { cn } from '../utils/cn';

export default function AnalyticsPage() {
  const { quotes, materials, customers, getPartById } = useQuotes();
  const { theme } = useTheme();

  // Color Palette
  const CHART_COLORS = ['#2563eb', '#16a34a', '#ea580c', '#dc2626', '#71717a'];

  const totalRevenue = quotes.filter(q => q.status === 'won').reduce((acc, q) => acc + q.grandTotal, 0);
  const pipelineValue = quotes.filter(q => q.status === 'sent').reduce((acc, q) => acc + q.grandTotal, 0);
  const avgMargin = quotes.length > 0 ? (quotes.reduce((acc, q) => acc + q.marginPercent, 0) / quotes.length) * 100 : 0;

  // Process data for charts
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May'];
  const winRateData = months.map((month, idx) => {
    const monthQuotes = quotes.filter(q => {
      const parts = q.createdDate.split('-');
      return parseInt(parts[1], 10) - 1 === idx;
    });
    const won = monthQuotes.filter(q => q.status === 'won').length;
    const total = monthQuotes.filter(q => ['won', 'lost', 'expired'].includes(q.status)).length;
    return {
      month,
      rate: total > 0 ? Math.round((won / total) * 100) : 0
    };
  });

  const revenueByMonth = months.map((month, idx) => {
    const monthQuotes = quotes.filter(q => {
      const parts = q.createdDate.split('-');
      return parseInt(parts[1], 10) - 1 === idx;
    });
    const won = monthQuotes.filter(q => q.status === 'won').reduce((acc, q) => acc + q.grandTotal, 0);
    const lost = monthQuotes.filter(q => q.status === 'lost').reduce((acc, q) => acc + q.grandTotal, 0);
    return { month, won, lost };
  });

  const lossReasonData = [
    { name: 'Price too High', value: quotes.filter(q => q.lossReason === 'Price too High').length },
    { name: 'Lead Time', value: quotes.filter(q => q.lossReason === 'Lead Time').length },
    { name: 'Lost to Competitor', value: quotes.filter(q => q.lossReason === 'Lost to Competitor').length },
    { name: 'Cancelled', value: quotes.filter(q => q.lossReason === 'Project Cancelled').length },
  ].filter(r => r.value > 0);

  const funnelData = [
    { name: 'Drafts', value: quotes.filter(q => q.status === 'draft').length, fill: '#71717a' },
    { name: 'Sent', value: quotes.filter(q => q.status === 'sent').length, fill: '#2563eb' },
    { name: 'Won', value: quotes.filter(q => q.status === 'won').length, fill: '#16a34a' },
  ];

  const leadTimeAccuracy = [
    { 
      name: 'Standard', 
      promised: Math.round(quotes.filter(q => q.actualLeadTimeDays !== undefined).reduce((acc, q) => acc + q.leadTimeDays, 0) / Math.max(1, quotes.filter(q => q.actualLeadTimeDays !== undefined).length)),
      actual: Math.round(quotes.filter(q => q.actualLeadTimeDays !== undefined).reduce((acc, q) => acc + q.actualLeadTimeDays!, 0) / Math.max(1, quotes.filter(q => q.actualLeadTimeDays !== undefined).length))
    }
  ];

  const materialRevenueDataMap = new Map<string, number>();
  materials.forEach(m => {
    const revenue = quotes
      .filter(q => q.status === 'won')
      .filter(q => {
        const part = getPartById(q.partId);
        return part?.materialId === m.id;
      })
      .reduce((acc, q) => acc + q.grandTotal, 0);
    
    if (revenue > 0) {
      materialRevenueDataMap.set(m.name, (materialRevenueDataMap.get(m.name) || 0) + revenue);
    }
  });

  const materialRevenueData = Array.from(materialRevenueDataMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const accuracyData = quotes.filter(q => q.status === 'won').map(q => ({
    quoted: q.costs.subtotal,
    actual: q.costs.subtotal * (0.95 + Math.random() * 0.1), // Mock actual vs quote
    label: q.quoteNumber
  }));

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-12">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Advanced Analytics</h1>
        <p className="text-muted-foreground">Comprehensive intelligence suite for quoting strategy and workshop operations.</p>
      </div>

      {/* Primary KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Total Won Revenue" value={`$${(totalRevenue / 1000).toFixed(1)}k`} trend="+12.4%" />
        <MetricCard label="Pipeline Value" value={`$${(pipelineValue / 1000).toFixed(1)}k`} trend="+4.2%" />
        <MetricCard label="Average Margin" value={`${avgMargin.toFixed(1)}%`} trend="-2.1%" />
        <MetricCard label="Avg. Bid Spread" value="8.4%" trend="+0.5%" />
      </div>

      {/* Conversion & Win Rate Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <ChartCard title="Win Rate Progression (Monthly %)">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={winRateData}>
                  <defs>
                    <linearGradient id="colorRate" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={10} />
                  <YAxis axisLine={false} tickLine={false} unit="%" fontSize={10} />
                  <RechartsTooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '12px' }} />
                  <Area type="monotone" dataKey="rate" stroke="#2563eb" fillOpacity={1} fill="url(#colorRate)" strokeWidth={3} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>
        <ChartCard title="Quote Conversion Funnel">
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e5e5" />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} fontSize={10} />
                <RechartsTooltip cursor={{ fill: 'transparent' }} contentStyle={{ borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '12px' }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={40}>
                  {funnelData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* Revenue & Outcome Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <ChartCard title="Revenue Outcome (Won vs Lost)">
           <div className="h-[300px]">
             <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueByMonth}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={10} />
                  <YAxis axisLine={false} tickLine={false} fontSize={10} unit="$" tickFormatter={(v) => `${v/1000}k`} />
                  <RechartsTooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '12px' }} />
                  <Bar dataKey="won" stackId="a" fill="#16a34a" name="Won" />
                  <Bar dataKey="lost" stackId="a" fill="#dc2626" name="Lost" radius={[4, 4, 0, 0]} />
                </BarChart>
             </ResponsiveContainer>
           </div>
        </ChartCard>

        <ChartCard title="Lead Time: Promised vs Actual (Days)">
           <div className="h-[300px]">
             <ResponsiveContainer width="100%" height="100%">
                <BarChart data={leadTimeAccuracy} margin={{ top: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={10} />
                  <YAxis axisLine={false} tickLine={false} fontSize={10} />
                  <RechartsTooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '12px' }} />
                  <Bar dataKey="promised" fill="#3b82f6" name="Promised" radius={[4, 4, 0, 0]} barSize={20} />
                  <Bar dataKey="actual" fill="#fbbf24" name="Actual Production" radius={[4, 4, 0, 0]} barSize={20} />
                </BarChart>
             </ResponsiveContainer>
           </div>
        </ChartCard>
      </div>

      {/* Deep Dive Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8">
        <ChartCard title="Revenue Share by Material">
           <div className="flex flex-col h-full">
             <div className="h-[220px]">
               <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={materialRevenueData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {materialRevenueData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '12px' }} />
                  </PieChart>
               </ResponsiveContainer>
             </div>
             <div className="grid grid-cols-2 gap-3 mt-4">
                {materialRevenueData.map((item, idx) => (
                  <div key={item.name} className="flex items-center justify-between text-[10px] bg-muted/30 p-2 rounded border border-border">
                    <span className="flex items-center gap-2 text-muted-foreground truncate font-bold uppercase">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CHART_COLORS[idx] }}></div>
                      {item.name.split(' ')[0]}
                    </span>
                    <span className="font-black text-[#0a0a0a]">${(item.value / 1000).toFixed(0)}k</span>
                  </div>
                ))}
             </div>
           </div>
        </ChartCard>

        <ChartCard title="Loss Reason Distribution">
          <div className="flex flex-col h-full">
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={lossReasonData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {lossReasonData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[(index + 2) % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 mt-4">
              {lossReasonData.map((item, idx) => (
                <div key={item.name} className="flex items-center justify-between text-[10px]">
                  <span className="flex items-center gap-2 text-muted-foreground font-bold uppercase">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_COLORS[(idx + 2) % CHART_COLORS.length] }}></div>
                    {item.name}
                  </span>
                  <span className="font-black text-[#0a0a0a]">{item.value} quotes</span>
                </div>
              ))}
            </div>
          </div>
        </ChartCard>

        <div className="lg:col-span-2 xl:col-span-1">
          <ChartCard title="Estimator Accuracy">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" vertical={false} />
                  <XAxis type="number" dataKey="quoted" name="Quoted Cost" unit="$" axisLine={false} tickLine={false} fontSize={10} />
                  <YAxis type="number" dataKey="actual" name="Actual Cost" unit="$" axisLine={false} tickLine={false} fontSize={10} />
                  <ZAxis type="category" dataKey="label" name="Project ID" />
                  <RechartsTooltip cursor={{ strokeDasharray: '3-3' }} contentStyle={{ borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '12px' }} />
                  <Scatter name="Projects" data={accuracyData} fill="#2563eb" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, trend }: { label: string; value: string; trend: string }) {
  const isPositive = trend.startsWith('+');
  return (
    <div className="bg-card border border-border p-5 rounded-lg shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{label}</span>
        <div className={cn(
          "flex items-center gap-0.5 text-[10px] font-bold",
          isPositive ? "text-green-600" : "text-red-500"
        )}>
           {isPositive ? <ArrowUpRight size={10} /> : <ArrowUpRight className="rotate-90" size={10} />}
           {trend}
        </div>
      </div>
      <p className="text-2xl font-black">{value}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm flex flex-col h-full">
       <div className="flex items-center justify-between mb-6">
         <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest leading-none">{title}</h3>
         <HelpCircle size={14} className="text-muted-foreground hover:text-foreground cursor-pointer transition-colors" />
       </div>
       <div className="flex-1 overflow-hidden">
         {children}
       </div>
    </div>
  );
}
