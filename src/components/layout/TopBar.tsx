import React, { useState } from 'react';
import { Sun, Moon, Search, Plus } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import { useSettings } from '../../context/SettingsContext';

/** Derive a two-part breadcrumb from the current path. */
function useBreadcrumb(): { section: string; page: string } {
  const { pathname } = useLocation();
  const [, first, second] = pathname.split('/');

  switch (first) {
    case undefined:
    case '':
      return { section: 'Dashboard', page: 'Overview' };
    case 'quotes':
      if (second === 'new') return { section: 'Quotations', page: 'New Quote' };
      if (second) return { section: 'Quotations', page: 'Detail' };
      return { section: 'Quotations', page: 'All' };
    case 'parts':
      return { section: 'Parts Library', page: second ? 'Detail' : 'All' };
    case 'materials':
      return { section: 'Materials', page: 'Catalog' };
    case 'customers':
      return { section: 'Customers', page: second ? 'Detail' : 'All' };
    case 'analytics':
      return { section: 'Analytics', page: 'Insights' };
    case 'settings':
      return { section: 'Settings', page: 'Shop' };
    default:
      return { section: 'Dashboard', page: 'Overview' };
  }
}

const DEFAULT_LOGO = '';

export default function TopBar() {
  const { theme, toggleTheme } = useTheme();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const { section, page } = useBreadcrumb();
  const [search, setSearch] = useState('');

  // The Quotations list already has its own prominent "New Quote" button, and the
  // New Quote wizard is itself a new quote — so a second one in the top bar there
  // is redundant. Hide it on those two pages.
  const hideNewQuote = section === 'Quotations' && (page === 'All' || page === 'New Quote');

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const term = search.trim();
    navigate(term ? `/quotes?search=${encodeURIComponent(term)}` : '/quotes');
  };

  // Self-contained avatar: use an uploaded logo if the shop set one, otherwise
  // fall back to the shop's initials rather than an external placeholder image.
  const hasLogo = settings.logo && settings.logo !== DEFAULT_LOGO;
  const initials = (settings.name || 'QF')
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="h-16 border-b border-border bg-card px-8 flex items-center justify-between sticky top-0 z-10">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{section}</span>
          <span className="text-border">/</span>
          <span className="text-foreground font-medium">{page}</span>
        </div>
        <div className="h-4 w-[1px] bg-border"></div>
        <form onSubmit={submitSearch} className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search quotes..."
            aria-label="Search quotes"
            className="pl-9 pr-4 py-1.5 bg-muted border border-border rounded-md text-sm w-64 outline-none focus:ring-1 focus:ring-primary/30 text-foreground placeholder:text-muted-foreground"
          />
        </form>
      </div>

      <div className="flex items-center gap-4">
        {!hideNewQuote && (
          <Link
            to="/quotes/new"
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Plus size={16} /> New Quote
          </Link>
        )}
        <button
          onClick={toggleTheme}
          aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground"
        >
          {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
        </button>
        <Link
          to="/settings"
          aria-label="Shop settings"
          className="w-8 h-8 rounded-full border border-border overflow-hidden shrink-0 flex items-center justify-center bg-primary/10 text-primary text-xs font-semibold"
        >
          {hasLogo ? (
            <img src={settings.logo} alt="Shop logo" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
          ) : (
            initials
          )}
        </Link>
      </div>
    </header>
  );
}
