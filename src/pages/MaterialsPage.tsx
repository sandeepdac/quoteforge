import React, { useState } from 'react';
import { Layers, Plus, Search, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useQuotes } from '../context/QuoteContext';
import { Material } from '../types';
import { cn } from '../utils/cn';

export default function MaterialsPage() {
  const { materials, addMaterial } = useQuotes();
  const [searchTerm, setSearchTerm] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newMaterial, setNewMaterial] = useState({
    name: '',
    thicknessMm: 0,
    density: 7850,
    pricePerKg: 0
  });

  const filteredMaterials = materials.filter(m => 
    m.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleBulkUpdate = () => {
    setIsUpdating(true);
    setTimeout(() => setIsUpdating(false), 2000);
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMaterial.name) return;
    
    addMaterial({
      id: `m${materials.length + 1}`,
      ...newMaterial,
      lastPriceUpdate: new Date().toISOString()
    });
    setNewMaterial({ name: '', thicknessMm: 0, density: 7850, pricePerKg: 0 });
    setIsAdding(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Materials & Rates</h1>
          <p className="text-muted-foreground">Manage raw material costs and physical properties.</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={handleBulkUpdate}
            disabled={isUpdating}
            className="flex items-center gap-2 px-4 py-2 border border-border rounded-md text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
          >
            <RotateCcw size={16} className={isUpdating ? "animate-spin" : ""} />
            {isUpdating ? "Fetching Prices..." : "Update Live Prices"}
          </button>
          <button 
            onClick={() => setIsAdding(!isAdding)}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Plus size={18} />
            {isAdding ? "Cancel" : "Add Material"}
          </button>
        </div>
      </div>

      {isAdding && (
        <form onSubmit={handleAddSubmit} className="bg-card border border-primary/20 p-6 rounded-lg shadow-md animate-in slide-in-from-top-4 duration-300 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Material Name</label>
            <input 
              required
              type="text" 
              placeholder="e.g. Aluminum 5052" 
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={newMaterial.name}
              onChange={e => setNewMaterial({...newMaterial, name: e.target.value})}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Thickness (mm)</label>
            <input 
              required
              type="number" 
              step="0.1"
              placeholder="2.0" 
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={newMaterial.thicknessMm || ''}
              onChange={e => setNewMaterial({...newMaterial, thicknessMm: parseFloat(e.target.value)})}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Price/kg ($)</label>
            <input 
              required
              type="number" 
              step="0.01"
              placeholder="4.50" 
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={newMaterial.pricePerKg || ''}
              onChange={e => setNewMaterial({...newMaterial, pricePerKg: parseFloat(e.target.value)})}
            />
          </div>
          <div className="flex items-end">
            <button type="submit" className="w-full bg-primary text-primary-foreground py-2 rounded-md text-sm font-bold uppercase tracking-widest hover:bg-primary/90 transition-colors shadow-sm">
              Save New Material
            </button>
          </div>
        </form>
      )}

      <div className="bg-card border border-border rounded-lg shadow-sm">
        <div className="p-4 border-b border-border">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <input 
              type="text" 
              placeholder="Search materials..." 
              className="w-full bg-background border border-border rounded-md py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider uppercase leading-snug">Material Name</th>
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider uppercase leading-snug">Thickness (mm)</th>
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider uppercase leading-snug">Density (kg/m³)</th>
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider uppercase leading-snug">Price per kg</th>
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider uppercase leading-snug">Last Updated</th>
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider text-right uppercase leading-snug">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredMaterials.map((material) => (
                <tr key={material.id} className="hover:bg-muted/30 transition-colors group">
                  <td className="px-6 py-4 font-medium text-foreground">{material.name}</td>
                  <td className="px-6 py-4 text-sm text-foreground">{material.thicknessMm.toFixed(1)} mm</td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{material.density.toLocaleString()} kg/m³</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-semibold">$</span>
                      <input 
                        type="number" 
                        defaultValue={material.pricePerKg.toFixed(2)} 
                        className="w-20 bg-background border border-border rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  </td>
                  <td className="px-6 py-4 text-xs text-muted-foreground">Today, 08:32 AM</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-primary transition-colors">
                        <Save size={16} />
                      </button>
                      <button className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
