import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { ShopSettings } from '../types';
import { DEFAULT_SHOP_SETTINGS } from '../constants';
import { usePersistentState } from '../hooks/usePersistentState';

interface SettingsContextType {
  settings: ShopSettings;
  updateSettings: (newSettings: Partial<ShopSettings>) => void;
}

/** The saved settings with every missing field taken from the defaults. */
export function withDefaults(saved: ShopSettings): ShopSettings {
  return {
    ...DEFAULT_SHOP_SETTINGS,
    ...saved,
    rates: { ...DEFAULT_SHOP_SETTINGS.rates, ...saved.rates },
    speeds: { ...DEFAULT_SHOP_SETTINGS.speeds, ...saved.speeds },
    cnc: { ...DEFAULT_SHOP_SETTINGS.cnc!, ...(saved.cnc ?? {}) },
  };
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const [stored, setSettings] = usePersistentState<ShopSettings>('settings', DEFAULT_SHOP_SETTINGS);
  // SAVED SETTINGS REPLACE THE DEFAULTS WHOLESALE, so a field added after the user
  // last saved (the idle floor, say) came back undefined and silently switched the
  // feature off for exactly the people who already had settings. Fill what is
  // missing from the defaults; anything the user did save, including 0, is kept.
  const settings = useMemo(() => withDefaults(stored), [stored]);

  const updateSettings = (newSettings: Partial<ShopSettings>) => {
    setSettings((prev) => ({
      ...prev,
      ...newSettings,
      rates: { ...prev.rates, ...newSettings.rates },
      speeds: { ...prev.speeds, ...newSettings.speeds },
      cnc: newSettings.cnc ? { ...(prev.cnc ?? DEFAULT_SHOP_SETTINGS.cnc!), ...newSettings.cnc } : prev.cnc,
    }));
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used within a SettingsProvider');
  return context;
};
