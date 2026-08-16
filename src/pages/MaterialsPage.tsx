import React, { useState } from 'react';
import { Plus, Search, Save, Trash2 } from 'lucide-react';
import { useQuotes } from '../context/QuoteContext';
import { useMoney } from '../utils/useMoney';
import { cn } from '../utils/cn';

function formatUpdated(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function MaterialsPage() {
  const { materials, addMaterial, updateMaterial, deleteMaterial } = useQuotes();
  const { symbol } = useMoney();
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  // Per-row draft price edits, keyed by material id.
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [newMaterial, setNewMaterial] = useState({
    name: '',
    thicknessMm: 0,
    density: 7850,
    pricePerKg: 0
  });

  const filteredMaterials = materials.filter(m =>
    m.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMaterial.name) return;

    addMaterial({
      id: `m${Date.now()}`,
      ...newMaterial,
      lastPriceUpdate: new Date().toISOString()
    });
    setNewMaterial({ name: '', thicknessMm: 0, density: 7850, pricePerKg: 0 });
    setIsAdding(false);
  };

  const savePrice = (id: string) => {
    const material = materials.find(m => m.id === id);
    const raw = priceEdits[id];
    if (!material || raw === undefined) return;
    const next = parseFloat(raw);
    if (isNaN(next) || next < 0 || next === material.pricePerKg) {
      // Nothing valid to save — just discard the draft.
      setPriceEdits(({ [id]: _, ...rest }) => rest);
      return;
    }
    updateMaterial({ ...material, pricePerKg: next, lastPriceUpdate: new Date().toISOString() });
    setPriceEdits(({ [id]: _, ...rest }) => rest);
  };

  const handleDelete = (id: string, name: string) => {
    if (window.confirm(`Delete material "${name}"? This cannot be undone.`)) {
      deleteMaterial(id);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Materials & Rates</h1>
          <p className="text-muted-foreground">Manage raw material costs and physical properties.</p>
        </div>
        <button
          onClick={() => setIsAdding(!isAdding)}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm self-start"
        >
          <Plus size={18} />
          {isAdding ? "Cancel" : "Add Material"}
        </button>
      </div>

      {isAdding && (
        <form onSubmit={handleAddSubmit} className="bg-card border border-primary/20 p-6 rounded-lg shadow-md grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Material Name</label>
            <input
              required
              type="text"
              placeholder="e.g. Aluminum 5052"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={newMaterial.name}
              onChange={e => setNewMaterial({ ...newMaterial, name: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Thickness (mm)</label>
            <input
              required
              type="number"
              step="0.1"
              min="0"
              placeholder="2.0"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={newMaterial.thicknessMm || ''}
              onChange={e => setNewMaterial({ ...newMaterial, thicknessMm: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Density (kg/m³)</label>
            <input
              required
              type="number"
              step="1"
              min="0"
              placeholder="7850"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={newMaterial.density || ''}
              onChange={e => setNewMaterial({ ...newMaterial, density: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Price/kg ({symbol})</label>
            <input
              required
              type="number"
              step="0.01"
              min="0"
              placeholder="4.50"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              value={newMaterial.pricePerKg || ''}
              onChange={e => setNewMaterial({ ...newMaterial, pricePerKg: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div className="flex items-end">
            <button type="submit" className="w-full bg-primary text-primary-foreground py-2 rounded-md text-sm font-bold uppercase tracking-widest hover:bg-primary/90 transition-colors shadow-sm">
              Save
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
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">Material Name</th>
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">Thickness (mm)</th>
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">Density (kg/m³)</th>
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">Price per kg</th>
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">Last Updated</th>
                <th className="px-6 py-4 text-xs font-medium text-muted-foreground uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredMaterials.map((material) => {
                const draft = priceEdits[material.id];
                const isDirty = draft !== undefined && parseFloat(draft) !== material.pricePerKg && !isNaN(parseFloat(draft));
                return (
                  <tr key={material.id} className="hover:bg-muted/30 transition-colors group">
                    <td className="px-6 py-4 font-medium text-foreground">{material.name}</td>
                    <td className="px-6 py-4 text-sm text-foreground">{material.thicknessMm.toFixed(1)} mm</td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">{material.density.toLocaleString()} kg/m³</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-semibold">{symbol}</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={draft ?? material.pricePerKg.toFixed(2)}
                          onChange={(e) => setPriceEdits({ ...priceEdits, [material.id]: e.target.value })}
                          onKeyDown={(e) => { if (e.key === 'Enter') savePrice(material.id); }}
                          className="w-20 bg-background border border-border rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs text-muted-foreground">{formatUpdated(material.lastPriceUpdate)}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => savePrice(material.id)}
                          disabled={!isDirty}
                          title="Save price"
                          className={cn(
                            "p-1.5 rounded transition-colors",
                            isDirty
                              ? "text-primary hover:bg-muted"
                              : "text-muted-foreground/40 cursor-not-allowed"
                          )}
                        >
                          <Save size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(material.id, material.name)}
                          title="Delete material"
                          className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredMaterials.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground italic">
                    No materials found.
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
