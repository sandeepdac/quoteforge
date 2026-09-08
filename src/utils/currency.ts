/**
 * CURRENCY — the shop quotes in one currency, chosen in Settings (mirroring a
 * CAM estimator's Currency setting). We store the ISO 4217 code and resolve the
 * display symbol from it; costs are not converted between currencies (the shop
 * enters its rates in its own currency), only labelled.
 */
export interface CurrencyOption {
  code: string;
  symbol: string;
  label: string;
}

export const CURRENCIES: CurrencyOption[] = [
  { code: 'USD', symbol: '$', label: 'USD — United States Dollar' },
  { code: 'EUR', symbol: '€', label: 'EUR — Euro' },
  { code: 'GBP', symbol: '£', label: 'GBP — British Pound' },
  { code: 'CAD', symbol: 'CA$', label: 'CAD — Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', label: 'AUD — Australian Dollar' },
  { code: 'INR', symbol: '₹', label: 'INR — Indian Rupee' },
  { code: 'JPY', symbol: '¥', label: 'JPY — Japanese Yen' },
  { code: 'CNY', symbol: 'CN¥', label: 'CNY — Chinese Yuan' },
  { code: 'CHF', symbol: 'CHF ', label: 'CHF — Swiss Franc' },
  { code: 'MXN', symbol: 'MX$', label: 'MXN — Mexican Peso' },
];

const DEFAULT_SYMBOL = '$';

/** Resolve the display symbol for an ISO currency code (falls back to '$'). */
export function currencySymbol(code?: string): string {
  if (!code) return DEFAULT_SYMBOL;
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? DEFAULT_SYMBOL;
}

/** Format an amount with the shop's currency symbol, fixed to `dp` decimals. */
export function formatMoney(value: number, code?: string, dp = 2): string {
  return `${currencySymbol(code)}${value.toFixed(dp)}`;
}
