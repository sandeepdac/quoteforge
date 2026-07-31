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
  RotateCcw
} from 'lucide-react';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../context/ThemeContext';
import { cn } from '../utils/cn';
import { clearAllState } from '../utils/storage';

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
    { id: 'margins', name: 'Margins', icon: Zap },
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
