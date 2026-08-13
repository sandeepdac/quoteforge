import React, { useState } from 'react';
import { 
  Settings as SettingsIcon, 
  User, 
  Building, 
  DollarSign, 
  Zap, 
  Shield, 
  Mail,
  Save,
  Moon,
  Sun,
  RotateCcw,
  Calculator,
  Paintbrush,
  Plus,
  Trash2
} from 'lucide-react';
import { Wrench } from 'lucide-react';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../context/ThemeContext';
import { cn } from '../utils/cn';
import { clearAllState } from '../utils/storage';
import { DEFAULT_CNC_SETTINGS, DEFAULT_SECONDARY_OPS, DEFAULT_TURNING_TOOLS } from '../constants';
import { CncSettings, SecondaryCategory, SecondaryOperation, ShopTool, TurningOp } from '../types';
import { CURRENCIES, currencySymbol } from '../utils/currency';

export default function SettingsPage() {
  const { settings, updateSettings } = useSettings();
  const { theme, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState('shop');

  const handleResetDemoData = () => {
    const confirmed = window.confirm(
      'Reset all quotes, parts, customers, materials and shop settings back to the demo defaults? This clears locally saved data and cannot be undone.'
    );
    if (!confirmed) return;
    clearAllState();
    window.location.reload();
  };

  const tabs = [
    { id: 'shop', name: 'Shop Info', icon: Building },
    { id: 'rates', name: 'Labor Rates', icon: DollarSign },
    { id: 'estimate', name: 'Estimate', icon: Calculator },
    { id: 'margins', name: 'Margins', icon: Zap },
    { id: 'tooling', name: 'Tooling', icon: Wrench },
    { id: 'secondary', name: 'Secondary Ops', icon: Paintbrush },
    { id: 'account', name: 'Preferences', icon: SettingsIcon },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Global Settings</h1>
        <p className="text-muted-foreground">Configure your shop rates, margins, and account preferences.</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        <aside className="lg:w-64 space-y-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm font-medium transition-all",
                activeTab === tab.id 
                  ? "bg-primary text-primary-foreground shadow-sm" 
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <tab.icon size={18} />
              {tab.name}
            </button>
          ))}
        </aside>

        <div className="flex-1 bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          {activeTab === 'shop' && (
            <div className="p-8 space-y-6 animate-in slide-in-from-right-4 duration-300">
              <h3 className="text-lg font-bold border-b border-border pb-4">Shop Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <InputGroup label="Shop Name" defaultValue={settings.name} />
                <InputGroup label="Shop Website" defaultValue="https://forgefabs.example.com" />
                <div className="col-span-2">
                  <InputGroup label="Main Address" defaultValue={settings.address} />
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Shop Logo</p>
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-muted rounded-lg border border-border flex items-center justify-center overflow-hidden">
                      <img src={settings.logo} alt="Logo" className="w-full h-full object-cover" />
                    </div>
                    <button className="text-xs font-bold text-primary hover:underline">Change Logo</button>
                  </div>
                </div>
              </div>
              <div className="pt-6 border-t border-border flex justify-end">
                <button className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2 rounded-md text-sm font-medium hover:bg-primary/90 transition-shadow shadow">
                  <Save size={16} /> Save Changes
                </button>
              </div>
            </div>
          )}

          {activeTab === 'rates' && (
            <div className="p-8 space-y-6 animate-in slide-in-from-right-4 duration-300">
              <h3 className="text-lg font-bold border-b border-border pb-4">Equipment & Labor Rates</h3>
              <div className="space-y-6">
                <RateRow label="Laser Cutting" value={settings.rates.laserPerMin} unit="/ min" description="Per-minute cost for fiber laser operation" />
                <RateRow label="Press Brake" value={settings.rates.pressBrakePerMin} unit="/ min" description="Bending setup and stroke time cost" />
                <RateRow label="Welding Station" value={settings.rates.welderPerMin} unit="/ min" description="Manual and robotic welding labor rate" />
                <RateRow label="Assembly" value={settings.rates.assemblyPerMin} unit="/ min" description="Post-processing and handling rate" />
                <RateRow label="Finishing (Powder)" value={settings.rates.finishRatePerM2} unit="/ m²" description="Based on part surface area" />
              </div>
              <div className="pt-6 border-t border-border flex justify-end">
                <button className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2 rounded-md text-sm font-medium hover:bg-primary/90 transition-shadow shadow">
                  <Save size={16} /> Save Rates
                </button>
              </div>
            </div>
          )}

          {activeTab === 'estimate' && (
            <EstimateTab
              cnc={settings.cnc ?? DEFAULT_CNC_SETTINGS}
              currency={settings.currency ?? 'USD'}
              onSaveCnc={(patch) => updateSettings({ cnc: patch as CncSettings })}
              onSaveCurrency={(currency) => updateSettings({ currency })}
            />
          )}

          {activeTab === 'margins' && (
            <div className="p-8 space-y-6 animate-in slide-in-from-right-4 duration-300">
              <h3 className="text-lg font-bold border-b border-border pb-4">Standard Margins</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-2">
                  <div className="flex justify-between items-end">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Default Profit Margin</p>
                    <span className="text-lg font-bold text-primary">{(settings.defaultMargin * 100).toFixed(0)}%</span>
                  </div>
                  <input type="range" min="5" max="50" className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary" />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-end">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Rush Order Premium</p>
                    <span className="text-lg font-bold text-orange-500">{(settings.rushPremiumPercent * 100).toFixed(0)}%</span>
                  </div>
                  <input type="range" min="10" max="100" className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-orange-500" />
                </div>
                <div className="space-y-2">
                   <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest leading-loose">Shop Overhead (%)</p>
                   <input type="number" defaultValue={(settings.overheadPercent * 100).toFixed(0)} className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm" />
                </div>
                <div className="space-y-2">
                   <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest leading-loose">Scrap Factor (%)</p>
                   <input type="number" defaultValue={(settings.scrapFactor * 100).toFixed(0)} className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="pt-6 border-t border-border flex justify-end">
                <button className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2 rounded-md text-sm font-medium hover:bg-primary/90 transition-shadow shadow">
                  <Save size={16} /> Sync Rules
                </button>
              </div>
            </div>
          )}

          {activeTab === 'tooling' && (
            <ToolingTab
              tools={settings.cnc?.toolLibrary ?? DEFAULT_TURNING_TOOLS}
              onSave={(toolLibrary) => updateSettings({ cnc: { toolLibrary } as Partial<CncSettings> as CncSettings })}
              flatSetupCharge={settings.cnc?.flatSetupChargePerSetup ?? 0}
              onSaveSetupCharge={(flatSetupChargePerSetup) =>
                updateSettings({ cnc: { flatSetupChargePerSetup } as Partial<CncSettings> as CncSettings })
              }
              setupMode={settings.cnc?.setupBillingMode ?? 'both'}
              onSaveSetupMode={(setupBillingMode) =>
                updateSettings({ cnc: { setupBillingMode } as Partial<CncSettings> as CncSettings })
              }
            />
          )}

          {activeTab === 'secondary' && (
            <SecondaryOpsTab
              ops={settings.secondaryOps ?? DEFAULT_SECONDARY_OPS}
              currency={currencySymbol(settings.currency)}
              onSave={(secondaryOps) => updateSettings({ secondaryOps })}
            />
          )}

          {activeTab === 'account' && (
            <div className="p-8 space-y-6 animate-in slide-in-from-right-4 duration-300">
              <h3 className="text-lg font-bold border-b border-border pb-4">Personal Preferences</h3>
              <div className="space-y-6">
                <div className="flex items-center justify-between p-4 bg-muted/20 border border-border rounded-lg">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-accent rounded-lg text-foreground">
                      {theme === 'light' ? <Sun size={20} /> : <Moon size={20} />}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Appearance Mode</p>
                      <p className="text-xs text-muted-foreground">Currently using {theme} mode</p>
                    </div>
                  </div>
                  <button 
                    onClick={toggleTheme}
                    className="px-4 py-2 border border-border rounded-md text-xs font-bold uppercase tracking-widest hover:bg-accent transition-colors"
                  >
                    Toggle {theme === 'light' ? 'Dark' : 'Light'}
                  </button>
                </div>

                <div className="flex items-center justify-between p-4 bg-muted/20 border border-border rounded-lg opacity-50 cursor-not-allowed">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-accent rounded-lg text-foreground">
                      <Mail size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Email Notifications</p>
                      <p className="text-xs text-muted-foreground">Send daily summary of won quotes</p>
                    </div>
                  </div>
                  <div className="w-10 h-5 bg-primary/30 rounded-full relative">
                    <div className="absolute right-0.5 top-0.5 w-4 h-4 bg-white rounded-full"></div>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-muted/20 border border-border rounded-lg opacity-50 cursor-not-allowed">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-accent rounded-lg text-foreground">
                      <Shield size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Automatic Quote Expiry</p>
                      <p className="text-xs text-muted-foreground">Default to 30 days valid until</p>
                    </div>
                  </div>
                  <div className="w-10 h-5 bg-primary rounded-full relative">
                    <div className="absolute right-0.5 top-0.5 w-4 h-4 bg-white rounded-full"></div>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between p-4 bg-muted/20 border border-border rounded-lg">
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-accent rounded-lg text-foreground">
                    <RotateCcw size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Reset Demo Data</p>
                    <p className="text-xs text-muted-foreground">Restore quotes, parts, customers &amp; settings to defaults</p>
                  </div>
                </div>
                <button
                  onClick={handleResetDemoData}
                  className="px-4 py-2 border border-destructive/40 text-destructive rounded-md text-xs font-bold uppercase tracking-widest hover:bg-destructive/10 transition-colors"
                >
                  Reset
                </button>
              </div>

              <div className="pt-6 border-t border-border mt-12 flex items-center justify-between">
                <button className="text-xs font-bold text-destructive hover:underline">Delete Account</button>
                <div className="text-[10px] text-muted-foreground font-mono">v4.1.2-stable (Forge Edition)</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const OP_ROWS: { op: TurningOp; label: string; hint: string }[] = [
  { op: 'face', label: 'Facing', hint: 'Skim the end flat' },
  { op: 'rough', label: 'Roughing', hint: 'OD stock removal' },
  { op: 'drill', label: 'Drilling', hint: 'Pilot / through hole' },
  { op: 'bore', label: 'Boring', hint: 'Open bore to size' },
  { op: 'finish', label: 'Finishing', hint: 'Final OD pass' },
  { op: 'partoff', label: 'Part-off', hint: 'Cut off at length' },
];

/** Seed all five ops in machining order, filling gaps from the defaults. */
function normalise(tools: ShopTool[]): ShopTool[] {
  return OP_ROWS.map(({ op }) => {
    const found = tools.find((t) => t.op === op);
    return found ?? DEFAULT_TURNING_TOOLS.find((t) => t.op === op)!;
  });
}

/**
 * ESTIMATE settings — the client-facing cost inputs, mirroring a CAM estimator's
 * Estimate panel: the shop enters its own machining rate, feed override, tool-
 * change time and quoting currency, and every machining quote uses them.
 */
function EstimateTab({
  cnc,
  currency,
  onSaveCnc,
  onSaveCurrency,
}: {
  cnc: CncSettings;
  currency: string;
  onSaveCnc: (patch: Partial<CncSettings>) => void;
  onSaveCurrency: (code: string) => void;
}) {
  const [rateHr, setRateHr] = useState(String(Math.round((cnc.machineRatePerMin ?? 1.25) * 60)));
  const [feed, setFeed] = useState(String(cnc.feedrateRatioPercent ?? 100));
  const [toolChange, setToolChange] = useState(String(cnc.millToolChangeSec ?? 10));
  const [saved, setSaved] = useState('');
  const flash = (what: string) => {
    setSaved(what);
    window.setTimeout(() => setSaved(''), 1600);
  };

  const saveRate = () => {
    const perHr = Math.max(1, Number(rateHr) || 0);
    setRateHr(String(Math.round(perHr)));
    onSaveCnc({ machineRatePerMin: perHr / 60 });
    flash('Machining rate');
  };
  const saveFeed = () => {
    const pct = Math.min(300, Math.max(10, Math.round(Number(feed) || 100)));
    setFeed(String(pct));
    onSaveCnc({ feedrateRatioPercent: pct });
    flash('Feedrate ratio');
  };
  const saveToolChange = () => {
    const s = Math.max(0, Number(toolChange) || 0);
    setToolChange(String(s));
    onSaveCnc({ millToolChangeSec: s });
    flash('Tool change time');
  };

  return (
    <div className="p-8 space-y-6 animate-in slide-in-from-right-4 duration-300">
      <div className="border-b border-border pb-4">
        <h3 className="text-lg font-bold">Estimate Settings</h3>
        <p className="text-sm text-muted-foreground mt-1">
          The cost inputs behind every machining quote. Enter your own shop rate, feed override and quoting currency — these drive the
          machining time and cost on turned and milled parts.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <SettingField
          label="Machining Rate"
          hint="Spindle charge-out for cutting time"
          unit="$ / hr"
        >
          <input
            type="number"
            step="5"
            min="1"
            value={rateHr}
            onChange={(e) => setRateHr(e.target.value)}
            onBlur={saveRate}
            className="w-28 bg-background border border-border rounded px-3 py-2 text-sm text-right font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </SettingField>

        <SettingField
          label="Feedrate Ratio"
          hint="100% = programmed feed; lower = slower"
          unit="%"
        >
          <input
            type="number"
            step="5"
            min="10"
            max="300"
            value={feed}
            onChange={(e) => setFeed(e.target.value)}
            onBlur={saveFeed}
            className="w-28 bg-background border border-border rounded px-3 py-2 text-sm text-right font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </SettingField>

        <SettingField
          label="Tool Change Time"
          hint="ATC swap time added per distinct tool"
          unit="s"
        >
          <input
            type="number"
            step="1"
            min="0"
            value={toolChange}
            onChange={(e) => setToolChange(e.target.value)}
            onBlur={saveToolChange}
            className="w-28 bg-background border border-border rounded px-3 py-2 text-sm text-right font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </SettingField>

        <SettingField label="Currency" hint="Symbol shown on machining quotes" unit="">
          <select
            value={currency}
            onChange={(e) => {
              onSaveCurrency(e.target.value);
              flash('Currency');
            }}
            className="w-56 bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </SettingField>
      </div>

      <div className="pt-6 border-t border-border flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          Changes save automatically and apply to the next quote you generate.
        </p>
        {saved && <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{saved} saved ✓</span>}
      </div>
    </div>
  );
}

const SECONDARY_CATEGORIES: SecondaryCategory[] = [
  'plating', 'anodize', 'coating', 'passivate', 'heattreat', 'inspection', 'other',
];

/**
 * SECONDARY OPS catalogue — the shop's finishing / inspection work centres and
 * their rates (subcon lot charge + per-part). These are selectable per quote and
 * fold into the machining cost with the shop's overhead + margin.
 */
function SecondaryOpsTab({
  ops,
  currency,
  onSave,
}: {
  ops: SecondaryOperation[];
  currency: string;
  onSave: (ops: SecondaryOperation[]) => void;
}) {
  const [rows, setRows] = useState<SecondaryOperation[]>(() => ops.map((o) => ({ ...o })));
  const [saved, setSaved] = useState(false);

  const update = (id: string, patch: Partial<SecondaryOperation>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setSaved(false);
  };
  const remove = (id: string) => {
    setRows((rs) => rs.filter((r) => r.id !== id));
    setSaved(false);
  };
  const add = () => {
    setRows((rs) => [
      ...rs,
      { id: `op-${Date.now()}`, name: 'New operation', category: 'other', lotCharge: 0, perPartCost: 0 },
    ]);
    setSaved(false);
  };
  const save = () => {
    onSave(rows);
    setSaved(true);
  };
  const reset = () => {
    setRows(DEFAULT_SECONDARY_OPS.map((o) => ({ ...o })));
    setSaved(false);
  };

  const numInput =
    'w-24 bg-background border border-border rounded px-2 py-1 font-mono text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary';

  return (
    <div className="p-8 space-y-6 animate-in slide-in-from-right-4 duration-300">
      <div className="border-b border-border pb-4">
        <h3 className="text-lg font-bold">Secondary Operations</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Finishing &amp; inspection work centres a job routes through after machining (plating, anodise, heat-treat, FAI). Each carries a
          one-time <strong className="text-foreground">lot charge</strong> (amortised over the batch) plus a <strong className="text-foreground">per-part</strong> cost.
          Pick which apply on the quote review screen.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground text-left">
              <th className="pb-2 pr-3">Operation</th>
              <th className="pb-2 pr-3">Category</th>
              <th className="pb-2 pr-3 text-right">Lot charge ({currency})</th>
              <th className="pb-2 pr-3 text-right">Per part ({currency})</th>
              <th className="pb-2 pr-3 text-right">Lead (days)</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="py-2 pr-3">
                  <input
                    value={r.name}
                    onChange={(e) => update(r.id, { name: e.target.value })}
                    className="w-full min-w-[200px] bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </td>
                <td className="py-2 pr-3">
                  <select
                    value={r.category}
                    onChange={(e) => update(r.id, { category: e.target.value as SecondaryCategory })}
                    className="bg-background border border-border rounded px-2 py-1 text-sm capitalize focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {SECONDARY_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-3 text-right">
                  <input
                    type="number" step="5" min="0" value={r.lotCharge}
                    onChange={(e) => update(r.id, { lotCharge: Math.max(0, Number(e.target.value) || 0) })}
                    className={numInput}
                  />
                </td>
                <td className="py-2 pr-3 text-right">
                  <input
                    type="number" step="0.5" min="0" value={r.perPartCost}
                    onChange={(e) => update(r.id, { perPartCost: Math.max(0, Number(e.target.value) || 0) })}
                    className={numInput}
                  />
                </td>
                <td className="py-2 pr-3 text-right">
                  <input
                    type="number" step="1" min="0" value={r.leadTimeDays ?? ''}
                    onChange={(e) => update(r.id, { leadTimeDays: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) || 0) })}
                    className="w-16 bg-background border border-border rounded px-2 py-1 font-mono text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="—"
                  />
                </td>
                <td className="py-2 text-right">
                  <button onClick={() => remove(r.id)} className="text-muted-foreground hover:text-destructive p-1" title="Remove">
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button onClick={add} className="flex items-center gap-2 text-xs font-bold text-primary hover:underline">
        <Plus size={14} /> Add operation
      </button>

      <div className="pt-6 border-t border-border flex items-center justify-between">
        <button onClick={reset} className="text-xs font-bold text-muted-foreground hover:text-foreground uppercase tracking-widest">
          Reset to defaults
        </button>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Saved ✓</span>}
          <button
            onClick={save}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2 rounded-md text-sm font-medium hover:bg-primary/90 transition-shadow shadow"
          >
            <Save size={16} /> Save Catalogue
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingField({
  label,
  hint,
  unit,
  children,
}: {
  label: string;
  hint: string;
  unit: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-4 rounded-lg border border-border bg-muted/10 space-y-2">
      <div>
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="flex items-center gap-2">
        {children}
        {unit && <span className="text-xs text-muted-foreground font-medium">{unit}</span>}
      </div>
    </div>
  );
}

function ToolingTab({
  tools,
  onSave,
  flatSetupCharge,
  onSaveSetupCharge,
  setupMode,
  onSaveSetupMode,
}: {
  tools: ShopTool[];
  onSave: (t: ShopTool[]) => void;
  flatSetupCharge: number;
  onSaveSetupCharge: (v: number) => void;
  setupMode: 'time' | 'flat' | 'both';
  onSaveSetupMode: (m: 'time' | 'flat' | 'both') => void;
}) {
  const [rows, setRows] = useState<ShopTool[]>(() => normalise(tools));
  const [saved, setSaved] = useState(false);
  const [charge, setCharge] = useState(String(flatSetupCharge || 0));

  const update = (op: TurningOp, patch: Partial<ShopTool>) => {
    setRows((rs) => rs.map((r) => (r.op === op ? { ...r, ...patch } : r)));
    setSaved(false);
  };

  const save = () => {
    onSave(rows);
    setSaved(true);
  };

  const reset = () => {
    setRows(normalise(DEFAULT_TURNING_TOOLS));
    setSaved(false);
  };

  return (
    <div className="p-8 space-y-6 animate-in slide-in-from-right-4 duration-300">
      <div className="border-b border-border pb-4">
        <h3 className="text-lg font-bold">Machining & Tool Library</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Map each turning operation to the turret station and insert your shop runs. These drive the reference toolpath preview and the
          downloadable G-code on turned parts.
        </p>
      </div>

      {/* Flat setup charge — applies to turned AND milled quotes */}
      <div className="bg-muted/20 border border-border rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="max-w-lg">
          <p className="text-sm font-semibold text-foreground">Flat charge per setup</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            A fixed sum added <strong className="text-foreground">per setup</strong>, on top of time-based setup, then amortised over the
            batch. CAM quotes typically bill a flat setup charge (e.g. $150/setup) that a pure time×rate model misses. Set 0 to disable.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">$</span>
            <input
              type="number"
              step="10"
              min="0"
              value={charge}
              onChange={(e) => setCharge(e.target.value)}
              onBlur={() => onSaveSetupCharge(Math.max(0, Number(charge) || 0))}
              className="w-28 bg-background border border-border rounded px-2 py-1.5 text-sm text-right font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="0"
            />
            <span className="text-xs text-muted-foreground">/ setup</span>
          </div>
          <div className="inline-flex rounded-md border border-border overflow-hidden text-[11px] font-semibold">
            {([['time', 'Time'], ['flat', 'Flat'], ['both', 'Both']] as const).map(([m, label]) => (
              <button
                key={m}
                onClick={() => onSaveSetupMode(m)}
                title={m === 'time' ? 'Time-based labour only' : m === 'flat' ? 'Flat charge only (replaces labour)' : 'Time labour + flat charge'}
                className={`px-2.5 py-1 transition-colors ${setupMode === m ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-accent'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground text-left">
              <th className="pb-2 pr-3">Operation</th>
              <th className="pb-2 pr-3">Station</th>
              <th className="pb-2 pr-3">Tool / insert</th>
              <th className="pb-2">Nose R (mm)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const meta = OP_ROWS.find((o) => o.op === r.op)!;
              return (
                <tr key={r.op} className="border-t border-border">
                  <td className="py-2 pr-3 align-top">
                    <p className="font-semibold text-foreground">{meta.label}</p>
                    <p className="text-[11px] text-muted-foreground">{meta.hint}</p>
                  </td>
                  <td className="py-2 pr-3 align-top">
                    <input
                      value={r.station}
                      onChange={(e) => update(r.op, { station: e.target.value })}
                      className="w-24 bg-background border border-border rounded px-2 py-1 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="T0101"
                    />
                  </td>
                  <td className="py-2 pr-3 align-top">
                    <input
                      value={r.description}
                      onChange={(e) => update(r.op, { description: e.target.value })}
                      className="w-full min-w-[220px] bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="Holder + insert"
                    />
                  </td>
                  <td className="py-2 align-top">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={r.noseRadiusMm ?? ''}
                      onChange={(e) =>
                        update(r.op, { noseRadiusMm: e.target.value === '' ? undefined : Number(e.target.value) })
                      }
                      className="w-20 bg-background border border-border rounded px-2 py-1 font-mono text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="—"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="pt-6 border-t border-border flex items-center justify-between">
        <button onClick={reset} className="text-xs font-bold text-muted-foreground hover:text-foreground uppercase tracking-widest">
          Reset to defaults
        </button>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Saved ✓</span>}
          <button
            onClick={save}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2 rounded-md text-sm font-medium hover:bg-primary/90 transition-shadow shadow"
          >
            <Save size={16} /> Save Tool Library
          </button>
        </div>
      </div>
    </div>
  );
}

function InputGroup({ label, defaultValue }: { label: string; defaultValue: string }) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{label}</label>
      <input 
        type="text" 
        defaultValue={defaultValue} 
        className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary transition-all"
      />
    </div>
  );
}

function RateRow({ label, value, unit, description }: { label: string; value: number; unit: string; description: string }) {
  return (
    <div className="flex items-start justify-between gap-4 p-4 hover:bg-muted/30 rounded-lg border border-transparent hover:border-border transition-all">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <span className="text-sm font-medium">$</span>
          <input 
            type="number" 
            defaultValue={value.toFixed(2)} 
            className="w-20 bg-background border border-border rounded px-2 py-1 text-sm font-mono text-right"
          />
        </div>
        <span className="text-xs text-muted-foreground font-medium">{unit}</span>
      </div>
    </div>
  );
}
