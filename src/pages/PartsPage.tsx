import React, { useState } from 'react';
import { Search, Filter, Plus, Calendar, Clock, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuotes } from '../context/QuoteContext';
import { cn } from '../utils/cn';

export default function PartsPage() {
  const { parts, materials } = useQuotes();
  const [searchTerm, setSearchTerm] = useState('');
  const [materialFilter, setMaterialFilter] = useState('all');

  const filteredParts = parts.filter(p => {
    const material = materials.find(m => m.id === p.materialId);
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesMaterial = materialFilter === 'all' || p.materialId === materialFilter;
    return matchesSearch && matchesMaterial;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Parts Library</h1>
          <p className="text-muted-foreground">Manage your reusable parts and extraction history.</p>
        </div>
        <button className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm">
          <Plus size={18} />
          Create Part
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
          <input 
            type="text" 
            placeholder="Search by part name..." 
            className="w-full bg-background border border-border rounded-md py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <select 
            className="bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            value={materialFilter}
            onChange={(e) => setMaterialFilter(e.target.value)}
          >
            <option value="all">All Materials</option>
            {materials.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <button className="flex items-center gap-2 px-4 py-2 bg-muted border border-border rounded-md text-sm font-medium hover:bg-accent transition-colors">
            <Filter size={16} />
            More
          </button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-widest">Part Name</th>
                <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-widest">Material</th>
                <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-widest">Thickness</th>
                <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-widest">Quote Count</th>
                <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-widest">Last Quoted</th>
                <th className="px-6 py-4 text-xs font-bold text-muted-foreground uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredParts.map((part) => {
                const material = materials.find(m => m.id === part.materialId);
                return (
                  <tr key={part.id} className="hover:bg-muted/30 transition-colors group">
                    <td className="px-6 py-4">
                      <Link to={`/parts/${part.id}`} className="font-semibold text-[#0a0a0a] hover:text-primary transition-colors">
                        {part.name}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      {material?.name || 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-sm text-foreground font-medium">
                      {part.thicknessMm} mm
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-accent text-accent-foreground text-[10px] font-bold uppercase">
                        {part.quoteCount} Quotes
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      {part.lastQuotedDate ? new Date(part.lastQuotedDate).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link to={`/parts/${part.id}`} className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline uppercase tracking-wider">
                        Details <ArrowRight size={14} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {filteredParts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground italic">
                    No parts found matching your criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
