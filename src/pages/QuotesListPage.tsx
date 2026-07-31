import React, { useState } from 'react';
import { Search, Filter, ArrowUpDown, ChevronDown, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuotes } from '../context/QuoteContext';
import StatusPill from '../components/common/StatusPill';
import { QuoteStatus } from '../types';
import { cn } from '../utils/cn';

export default function QuotesListPage() {
  const { quotes, customers, parts } = useQuotes();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | 'all'>('all');

  const filteredQuotes = quotes.filter(q => {
    const customer = customers.find(c => c.id === q.customerId);
    const part = parts.find(p => p.id === q.partId);
    
    const matchesSearch = 
      q.quoteNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      part?.name.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || q.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const statuses: (QuoteStatus | 'all')[] = ['all', 'draft', 'sent', 'won', 'lost', 'expired'];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Quotations</h1>
          <p className="text-muted-foreground">Manage and track all customer estimates.</p>
        </div>
        <Link 
          to="/quotes/new"
          className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Plus size={18} />
          New Quote
        </Link>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-sm">
        <div className="p-4 border-b border-border space-y-4">
          <div className="flex flex-wrap gap-2">
            {statuses.map(status => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium transition-all capitalize",
                  statusFilter === status 
                    ? "bg-primary text-primary-foreground shadow-sm" 
                    : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {status}
              </button>
            ))}
          </div>
          
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
              <input 
                type="text" 
                placeholder="Search by quote #, customer, or part..." 
                className="w-full bg-background border border-border rounded-md py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <button className="flex items-center gap-2 px-4 py-2 bg-muted border border-border rounded-md text-sm font-medium hover:bg-accent transition-colors">
              <Filter size={16} />
              Advanced Filters
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <div className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors uppercase">
                    Quote # <ArrowUpDown size={12} />
                  </div>
                </th>
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider uppercase leading-snug">Customer</th>
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider uppercase leading-snug">Part</th>
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider uppercase leading-snug">Quantity</th>
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider uppercase leading-snug">Total</th>
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider uppercase leading-snug">Status</th>
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider uppercase leading-snug">Created</th>
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider uppercase leading-snug">Margin</th>
              </tr>
            </thead>
            <tbody>
              {filteredQuotes.map((quote) => {
                const customer = customers.find(c => c.id === quote.customerId);
                const part = parts.find(p => p.id === quote.partId);
                return (
                  <tr key={quote.id} className="border-b border-border hover:bg-muted/30 transition-colors last:border-0">
                    <td className="px-6 py-4">
                      <Link to={`/quotes/${quote.id}`} className="text-sm font-medium text-primary hover:underline">
                        {quote.quoteNumber}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-sm text-foreground">
                      <div className="flex flex-col">
                        <span>{customer?.name}</span>
                        <span className="text-xs text-muted-foreground">{customer?.contactName}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-foreground">{part?.name}</td>
                    <td className="px-6 py-4 text-sm text-foreground">{quote.quantity}</td>
                    <td className="px-6 py-4 text-sm font-medium text-foreground">
                      ${quote.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4">
                      <StatusPill status={quote.status} />
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      {new Date(quote.createdDate).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-foreground">{(quote.marginPercent * 100).toFixed(0)}%</span>
                        <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden hidden sm:block">
                          <div 
                            className="h-full bg-primary" 
                            style={{ width: `${quote.marginPercent * 100}%` }}
                          ></div>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredQuotes.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-muted-foreground italic">
                    No quotes found match your search criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        <div className="p-4 border-t border-border flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {filteredQuotes.length} of {quotes.length} total quotes
          </p>
          <div className="flex gap-2">
            <button disabled className="px-3 py-1 bg-muted border border-border rounded text-xs opacity-50 cursor-not-allowed">Previous</button>
            <button disabled className="px-3 py-1 bg-muted border border-border rounded text-xs opacity-50 cursor-not-allowed">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}
