import React from 'react';
import { 
  FileText, 
  TrendingUp, 
  Clock, 
  DollarSign, 
  Plus,
  ArrowRight
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  BarChart,
  Bar
} from 'recharts';
import KpiCard from '../components/common/KpiCard';
import StatusPill from '../components/common/StatusPill';
import { useQuotes } from '../context/QuoteContext';

export default function DashboardPage() {
  const { quotes, getCustomerById, getPartById, materials, customers } = useQuotes();

  // Calculate KPIs
  const openQuotes = quotes.filter(q => q.status === 'sent');
  const openValue = openQuotes.reduce((acc, q) => acc + q.grandTotal, 0);
  
  const last30Days = new Date();
  last30Days.setDate(last30Days.getDate() - 30);
  const recentQuotes = quotes.filter(q => new Date(q.createdDate) > last30Days);
  const wonQuotes = recentQuotes.filter(q => q.status === 'won');
  const winRate = recentQuotes.length > 0 ? (wonQuotes.length / recentQuotes.length) * 100 : 0;

  const pipelineValue = quotes.reduce((acc, q) => acc + q.grandTotal, 0);

  const statusData = [
    { name: 'Won', value: quotes.filter(q => q.status === 'won').length },
    { name: 'Lost', value: quotes.filter(q => q.status === 'lost').length },
    { name: 'Sent', value: quotes.filter(q => q.status === 'sent').length },
    { name: 'Draft', value: quotes.filter(q => q.status === 'draft').length },
  ];

  // Calculate trends for last 7 days
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  // Base 'today' on the current context time or the latest quote for demo purposes
  const referenceDate = new Date('2026-05-04'); 
  const trendData = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(referenceDate);
    d.setDate(referenceDate.getDate() - (6 - i));
    const dayName = days[d.getDay()];
    const dateStr = d.toISOString().split('T')[0];
    
    // Exact match for the date string
    const dayQuotes = quotes.filter(q => q.createdDate === dateStr);
    const revenue = dayQuotes.reduce((acc, q) => acc + q.grandTotal, 0);
    
    return {
      name: dayName,
      quotes: dayQuotes.length,
      revenue: Math.round(revenue)
    };
  });

  const materialDataMap = new Map<string, number>();
  materials.forEach(m => {
    const count = quotes.filter(q => {
      const part = getPartById(q.partId);
      return part?.materialId === m.id;
    }).length;
    
    if (count > 0) {
      materialDataMap.set(m.name, (materialDataMap.get(m.name) || 0) + count);
    }
  });

  const materialData = Array.from(materialDataMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const customerVolumeData = customers.map(c => {
    const count = quotes.filter(q => q.customerId === c.id).length;
    return {
      name: c.name.split(' ')[0], // Short name for the bar chart
      full: c.name,
      quotes: count
    };
  }).filter(c => c.quotes > 0).sort((a, b) => b.quotes - a.quotes).slice(0, 5);

  const COLORS = ['#16a34a', '#dc2626', '#2563eb', '#525252'];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* KPI Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KpiCard 
          title="Open Quotes" 
          value={openQuotes.length} 
          icon={FileText} 
          description={`Value: $${(openValue / 1000000).toFixed(2)}M`}
          color="primary"
        />
        <KpiCard 
          title="Win Rate" 
          value={`${winRate.toFixed(1)}%`} 
          icon={TrendingUp} 
          trend={{ value: '12', isPositive: true }}
          color="success"
        />
        <KpiCard 
          title="Avg Quote Time" 
          value="1.8 min" 
          icon={Clock} 
          description="AI Extraction"
          color="warning"
        />
        <KpiCard 
          title="Revenue Pipeline" 
          value={`$${(pipelineValue / 1000).toFixed(1)}k`} 
          icon={DollarSign} 
          description="This Month"
          color="primary"
        />
      </div>

      {/* Main Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-lg border border-[#e5e5e5] shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="font-bold text-sm text-[#0a0a0a]">Quote Performance Trends</h3>
              <p className="text-xs text-muted-foreground">Volume and estimated revenue over the last 7 days</p>
            </div>
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[#2563eb]"></div>
                <span className="text-[10px] font-bold uppercase text-muted-foreground">Revenue</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[#16a34a]"></div>
                <span className="text-[10px] font-bold uppercase text-muted-foreground">Quotes</span>
              </div>
            </div>
          </div>
            <div className="h-[280px]">
               <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={10} tick={{ fill: '#71717a' }} />
                    <YAxis yAxisId="left" axisLine={false} tickLine={false} fontSize={10} tick={{ fill: '#71717a' }} />
                    <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} fontSize={10} tick={{ fill: '#71717a' }} />
                    <RechartsTooltip 
                      contentStyle={{ borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    />
                    <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={3} dot={{ r: 4, fill: '#2563eb', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} />
                    <Line yAxisId="right" type="monotone" dataKey="quotes" stroke="#16a34a" strokeWidth={3} dot={{ r: 4, fill: '#16a34a', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} />
                  </LineChart>
               </ResponsiveContainer>
            </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="bg-white p-6 rounded-lg border border-[#e5e5e5] shadow-sm flex flex-col flex-1">
            <h3 className="font-bold text-sm text-[#0a0a0a] mb-6 flex items-center justify-between">
              Material Distribution
              <Plus size={14} className="text-muted-foreground cursor-pointer" />
            </h3>
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={materialData} layout="vertical" margin={{ left: 0, right: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e5e5" />
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} fontSize={10} tick={{ fill: '#71717a' }} width={90} />
                  <RechartsTooltip 
                    cursor={{ fill: '#fafaf9' }}
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '12px' }}
                  />
                  <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg border border-[#e5e5e5] shadow-sm flex flex-col flex-1">
            <h3 className="font-bold text-sm text-[#0a0a0a] mb-6 text-center">Top Customers (7d)</h3>
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={customerVolumeData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={9} tick={{ fill: '#71717a' }} />
                  <YAxis axisLine={false} tickLine={false} fontSize={10} tick={{ fill: '#71717a' }} />
                  <RechartsTooltip 
                    contentStyle={{ borderRadius: '8px', border: '1px solid #e5e5e5', fontSize: '12px' }}
                    labelStyle={{ fontWeight: 'bold' }}
                    formatter={(value: number) => [value, 'Quotes']}
                    labelFormatter={(_, payload) => payload[0]?.payload?.full || ''}
                  />
                  <Bar dataKey="quotes" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Secondary Row */}
      <div className="flex flex-col xl:flex-row gap-6">
        {/* Table Area */}
        <div className="flex-[3] bg-white rounded-lg border border-[#e5e5e5] flex flex-col shadow-sm">
          <div className="p-5 border-b border-[#e5e5e5] flex items-center justify-between">
            <h3 className="font-semibold text-sm text-[#0a0a0a]">Global Quote Ledger</h3>
            <Link to="/quotes" className="text-xs text-[#2563eb] font-medium hover:underline flex items-center gap-1">
              View All <ArrowRight size={12} />
            </Link>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left">
              <thead className="bg-[#fafaf9] text-[10px] font-bold text-[#525252] uppercase border-b border-[#e5e5e5] sticky top-0">
                <tr>
                  <th className="px-6 py-3">Quote #</th>
                  <th className="px-6 py-3">Customer</th>
                  <th className="px-6 py-3">Part Name</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-[#e5e5e5]">
                {quotes.slice(0, 8).map((quote) => {
                  const customer = getCustomerById(quote.customerId);
                  const part = getPartById(quote.partId);
                  return (
                    <tr key={quote.id} className="hover:bg-[#fafaf9] transition-colors group">
                      <td className="px-6 py-4 font-mono text-[#2563eb] font-medium">
                        <Link to={`/quotes/${quote.id}`} className="hover:underline">{quote.quoteNumber}</Link>
                      </td>
                      <td className="px-6 py-4 text-[#525252]">{customer?.name}</td>
                      <td className="px-6 py-4 text-[#525252] truncate max-w-[150px]">{part?.name}</td>
                      <td className="px-6 py-4"><StatusPill status={quote.status} /></td>
                      <td className="px-6 py-4 text-right font-medium text-[#0a0a0a]">
                        ${quote.grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Analytics Preview Area */}
        <div className="flex-[2] flex flex-col gap-6">
          <div className="bg-white p-5 rounded-lg border border-[#e5e5e5] flex flex-col shadow-sm">
            <h3 className="text-xs font-bold text-[#525252] uppercase tracking-widest mb-6 flex items-center justify-between">
              Win/Loss by Volume
              <div className="w-2 h-2 rounded-full bg-[#16a34a] shadow-[0_0_8px_rgba(22,163,74,0.5)]"></div>
            </h3>
            <div className="flex items-center justify-center relative pt-4 min-h-[160px]">
              <ResponsiveContainer width="100%" height={100}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={70}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {statusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute flex flex-col items-center">
                <span className="text-[10px] text-[#a3a3a3] uppercase font-bold tracking-widest">Total</span>
                <span className="text-lg font-bold">{quotes.length}</span>
              </div>
            </div>
            <div className="mt-6 space-y-3">
              {statusData.map((item, idx) => (
                <div key={item.name} className="flex items-center justify-between text-xs font-medium">
                  <span className="flex items-center gap-2 text-[#525252]">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[idx] }}></div>
                    {item.name}
                  </span>
                  <span className="text-[#0a0a0a] font-bold">{Math.round((item.value / (quotes.length || 1)) * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
          
          <div className="bg-[#0c0c0b] p-6 rounded-lg border border-[#262626] flex flex-col justify-between flex-1 group hover:border-[#3a3a3a] transition-colors">
            <div className="space-y-4">
              <div className="text-[#2563eb] text-[10px] font-bold uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#2563eb] animate-pulse"></span>
                QuoteForge AI
              </div>
              <h4 className="text-white text-sm leading-relaxed font-normal italic opacity-90">
                "Estimating bandwidth is up <span className="text-[#16a34a] font-bold tracking-tight">340%</span> this month. Predictive win probability for your top 5 open quotes is <span className="text-[#2563eb] font-bold tracking-tight">72.4%</span> based on historical behavior."
              </h4>
            </div>
            <button className="mt-6 w-full py-2.5 bg-[#262626] text-white text-[11px] font-bold uppercase tracking-widest rounded-md hover:bg-[#333333] border border-[#3a3a3a] transition-all">
              View Intelligence Report
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
