import React, { useState } from 'react';
import { Search, Filter, Plus, Users, UserPlus, ArrowRight, TrendingUp, Mail, Phone } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuotes } from '../context/QuoteContext';
import { cn } from '../utils/cn';

export default function CustomersPage() {
  const { customers, quotes } = useQuotes();
  const [searchTerm, setSearchTerm] = useState('');

  // Per-customer activity is computed LIVE from real quotes, not stored aggregates.
  const statsFor = (customerId: string) => {
    const cq = quotes.filter(q => q.customerId === customerId);
    const won = cq.filter(q => q.status === 'won');
    const decided = won.length + cq.filter(q => q.status === 'lost').length;
    const lastQuoteDate = cq.reduce<string | undefined>((m, q) => (!m || q.createdDate > m ? q.createdDate : m), undefined);
    return {
      totalQuotes: cq.length,
      winRate: decided > 0 ? (won.length / decided) * 100 : 0,
      totalRevenue: won.reduce((s, q) => s + q.grandTotal, 0),
      lastQuoteDate,
    };
  };

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.contactName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Customers</h1>
          <p className="text-muted-foreground">Manage relationships and track customer lifecycle.</p>
        </div>
        <button className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm">
          <UserPlus size={18} />
          Add Customer
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
          <input 
            type="text" 
            placeholder="Search by name or contact..." 
            className="w-full bg-background border border-border rounded-md py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-muted border border-border rounded-md text-sm font-medium hover:bg-accent transition-colors">
          <Filter size={16} />
          Filters
        </button>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left font-sans">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">Company</th>
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">Win Rate</th>
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Quotes</th>
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Revenue</th>
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">Last Quote</th>
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredCustomers.map((customer) => {
                const { totalQuotes, winRate, totalRevenue, lastQuoteDate } = statsFor(customer.id);
                return (
                  <tr key={customer.id} className="hover:bg-muted/30 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <Link to={`/customers/${customer.id}`} className="text-sm font-medium text-primary hover:underline">{customer.name}</Link>
                        <span className="text-xs text-muted-foreground">{customer.contactName}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                       <div className="flex items-center gap-2">
                         <span className={cn(
                           "text-sm font-medium",
                           winRate > 50 ? "text-green-600 dark:text-green-400" : 
                           winRate > 25 ? "text-blue-600 dark:text-blue-400" : "text-red-500"
                         )}>
                           {winRate.toFixed(0)}%
                         </span>
                         <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
                           <div 
                             className={cn("h-full", winRate > 50 ? "bg-green-500" : winRate > 25 ? "bg-blue-500" : "bg-red-500")} 
                             style={{ width: `${winRate}%` }}
                           ></div>
                         </div>
                       </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-foreground">{totalQuotes}</td>
                    <td className="px-6 py-4 text-sm font-medium text-foreground">
                      ${totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      {lastQuoteDate ? new Date(lastQuoteDate).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="px-6 py-4 text-right">
                       <Link to={`/customers/${customer.id}`} className="text-muted-foreground hover:text-primary transition-colors inline-block">
                         <ArrowRight size={18} />
                       </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
