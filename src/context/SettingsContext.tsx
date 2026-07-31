import React, { createContext, useContext, ReactNode } from 'react';
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

  const updateSettings = (newSettings: Partial<ShopSettings>) => {
    setSettings((prev) => ({
      ...prev,
      ...newSettings,
      rates: { ...prev.rates, ...newSettings.rates },
      speeds: { ...prev.speeds, ...newSettings.speeds },
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
