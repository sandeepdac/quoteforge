import { useSettings } from '../context/SettingsContext';
import { currencySymbol } from './currency';

/**
 * The shop's live currency, resolved from Settings → Shop Info. Every price in
 * the app should render through this so a currency change is reflected app-wide.
 *   const { symbol, money } = useMoney();
 *   <span>{money(unitPrice)}</span>   // "£1,234.50"
 *   <span>{symbol}{x.toFixed(2)}</span>
 */
export function useMoney() {
  const { settings } = useSettings();
  const symbol = currencySymbol(settings.currency);
  const money = (value: number, dp = 2) =>
    `${symbol}${value.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
  return { symbol, money };
}
