import React from 'react';
import { Sun, Moon, Bell, Search, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import { useSettings } from '../../context/SettingsContext';

export default function TopBar() {
  const { theme, toggleTheme } = useTheme();
  const { settings } = useSettings();

  return (
    <header className="h-16 border-b border-[#e5e5e5] bg-white px-8 flex items-center justify-between sticky top-0 z-10">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-[#a3a3a3]">Dashboard</span>
          <span className="text-[#e5e5e5]">/</span>
          <span className="text-[#525252] font-medium">Overview</span>
        </div>
        <div className="h-4 w-[1px] bg-[#e5e5e5]"></div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a3a3a3]" />
          <input 
            type="text" 
            placeholder="Search quotes..." 
            className="pl-9 pr-4 py-1.5 bg-[#fafaf9] border border-[#e5e5e5] rounded-md text-sm w-64 outline-none focus:ring-1 focus:ring-primary/20"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Link 
          to="/quotes/new"
          className="flex items-center gap-2 px-4 py-2 bg-[#2563eb] text-white text-sm font-medium rounded-md hover:bg-[#1d4ed8] transition-colors shadow-sm"
        >
          <Plus size={16} /> New Quote
        </Link>
        <button 
          onClick={toggleTheme}
          className="p-2 hover:bg-[#fafaf9] rounded-full transition-colors text-[#525252]"
        >
          {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
        </button>
        <div className="relative p-2 hover:bg-[#fafaf9] rounded-full cursor-pointer transition-colors">
          <Bell size={20} className="text-[#525252]" />
          <span className="absolute top-2 right-2 w-2 h-2 bg-[#dc2626] border-2 border-white rounded-full"></span>
        </div>
        <div className="w-8 h-8 rounded-full bg-[#e5e5e5] border border-white cursor-pointer overflow-hidden">
          <img src={settings.logo || "https://picsum.photos/seed/avatar/32/32"} alt="Shop Avatar" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
        </div>
      </div>
    </header>
  );
}
