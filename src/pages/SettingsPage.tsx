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
  Calculator,
  Paintbrush,
  Plus,
  Trash2
} from 'lucide-react';
import { Wrench } from 'lucide-react';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../context/ThemeContext';
import { cn } from '../utils/cn';
import { DEFAULT_CNC_SETTINGS, DEFAULT_SECONDARY_OPS, DEFAULT_TURNING_TOOLS } from '../constants';
import { CncSettings, SecondaryCategory, SecondaryOperation, ShopSettings, ShopTool, TurningOp } from '../types';
import { CURRENCIES, currencySymbol } from '../utils/currency';
import { useMoney } from '../utils/useMoney';
import { ALL_MACHINE_IDS, MACHINE_CATALOG, MachineId } from '../utils/machineSelection';

export default function SettingsPage() {
  const { settings, updateSettings } = useSettings();
  const { theme, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState('shop');

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
            <ShopInfoTab settings={settings} onSave={(patch) => updateSettings(patch)} />
          )}

          {activeTab === 'rates' && (
            <div className="p-8 space-y-6 animate-in slide-in-from-right-4 duration-300">
              <div className="border-b border-border pb-4">
                <h3 className="text-lg font-bold">Equipment &amp; Labor Rates</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Fabrication rates (laser / brake / weld / finish) — used only for sheet-metal &amp; fabrication quotes. <strong className="text-foreground">CNC machining</strong> rates live under the <strong className="text-foreground">Estimate</strong> tab.
                </p>
              </div>
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
              settings={settings}
              onSaveShop={(patch) => updateSettings(patch)}
              cnc={settings.cnc ?? DEFAULT_CNC_SETTINGS}
              onSaveCnc={(patch) => updateSettings({ cnc: patch as CncSettings })}
            />
          )}

          {activeTab === 'margins' && (
            <MarginsTab
              settings={settings}
              onSave={(patch) => updateSettings(patch)}
            />
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
  onSaveCnc,
  settings,
  onSaveShop,
}: {
  cnc: CncSettings;
  onSaveCnc: (patch: Partial<CncSettings>) => void;
  settings: ShopSettings;
  onSaveShop: (patch: Partial<ShopSettings>) => void;
}) {
  const { symbol } = useMoney();
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

  const [tax, setTax] = useState(String(settings.taxRatePercent ?? 20));
  const saveTax = () => {
    const v = Math.min(100, Math.max(0, Number(tax) || 0));
    setTax(String(v));
    onSaveShop({ taxRatePercent: v });
    flash('Tax rate');
  };

  // Work-centre mapping: our router names -> the codes the shop's MRP expects.
  const mappings = settings.workCentreMappings ?? [];
  const saveMappings = (next: Array<{ from: string; to: string }>) => {
    onSaveShop({ workCentreMappings: next });
  };
  // Offer every work centre the app can emit, so a shop maps them without having
  // to remember the exact spelling our router uses.
  const knownCentres = Array.from(
    new Set([
      ...ALL_MACHINE_IDS.map((id) => MACHINE_CATALOG[id].name),
      'Stores / saw',
      'Subcontract',
      'Inspection',
      'Despatch',
      ...mappings.map((m) => m.from),
    ])
  );

  const owned = new Set<MachineId>(cnc.machines ?? ALL_MACHINE_IDS);
  const toggleMachine = (id: MachineId) => {
    const next = new Set(owned);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Never let the shop own zero machines — a quote must have somewhere to run.
    const list = ALL_MACHINE_IDS.filter((m) => next.has(m));
    onSaveCnc({ machines: list.length ? list : [id] });
    flash('Machine inventory');
  };

  return (
    <div className="p-8 space-y-6 animate-in slide-in-from-right-4 duration-300">
      <div className="border-b border-border pb-4">
        <h3 className="text-lg font-bold">Estimate Settings</h3>
        <p className="text-sm text-muted-foreground mt-1">
          The cost inputs behind every machining quote. Enter your own shop rate, feed override and tool-change time — these drive the
          machining time and cost on turned and milled parts. (Quoting currency lives under Shop Info.)
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <SettingField
          label="Machining Rate"
          hint="Spindle charge-out for cutting time"
          unit={`${symbol} / hr`}
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
          label="VAT / Sales Tax"
          hint="Applied to invoices; editable per invoice"
          unit="%"
        >
          <input
            type="number"
            step="0.5"
            min="0"
            max="100"
            value={tax}
            onChange={(e) => setTax(e.target.value)}
            onBlur={saveTax}
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
      </div>

      <div className="pt-6 border-t border-border space-y-3">
        <div>
          <h4 className="text-sm font-bold flex items-center gap-2"><Wrench size={15} className="text-primary" /> Machines on the floor</h4>
          <p className="text-xs text-muted-foreground mt-1">
            Tick the machines your shop actually runs. Each quote costs the part on every capable machine
            <strong className="text-foreground"> among these</strong> and picks the cheapest overall — trading setups against
            hourly rate, which pull in opposite directions: a 5-axis mill-turn does in two clamps what a 3-axis needs six for,
            and charges three times as much an hour for the privilege.
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
            Hourly rates are defaults for a UK precision shop, not your books. They set which machine wins the work
            and what the hours cost — confirm them before you send a quote.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ALL_MACHINE_IDS.map((id) => {
            const spec = MACHINE_CATALOG[id];
            const on = owned.has(id);
            return (
              <label
                key={id}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors',
                  on ? 'bg-primary/5 border-primary/30' : 'bg-background border-border hover:border-muted-foreground/40'
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleMachine(id)}
                  className="mt-0.5 accent-primary h-4 w-4 shrink-0"
                />
                <span className="min-w-0">
                  <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                    {spec.name}
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {spec.hourlyRate}/hr
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {spec.axes} axes
                    </span>
                  </span>
                  <span className="block text-[11px] text-muted-foreground leading-snug mt-0.5">{spec.note}</span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="pt-6 border-t border-border space-y-3">
        <div>
          <h4 className="text-sm font-bold">MRP work-centre codes</h4>
          <p className="text-xs text-muted-foreground mt-1">
            Optional. If you already run an MRP, map our work-centre names to the codes it expects — the exported
            job packet (JSON / CSV / traveller) then speaks your MRP's language. Anything left blank exports under our name.
          </p>
        </div>
        <div className="space-y-2">
          {knownCentres.map((centre) => {
            const current = mappings.find((m) => m.from === centre)?.to ?? '';
            return (
              <div key={centre} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">{centre}</span>
                <span className="text-muted-foreground/60 text-xs">→</span>
                <input
                  defaultValue={current}
                  placeholder="e.g. TM01"
                  aria-label={`MRP code for ${centre}`}
                  onBlur={(e) => {
                    const to = e.target.value.trim();
                    const rest = mappings.filter((m) => m.from !== centre);
                    saveMappings(to ? [...rest, { from: centre, to }] : rest);
                  }}
                  className="w-32 bg-background border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            );
          })}
        </div>
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

/** SHOP INFO — the shop identity shown on quotes/PDFs. Now actually persists. */
function ShopInfoTab({
  settings,
  onSave,
}: {
  settings: ShopSettings;
  onSave: (patch: Partial<ShopSettings>) => void;
}) {
  const [name, setName] = useState(settings.name);
  const [address, setAddress] = useState(settings.address);
  const [logo, setLogo] = useState(settings.logo);
  const [currency, setCurrency] = useState(settings.currency ?? 'USD');
  const [saved, setSaved] = useState(false);

  const save = () => {
    onSave({ name: name.trim(), address: address.trim(), logo: logo.trim(), currency });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };
  const field = 'w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary transition-all';

  return (
    <div className="p-8 space-y-6 animate-in slide-in-from-right-4 duration-300">
      <h3 className="text-lg font-bold border-b border-border pb-4">Shop Information</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Shop Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder="Your Machine Shop" />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Logo URL</label>
          <input value={logo} onChange={(e) => setLogo(e.target.value)} className={field} placeholder="https://… (optional)" />
        </div>
        <div className="col-span-1 md:col-span-2 space-y-2">
          <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Main Address</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} className={field} placeholder="Street, City, State ZIP" />
        </div>
        <div className="col-span-1 md:col-span-2 space-y-2">
          <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Currency</label>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={field}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">
            The shop's quoting currency — applied everywhere prices show across the app (quotes, parts, materials, analytics). Rates are labelled, not converted.
          </p>
        </div>
      </div>
      <div className="pt-6 border-t border-border flex items-center justify-end gap-3">
        {saved && <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Saved ✓</span>}
        <button onClick={save} className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2 rounded-md text-sm font-medium hover:bg-primary/90 transition-shadow shadow">
          <Save size={16} /> Save Changes
        </button>
      </div>
    </div>
  );
}

/**
 * MARGINS — overhead, default margin, rush premium and scrap. These apply to
 * EVERY quote, machining included (overhead + margin ride on the subtotal), so
 * the inputs must actually persist (previously they were dead defaultValues).
 */
function MarginsTab({
  settings,
  onSave,
}: {
  settings: ShopSettings;
  onSave: (patch: Partial<ShopSettings>) => void;
}) {
  const [margin, setMargin] = useState(Math.round(settings.defaultMargin * 100));
  const [rush, setRush] = useState(Math.round(settings.rushPremiumPercent * 100));
  const [overhead, setOverhead] = useState(Math.round(settings.overheadPercent * 100));
  const [scrap, setScrap] = useState(Math.round(settings.scrapFactor * 100));
  const [saved, setSaved] = useState(false);

  const save = () => {
    onSave({
      defaultMargin: Math.max(0, margin) / 100,
      rushPremiumPercent: Math.max(0, rush) / 100,
      overheadPercent: Math.max(0, overhead) / 100,
      scrapFactor: Math.max(0, scrap) / 100,
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };

  const numCls = 'w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary';

  return (
    <div className="p-8 space-y-6 animate-in slide-in-from-right-4 duration-300">
      <div className="border-b border-border pb-4">
        <h3 className="text-lg font-bold">Standard Margins</h3>
        <p className="text-sm text-muted-foreground mt-1">Overhead and margin ride on every quote's subtotal — machining included.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-2">
          <div className="flex justify-between items-end">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Default Profit Margin</p>
            <span className="text-lg font-bold text-primary">{margin}%</span>
          </div>
          <input type="range" min="0" max="60" value={margin} onChange={(e) => setMargin(Number(e.target.value))} className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary" />
        </div>
        <div className="space-y-2">
          <div className="flex justify-between items-end">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Rush Order Premium</p>
            <span className="text-lg font-bold text-orange-500">{rush}%</span>
          </div>
          <input type="range" min="0" max="100" value={rush} onChange={(e) => setRush(Number(e.target.value))} className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-orange-500" />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest leading-loose">Shop Overhead (%)</p>
          <input type="number" min="0" value={overhead} onChange={(e) => setOverhead(Number(e.target.value))} className={numCls} />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest leading-loose">Scrap Factor (%)</p>
          <input type="number" min="0" value={scrap} onChange={(e) => setScrap(Number(e.target.value))} className={numCls} />
        </div>
      </div>
      <div className="pt-6 border-t border-border flex items-center justify-end gap-3">
        {saved && <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Saved ✓</span>}
        <button onClick={save} className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2 rounded-md text-sm font-medium hover:bg-primary/90 transition-shadow shadow">
          <Save size={16} /> Save Margins
        </button>
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
  const { symbol } = useMoney();
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
            <span className="text-sm text-muted-foreground">{symbol}</span>
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

function RateRow({ label, value, unit, description }: { label: string; value: number; unit: string; description: string }) {
  const { symbol } = useMoney();
  return (
    <div className="flex items-start justify-between gap-4 p-4 hover:bg-muted/30 rounded-lg border border-transparent hover:border-border transition-all">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <span className="text-sm font-medium">{symbol}</span>
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
