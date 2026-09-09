import React, { createContext, useContext, ReactNode, useEffect } from 'react';
import { ShopSettings } from '../types';
import { DEFAULT_SHOP_SETTINGS } from '../constants';
import { usePersistentState } from '../hooks/usePersistentState';

interface SettingsContextType {
  settings: ShopSettings;
  updateSettings: (newSettings: Partial<ShopSettings>) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const [settings, setSettings] = usePersistentState<ShopSettings>('settings', DEFAULT_SHOP_SETTINGS);

  // Migrate the old optimistic 3-second turret allowance once. This preserves
  // all other user settings while ensuring existing browsers do not continue to
  // show the stale 3-second estimate after the model default changes.
  useEffect(() => {
    if (settings.cnc?.toolChangeSec === 3) {
      setSettings((prev) => ({ ...prev, cnc: { ...(prev.cnc ?? DEFAULT_SHOP_SETTINGS.cnc!), toolChangeSec: 8 } }));
    }
  }, []);

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
