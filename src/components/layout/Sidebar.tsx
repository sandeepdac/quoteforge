import React from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  FileText, 
  PlusCircle, 
  Package, 
  Layers, 
  Users, 
  BarChart3, 
  Settings,
  Hammer
} from 'lucide-react';
import { cn } from '../../utils/cn';

const navItems = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard },
  { name: 'All Quotes', path: '/quotes', icon: FileText },
  { name: 'Parts Library', path: '/parts', icon: Package },
  { name: 'Materials', path: '/materials', icon: Layers },
  { name: 'Customers', path: '/customers', icon: Users },
  { name: 'Fixture Estimator', path: '/fixtures', icon: Hammer },
  { name: 'Analytics', path: '/analytics', icon: BarChart3 },
  { name: 'Settings', path: '/settings', icon: Settings },
];

export default function Sidebar() {
  return (
    <aside className="w-60 border-r border-[#e5e5e5] bg-white flex flex-col h-screen sticky top-0 shrink-0">
      <div className="p-6 flex items-center gap-2">
        <div className="w-8 h-8 bg-[#2563eb] rounded-lg flex items-center justify-center">
          <div className="w-4 h-4 bg-white rounded-sm rotate-45"></div>
        </div>
        <h1 className="text-lg font-semibold tracking-tight text-[#0a0a0a]">QuoteForge</h1>
      </div>

      <nav className="flex-1 px-4 space-y-1 py-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => cn(
              "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all group",
              isActive 
                ? "bg-[#2563eb]/10 text-[#2563eb]" 
                : "text-[#525252] hover:bg-[#fafaf9] hover:text-[#0a0a0a]"
            )}
          >
            <item.icon size={16} className={cn(
              "transition-colors",
              "text-current"
            )} />
            {item.name}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-[#e5e5e5]">
        <NavLink
          to="/quotes/new"
          className="flex items-center justify-center gap-2 w-full bg-primary text-primary-foreground px-4 py-2.5 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
        >
          <PlusCircle size={18} />
          New Quote
        </NavLink>
      </div>
    </aside>
  );
}
