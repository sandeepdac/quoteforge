import { describe, it, expect } from 'vitest';
import { withDefaults } from './SettingsContext';
import { DEFAULT_SHOP_SETTINGS } from '../constants';
import type { ShopSettings } from '../types';

/**
 * Settings saved before a field existed must still get that field's default,
 * and anything the user did save — including 0 — must be kept.
 */
describe('settings saved before a field existed', () => {
  const old = (cnc: Record<string, unknown>) =>
    ({ ...DEFAULT_SHOP_SETTINGS, cnc } as unknown as ShopSettings);

  it('get the defaults for the fields they lack', () => {
    const s = withDefaults(old({ maxRpm: 4000, barLoadSec: 8, machineRatePerMin: 1 }));
    expect(s.cnc!.opIdleFloorSec).toBe(DEFAULT_SHOP_SETTINGS.cnc!.opIdleFloorSec);
    expect(s.cnc!.toolChangeSec).toBe(DEFAULT_SHOP_SETTINGS.cnc!.toolChangeSec);
  });

  it('keep what the user did save, a 0 included', () => {
    const s = withDefaults(old({ maxRpm: 4000, barLoadSec: 8, opIdleFloorSec: 0 }));
    expect(s.cnc!.opIdleFloorSec).toBe(0);
    expect(s.cnc!.maxRpm).toBe(4000);
    expect(s.cnc!.barLoadSec).toBe(8);
  });

  it('survive settings with no cnc block at all', () => {
    const noCnc = { ...DEFAULT_SHOP_SETTINGS } as ShopSettings;
    delete (noCnc as { cnc?: unknown }).cnc;
    expect(withDefaults(noCnc).cnc!.opIdleFloorSec).toBe(DEFAULT_SHOP_SETTINGS.cnc!.opIdleFloorSec);
  });
});
