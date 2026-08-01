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
import { useTheme } from '../context/ThemeContext';

export default function DashboardPage() {
  const { quotes, getCustomerById, getPartById, materials, customers } = useQuotes();
  const { theme } = useTheme();

  // Theme-aware chart styling.
  const gridColor = theme === 'dark' ? '#27272a' : '#e5e5e5';
  const axisColor = theme === 'dark' ? '#a1a1aa' : '#71717a';
  const tooltipStyle = {
    borderRadius: '8px',
    border: `1px solid ${gridColor}`,
    fontSize: '12px',
    background: theme === 'dark' ? '#18181b' : '#ffffff',
    color: theme === 'dark' ? '#fafafa' : '#0a0a0a',
    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
  };

  // Calculate KPIs
  const openQuotes = quotes.filter(q => q.status === 'sent');
  const openValue = openQuotes.reduce((acc, q) => acc + q.grandTotal, 0);

  // Win rate across all decided quotes (won / won+lost+expired).
  const decided = quotes.filter(q => ['won', 'lost', 'expired'].includes(q.status));
  const winRate = decided.length > 0 ? (decided.filter(q => q.status === 'won').length / decided.length) * 100 : 0;

  // Real pipeline = value of open (sent) quotes awaiting a decision.
  const pipelineValue = openValue;
  const wonRevenue = quotes.filter(q => q.status === 'won').reduce((acc, q) => acc + q.grandTotal, 0);
  const avgMargin = quotes.length > 0 ? (quotes.reduce((acc, q) => acc + q.marginPercent, 0) / quotes.length) * 100 : 0;
  // Average win probability across open quotes — drives the insight card.
  const avgOpenWinProb = openQuotes.length > 0
    ? Math.round(openQuotes.reduce((acc, q) => acc + q.winProbability, 0) / openQuotes.length)
    : 0;

  const statusData = [
    { name: 'Won', value: quotes.filter(q => q.status === 'won').length },
    { name: 'Lost', value: quotes.filter(q => q.status === 'lost').length },
    { name: 'Sent', value: quotes.filter(q => q.status === 'sent').length },
    { name: 'Draft', value: quotes.filter(q => q.status === 'draft').length },
  ];

  // 7-day activity trend, anchored to the most recent quote (falls back to today)
  // so it always reflects real activity regardless of when the data sits in time.
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const latestQuoteDate = quotes.reduce((m, q) => (q.createdDate > m ? q.createdDate : m), '');
  const referenceDate = latestQuoteDate ? new Date(`${latestQuoteDate}T00:00:00`) : new Date();
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
          description={`$${(openValue / 1000).toFixed(1)}k in play`}
          color="primary"
        />
        <KpiCard
          title="Win Rate"
          value={`${winRate.toFixed(1)}%`}
          icon={TrendingUp}
          description={`${decided.length} decided`}
          color="success"
        />
        <KpiCard
          title="Avg Margin"
          value={`${avgMargin.toFixed(1)}%`}
          icon={Clock}
          description="Across all quotes"
          color="warning"
        />
        <KpiCard
          title="Revenue Pipeline"
          value={`$${(pipelineValue / 1000).toFixed(1)}k`}
          icon={DollarSign}
          description="Awaiting decision"
          color="primary"
        />
      </div>

      {/* Main Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-card p-6 rounded-lg border border-border shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="font-bold text-sm text-foreground">Quote Performance Trends</h3>
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
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={10} tick={{ fill: axisColor }} />
                    <YAxis yAxisId="left" axisLine={false} tickLine={false} fontSize={10} tick={{ fill: axisColor }} />
                    <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} fontSize={10} tick={{ fill: axisColor }} />
                    <RechartsTooltip 
                      contentStyle={tooltipStyle}
                    />
                    <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={3} dot={{ r: 4, fill: '#2563eb', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} />
                    <Line yAxisId="right" type="monotone" dataKey="quotes" stroke="#16a34a" strokeWidth={3} dot={{ r: 4, fill: '#16a34a', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} />
                  </LineChart>
               </ResponsiveContainer>
            </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="bg-card p-6 rounded-lg border border-border shadow-sm flex flex-col flex-1">
            <h3 className="font-bold text-sm text-foreground mb-6 flex items-center justify-between">
              Material Distribution
              <Plus size={14} className="text-muted-foreground cursor-pointer" />
            </h3>
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={materialData} layout="vertical" margin={{ left: 0, right: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={gridColor} />
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} fontSize={10} tick={{ fill: axisColor }} width={90} />
                  <RechartsTooltip 
                    cursor={{ fill: gridColor }}
                    contentStyle={tooltipStyle}
                  />
                  <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-card p-6 rounded-lg border border-border shadow-sm flex flex-col flex-1">
            <h3 className="font-bold text-sm text-foreground mb-6 text-center">Top Customers by Volume</h3>
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={customerVolumeData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={9} tick={{ fill: axisColor }} />
                  <YAxis axisLine={false} tickLine={false} fontSize={10} tick={{ fill: axisColor }} />
                  <RechartsTooltip 
                    contentStyle={tooltipStyle}
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
        <div className="flex-[3] bg-card rounded-lg border border-border flex flex-col shadow-sm">
          <div className="p-5 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold text-sm text-foreground">Global Quote Ledger</h3>
            <Link to="/quotes" className="text-xs text-primary font-medium hover:underline flex items-center gap-1">
              View All <ArrowRight size={12} />
            </Link>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left">
              <thead className="bg-muted/40 text-[10px] font-bold text-muted-foreground uppercase border-b border-border sticky top-0">
                <tr>
                  <th className="px-6 py-3">Quote #</th>
                  <th className="px-6 py-3">Customer</th>
                  <th className="px-6 py-3">Part Name</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-border">
                {quotes.slice(0, 8).map((quote) => {
                  const customer = getCustomerById(quote.customerId);
                  const part = getPartById(quote.partId);
                  return (
                    <tr key={quote.id} className="hover:bg-muted/40 transition-colors group">
                      <td className="px-6 py-4 font-mono text-primary font-medium">
                        <Link to={`/quotes/${quote.id}`} className="hover:underline">{quote.quoteNumber}</Link>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">{customer?.name}</td>
                      <td className="px-6 py-4 text-muted-foreground truncate max-w-[150px]">{part?.name}</td>
                      <td className="px-6 py-4"><StatusPill status={quote.status} /></td>
                      <td className="px-6 py-4 text-right font-medium text-foreground">
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
          <div className="bg-card p-5 rounded-lg border border-border flex flex-col shadow-sm">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-6 flex items-center justify-between">
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
                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Total</span>
                <span className="text-lg font-bold">{quotes.length}</span>
              </div>
            </div>
            <div className="mt-6 space-y-3">
              {statusData.map((item, idx) => (
                <div key={item.name} className="flex items-center justify-between text-xs font-medium">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[idx] }}></div>
                    {item.name}
                  </span>
                  <span className="text-foreground font-bold">{Math.round((item.value / (quotes.length || 1)) * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
          
          <div className="bg-[#0c0c0b] p-6 rounded-lg border border-[#262626] flex flex-col justify-between flex-1 group hover:border-[#3a3a3a] transition-colors">
            <div className="space-y-4">
              <div className="text-primary text-[10px] font-bold uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#2563eb] animate-pulse"></span>
                QuoteForge AI
              </div>
              <h4 className="text-white text-sm leading-relaxed font-normal opacity-90">
                You have <span className="text-[#2563eb] font-bold tracking-tight">{openQuotes.length}</span> open
                quotes worth <span className="text-[#2563eb] font-bold tracking-tight">${(openValue / 1000).toFixed(1)}k</span>,
                with an average win probability of <span className="text-[#16a34a] font-bold tracking-tight">{avgOpenWinProb}%</span>.
                Closed-won revenue to date is <span className="text-[#16a34a] font-bold tracking-tight">${(wonRevenue / 1000).toFixed(1)}k</span>.
              </h4>
            </div>
            <Link to="/analytics" className="mt-6 w-full py-2.5 bg-[#262626] text-white text-[11px] font-bold uppercase tracking-widest rounded-md hover:bg-[#333333] border border-[#3a3a3a] transition-all text-center">
              View Full Analytics
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
