import React, { useState } from 'react';
import type { ShopTool, TurningOp, TurningToolAssembly } from '../types';
import { seedTurningInventory } from '../utils/turningTools';

const OPS: { op: TurningOp; label: string }[] = [
  { op: 'face', label: 'Facing' }, { op: 'rough', label: 'Roughing' },
  { op: 'drill', label: 'Drilling' }, { op: 'bore', label: 'Boring' },
  { op: 'finish', label: 'Finishing' }, { op: 'partoff', label: 'Part-off' },
];
const DIMENSIONS = [
  ['noseRadiusMm', 'Nose radius'], ['diameterMm', 'Diameter'], ['cuttingLengthMm', 'Cutting length'],
  ['usableReachMm', 'Usable reach'], ['minBoreMm', 'Minimum bore'],
] as const;
const inputClass = 'w-full rounded border border-border bg-background px-2 py-1.5 text-sm';

export default function TurningLibraryEditor({ tools, assemblies: existing, onSave }: {
  tools: ShopTool[];
  assemblies?: TurningToolAssembly[];
  onSave: (tools: ShopTool[], assemblies: TurningToolAssembly[]) => void;
}) {
  const [initial] = useState(() => seedTurningInventory(tools, existing));
  const [assemblies, setAssemblies] = useState(initial.assemblies);
  const [assignments, setAssignments] = useState(initial.assignments);
  const [message, setMessage] = useState('');
  const update = (id: string, patch: Partial<TurningToolAssembly>) => {
    setAssemblies(rows => rows.map(a => a.id === id ? { ...a, ...patch } : a));
    setMessage('');
  };
  const assign = (op: TurningOp, assemblyId: string) => {
    setAssignments(rows => [...rows.filter(t => t.op !== op), { op, assemblyId: assemblyId || undefined, station: '', description: '' }]);
    setMessage('');
  };
  const save = () => {
    if (assemblies.some(a => !a.description.trim() || !/^T\d{4}$/i.test(a.station.trim()))) {
      setMessage('Give each assembly a description and a four-digit station/offset call, e.g. T0101.');
      return;
    }
    if (assemblies.some(a => DIMENSIONS.some(([key]) => a[key] !== undefined && (!Number.isFinite(a[key]) || a[key]! < 0)))) {
      setMessage('Dimensions must be finite, non-negative millimetres. Leave unknown dimensions blank.');
      return;
    }
    const clean = assemblies.map(a => ({ ...a, station: a.station.trim().toUpperCase(), description: a.description.trim() }));
    const stations = clean.map(a => a.station);
    if (new Set(stations).size !== stations.length) {
      setMessage('This library is a single turning setup template: use unique station/offset calls. Assign the same assembly to shared operations.');
      return;
    }
    const next = OPS.map(({ op }) => {
      const row = assignments.find(t => t.op === op);
      const assembly = clean.find(a => a.id === row?.assemblyId);
      return { op, assemblyId: assembly?.id, station: assembly?.station ?? '', description: assembly?.description ?? '', noseRadiusMm: assembly?.noseRadiusMm };
    });
    onSave(next, clean);
    setMessage('Saved. Create or recalculate a quote to use these assignments; saved historical quotes are unchanged.');
  };
  return <section className="space-y-5">
    <div>
      <h4 className="font-bold">Turning tool assemblies</h4>
      <p className="text-xs text-muted-foreground mt-1">One reusable record per holder/cutter assembly. This first version is a single turning setup template, not machine-specific inventory. Station assignments drive tool-selection counts and setup preparation. Dimensions and source notes are stored for review; automatic clearance, cutting-data and tool-life validation are not implemented yet.</p>
    </div>
    {assemblies.map(a => <fieldset key={a.id} className="rounded-lg border border-border p-4 space-y-3">
      <legend className="px-1 text-xs font-semibold">{a.id} · {a.inventoryConfirmed ? 'Inventory confirmed' : 'Unconfirmed inventory'}</legend>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="text-xs">Station / offset<input aria-label={`Station ${a.id}`} className={inputClass} value={a.station} onChange={e => update(a.id, { station: e.target.value, inventoryConfirmed: false })} /></label>
        <label className="text-xs sm:col-span-2">Holder / cutter / insert description<input className={inputClass} value={a.description} onChange={e => update(a.id, { description: e.target.value, inventoryConfirmed: false })} /></label>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {DIMENSIONS.map(([key, label]) => <label key={key} className="text-xs">{label} (mm)<input className={inputClass} type="number" min="0" step="any" value={a[key] ?? ''} placeholder="Unknown" onChange={e => update(a.id, { [key]: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>)}
      </div>
      <label className="block text-xs">Manufacturer reference / shop source / notes<input className={inputClass} value={a.source ?? ''} onChange={e => update(a.id, { source: e.target.value })} placeholder="Part number, catalogue reference or shop inventory record" /></label>
      <div className="flex items-center justify-between gap-3">
        <label className="text-xs"><input type="checkbox" checked={a.inventoryConfirmed ?? false} onChange={e => update(a.id, { inventoryConfirmed: e.target.checked })} /> Shop confirms this assembly is in inventory (not suitability approval)</label>
        <button type="button" className="text-xs text-red-600 disabled:opacity-40" disabled={assignments.some(t => t.assemblyId === a.id)} onClick={() => { setAssemblies(rows => rows.filter(t => t.id !== a.id)); setMessage(''); }}>Remove unused</button>
      </div>
    </fieldset>)}
    <button type="button" className="rounded border border-border px-3 py-2 text-sm" onClick={() => {
      setAssemblies(rows => [...rows, { id: `tool-${crypto.randomUUID()}`, station: '', description: '', inventoryConfirmed: false }]);
      setMessage('');
    }}>+ Add assembly</button>
    <div className="rounded-lg border border-border p-4 space-y-3">
      <h4 className="font-semibold">Operation assignments</h4>
      <p className="text-xs text-muted-foreground">Facing and roughing can share one assembly. Adjacent uses count once; returning to an earlier tool counts another selection. Initial selection is included. Grooving, threading, tapping and cross-feature tools remain provisional grouped allowances.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{OPS.map(({ op, label }) => <label className="text-xs" key={op}>{label}
        <select className={inputClass} value={assignments.find(t => t.op === op)?.assemblyId ?? ''} onChange={e => assign(op, e.target.value)}>
          <option value="">Unassigned — requires review</option>
          {assemblies.map(a => <option key={a.id} value={a.id}>{a.station || '?'} — {a.description || 'Unnamed assembly'}</option>)}
        </select>
      </label>)}</div>
    </div>
    <button type="button" onClick={save} className="rounded bg-primary text-primary-foreground px-5 py-2 font-semibold">Save Tool Library</button>
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
