import React, { useEffect, useRef, useState } from 'react';
import { IMPORT_LIMITS, mergeToolCatalogue, type CatalogTool, type ToolImportPreview } from '../utils/solidcamImport';
import { loadState, trySaveState } from '../utils/storage';

const KEY = 'imported-tool-catalogue';
export default function ToolCatalogImporter() {
  const [catalogue, setCatalogue] = useState<CatalogTool[]>(() => loadState(KEY, []));
  const [preview, setPreview] = useState<ToolImportPreview>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [permission, setPermission] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const worker = useRef<Worker | undefined>(undefined);
  const generation = useRef(0);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { generation.current++; worker.current?.terminate(); clearTimeout(timeout.current); }, []);

  const inspect = async (file?: File) => {
    const request = ++generation.current;
    worker.current?.terminate(); clearTimeout(timeout.current);
    setPreview(undefined); setSelected(new Set()); setPermission(false); setMessage(''); setBusy(false); setPage(0); setSearch('');
    if (!file) return;
    if (file.size > IMPORT_LIMITS.fileBytes) { setMessage('The library must be smaller than 64 MiB.'); return; }
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      if (request !== generation.current) return;
      const current = new Worker(new URL('../utils/solidcamImport.worker.ts', import.meta.url), { type: 'module' });
      worker.current = current;
      const finish = (error?: string, result?: ToolImportPreview) => {
        current.terminate();
        if (request !== generation.current) return;
        clearTimeout(timeout.current);
        setBusy(false);
        if (error) setMessage(error);
        if (result) { setPreview(result); setSelected(new Set(result.tools.map(t => t.id))); }
      };
      current.onmessage = event => finish(event.data.error, event.data.preview);
      current.onerror = () => finish('The library parser failed. No tools were saved.');
      timeout.current = setTimeout(() => finish('Import timed out. Try a smaller library.'), 20_000);
      current.postMessage({ bytes, filename: file.name }, [bytes]);
    } catch (error) {
      if (request === generation.current) { setBusy(false); setMessage(error instanceof Error ? error.message : 'Could not read file.'); }
    }
  };
  const save = () => {
    if (!preview || !permission || !selected.size) return;
    try {
      const next = mergeToolCatalogue(catalogue, preview.tools.filter(t => selected.has(t.id)));
      if (!trySaveState(KEY, next)) throw new Error('Browser storage is unavailable or full. Nothing was saved; keep your source library.');
      setMessage(`Saved ${next.length - catalogue.length} new catalogue records; ${next.length} total. Quote tooling and prices were not changed.`);
      setCatalogue(next); setPreview(undefined); setSelected(new Set()); setPermission(false); setPage(0);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Save failed.'); }
  };
  const visible = (preview?.tools ?? catalogue).filter(t => `${t.name} ${t.sourceFile} ${t.components.map(c => `${c.name} ${c.manufacturer ?? ''} ${c.partNumber ?? ''}`).join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="p-6 space-y-5">
    <h3 className="text-lg font-bold">SolidCAM Tool Imports</h3>
    <p className="text-sm text-muted-foreground">Import catalogue metadata from ToolKit schema 11 XML (.tls/.tlv/.xml) or .tkz archives. Files are parsed locally in your browser. Binary .TAB and .etl imports are not supported in this increment.</p>
    <div className="rounded border border-amber-300 bg-amber-50 text-amber-900 p-3 text-sm">Imported catalogue data is separate from shop inventory and does not change quote calculations. Confirm units, availability, material and machine suitability before assigning tools. This is not a full SolidCAM importer or a holder-clearance simulation.</div>
    <label className="block text-sm font-medium">Choose SolidCAM library<input aria-label="SolidCAM library file" className="block mt-2 max-w-full" type="file" accept=".tkz,.tls,.tlv,.xml,.TAB,.etl" onChange={e => void inspect(e.target.files?.[0])} /></label>
    {busy && <p role="status">Reading library metadata…</p>}
    {message && <p role="status" className="text-sm font-medium">{message}</p>}
    {preview && <div className="space-y-3">
      <h4 className="font-semibold">Preview: {preview.sourceFile} — {preview.tools.length} records</h4>
      <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">{preview.notices.map(n => <li key={n}>{n}</li>)}</ul>
      <label className="block text-sm"><input type="checkbox" checked={permission} onChange={e => setPermission(e.target.checked)} /> I have permission to use this library for my intended purpose. Download access alone does not grant commercial redistribution rights.</label>
      <div className="flex flex-wrap gap-3"><button className="border rounded px-3 py-2 text-sm" onClick={() => setSelected(new Set(preview.tools.map(t => t.id)))}>Select all</button><button className="border rounded px-3 py-2 text-sm" onClick={() => setSelected(new Set())}>Clear selection</button><button disabled={!permission || !selected.size} className="rounded px-4 py-2 bg-primary text-primary-foreground disabled:opacity-40" onClick={save}>Import {selected.size} selected records</button></div>
    </div>}
    <h4 className="font-semibold">{preview ? 'Records to review' : `Saved catalogue (${catalogue.length})`}</h4>
    <input aria-label="Search imported tools" placeholder="Search tool, manufacturer or part number" className="w-full rounded border border-border bg-background p-2 text-sm" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
    <div className="space-y-2">{visible.slice(page * 25, (page + 1) * 25).map(tool => <details key={tool.id} className="rounded border border-border p-3 text-sm">
      <summary className="cursor-pointer">{tool.name} · {tool.kind} · Catalogue only</summary>
      {preview && <label className="block my-2"><input type="checkbox" checked={selected.has(tool.id)} onChange={e => setSelected(old => { const next = new Set(old); if (e.target.checked) next.add(tool.id); else next.delete(tool.id); return next; })} /> Include this record</label>}
      <p className="my-2 text-xs break-all">Source: {tool.sourceFile} / {tool.libraryPath} · ID {tool.sourceId} · Schema {tool.schemaVersion}</p>
      {tool.components.map((c, i) => <div key={`${c.sourceId}-${i}`} className="my-2 border-l-2 border-border pl-3 text-xs space-y-1">
        <p className="font-semibold">{c.name || 'Unnamed component'} · ID {c.sourceId}{c.parentId ? ` → parent ${c.parentId}` : ''}</p>
        <p>{c.manufacturer || 'Manufacturer unknown'} · Part: {c.partNumber || 'unknown'} · {c.flutes ? `${c.flutes} flutes` : 'Flutes unspecified'}</p>
        <p>{Object.entries(c.dimensions).map(([key, d]) => `${key}: ${d.mm === undefined ? 'unknown units' : `${Number(d.mm.toFixed(5))} mm`} (source ${d.value}; code ${d.sourceUnit})`).join(' · ') || 'No recognised length fields'}</p>
        {!!c.conditions.length && <p>{c.conditions.length} cutting-condition references; material: {[...new Set(c.conditions.map(cc => cc.material || 'unspecified'))].join(', ')}. Feeds/speeds not activated.</p>}
      </div>)}
      <ul className="list-disc pl-5 text-xs text-amber-700">{tool.warnings.map(w => <li key={w}>{w}</li>)}</ul>
    </details>)}</div>
    {visible.length > 25 && <div className="flex gap-3 text-sm"><button disabled={!page} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page + 1} / {Math.ceil(visible.length / 25)}</span><button disabled={(page + 1) * 25 >= visible.length} onClick={() => setPage(p => p + 1)}>Next</button></div>}
    <p className="text-xs text-muted-foreground">Catalogue records are stored in this browser only. Keep the original export as your backup. Exact reimports are skipped; changed source files are retained as separate revisions.</p>
  </section>;
}
