import React from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { 
  ArrowLeft, 
  Mail, 
  Phone, 
  MapPin, 
  Calendar, 
  TrendingUp, 
  DollarSign, 
  FileText,
  Plus,
  ArrowRight
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer 
} from 'recharts';
import { useQuotes } from '../context/QuoteContext';
import { useMoney } from '../utils/useMoney';
import StatusPill from '../components/common/StatusPill';
import { cn } from '../utils/cn';

export default function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getCustomerById, quotes, parts } = useQuotes();
  const { symbol } = useMoney();

  const customer = getCustomerById(id || '');
  if (!customer) {
    return <div className="text-center py-20"><h2 className="text-2xl font-bold">Customer not found</h2><Link to="/customers" className="text-primary hover:underline">Back to customers</Link></div>;
  }

  const customerQuotes = quotes.filter(q => q.customerId === customer.id).sort((a, b) => new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime());

  // Everything below is derived from the customer's REAL quotes, not the stored
  // seed aggregates (which drift out of sync as quotes are added/edited/deleted).
  const totalQuotes = customerQuotes.length;
  const wonQuotes = customerQuotes.filter(q => q.status === 'won');
  const lostQuotes = customerQuotes.filter(q => q.status === 'lost');
  const decided = wonQuotes.length + lostQuotes.length;
  const winRate = decided > 0 ? (wonQuotes.length / decided) * 100 : 0;
  const totalRevenue = wonQuotes.reduce((s, q) => s + q.grandTotal, 0);
  const avgLeadDays = totalQuotes > 0
    ? customerQuotes.reduce((s, q) => s + (q.leadTimeDays || 0), 0) / totalQuotes
    : 0;
  const firstYear = totalQuotes > 0
    ? new Date(customerQuotes[customerQuotes.length - 1].createdDate).getFullYear()
    : new Date().getFullYear();

  // Real trend: quoted value grouped by month (last 6 with activity).
  const byMonth = new Map<string, number>();
  for (const q of customerQuotes) {
    const d = new Date(q.createdDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + q.grandTotal);
  }
  const trendData = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map(([key, value]) => ({
      name: new Date(`${key}-01`).toLocaleDateString(undefined, { month: 'short' }),
      value: Math.round(value),
    }));

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-accent rounded-full transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold">{customer.name}</h1>
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500"></span> Active account since {firstYear}
          </p>
        </div>
        <div className="flex-1"></div>
        <div className="flex gap-2">
           <button className="flex items-center gap-2 border border-border px-4 py-2 rounded-md text-sm font-medium hover:bg-accent transition-all">
             Edit Profile
           </button>
           <Link 
             to="/quotes/new"
             className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90 transition-shadow shadow"
           >
             <Plus size={18} /> New Quote
           </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatsCard icon={FileText} label="Total Quotes" value={totalQuotes} />
            <StatsCard icon={TrendingUp} label="Win Rate" value={decided > 0 ? `${winRate.toFixed(0)}%` : '—'} color={winRate > 40 ? 'text-green-600' : 'text-blue-600'} />
            <StatsCard icon={DollarSign} label="Won Revenue" value={`${symbol}${(totalRevenue / 1000).toFixed(1)}k`} />
            <StatsCard icon={Calendar} label="Avg. Lead" value={totalQuotes > 0 ? `${avgLeadDays.toFixed(0)}d` : '—'} />
          </div>

          <div className="bg-card border border-border p-6 rounded-lg space-y-6">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2 border-b border-border pb-3">
              <TrendingUp size={14} /> Quoted Value by Month
            </h3>
            {trendData.length > 0 ? (
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} />
                    <YAxis axisLine={false} tickLine={false} tickFormatter={(v) => `${symbol}${(v / 1000).toFixed(0)}k`} />
                    <RechartsTooltip formatter={(v: number) => [`${symbol}${v.toLocaleString()}`, 'Quoted']} />
                    <Line type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={3} dot={{ r: 4, fill: 'var(--primary)', strokeWidth: 0 }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-sm text-muted-foreground">
                No quotes yet for this customer.
              </div>
            )}
          </div>

          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="p-4 bg-muted/30 border-b border-border flex justify-between items-center">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Quote History</h3>
              <span className="text-[10px] bg-muted px-2 py-0.5 rounded font-bold">{customerQuotes.length} record{customerQuotes.length !== 1 && 's'}</span>
            </div>
            <div className="overflow-x-auto">
               <table className="w-full text-left font-sans">
                  <thead>
                    <tr className="border-b border-border text-[10px] text-muted-foreground uppercase">
                      <th className="px-6 py-3 font-bold">Quote #</th>
                      <th className="px-6 py-3 font-bold">Part</th>
                      <th className="px-6 py-3 font-bold">Amount</th>
                      <th className="px-6 py-3 font-bold">Created</th>
                      <th className="px-6 py-3 font-bold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {customerQuotes.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-10 text-center text-sm text-muted-foreground">
                          No quotes yet for this customer.
                        </td>
                      </tr>
                    )}
                    {customerQuotes.map(q => {
                      const part = parts.find(p => p.id === q.partId);
                      return (
                        <tr key={q.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-6 py-4">
                            <Link to={`/quotes/${q.id}`} className="text-sm font-medium text-primary hover:underline">{q.quoteNumber}</Link>
                          </td>
                          <td className="px-6 py-4 text-sm font-medium">{part?.name}</td>
                          <td className="px-6 py-4 text-sm font-mono">{symbol}{q.grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                          <td className="px-6 py-4 text-sm text-muted-foreground">{new Date(q.createdDate).toLocaleDateString()}</td>
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
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest border-b border-border pb-3">Account Manager</h3>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-secondary-foreground font-bold">
                SR
              </div>
              <div>
                <p className="text-sm font-semibold">Stan Rodriguez</p>
                <p className="text-xs text-muted-foreground">Senior Account Exec</p>
              </div>
            </div>
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Mail size={14} className="text-primary" /> {customer.email}
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Phone size={14} className="text-primary" /> {customer.phone}
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <MapPin size={14} className="text-primary" /> {customer.address}
              </div>
            </div>
          </div>

          <div className="bg-card border border-border p-6 rounded-lg space-y-4">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest border-b border-border pb-3">Service Terms</h3>
            <div className="space-y-4">
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase">Payment Terms</p>
                <p className="text-sm font-medium">{customer.terms}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase">Standard Packaging</p>
                <p className="text-sm font-medium">Standard Pallet / Crating</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatsCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-card border border-border p-4 rounded-lg shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className="text-muted-foreground" />
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <p className={cn("text-xl font-bold tracking-tight", color || "text-foreground")}>{value}</p>
    </div>
  );
}
