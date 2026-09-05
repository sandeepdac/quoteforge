import { describe, it, expect } from 'vitest';
import { CURRENCIES, currencySymbol, formatMoney } from './currency';

describe('currency', () => {
  it('resolves the symbol for a known code', () => {
    expect(currencySymbol('USD')).toBe('$');
    expect(currencySymbol('EUR')).toBe('€');
    expect(currencySymbol('GBP')).toBe('£');
    expect(currencySymbol('INR')).toBe('₹');
  });

  it('falls back to $ for an unknown or missing code', () => {
    expect(currencySymbol('ZZZ')).toBe('$');
    expect(currencySymbol(undefined)).toBe('$');
    expect(currencySymbol('')).toBe('$');
  });

  it('formats a money amount with the selected currency', () => {
    expect(formatMoney(392.6, 'USD')).toBe('$392.60');
    expect(formatMoney(392.6, 'GBP')).toBe('£392.60');
    expect(formatMoney(1000, 'EUR', 0)).toBe('€1000');
  });

  it('every currency option carries a code, symbol and label', () => {
    expect(CURRENCIES.length).toBeGreaterThan(0);
    expect(CURRENCIES.every((c) => c.code && c.symbol && c.label)).toBe(true);
  });
});
