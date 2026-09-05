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
  ClipboardList,
  Receipt
} from 'lucide-react';
import { cn } from '../../utils/cn';
import Logo from '../common/Logo';

const navItems = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard },
  { name: 'All Quotes', path: '/quotes', icon: FileText },
  { name: 'Jobs', path: '/jobs', icon: ClipboardList },
  { name: 'Invoices', path: '/invoices', icon: Receipt },
  { name: 'Parts Library', path: '/parts', icon: Package },
  { name: 'Materials', path: '/materials', icon: Layers },
  { name: 'Customers', path: '/customers', icon: Users },
  { name: 'Analytics', path: '/analytics', icon: BarChart3 },
  { name: 'Settings', path: '/settings', icon: Settings },
];

export default function Sidebar() {
  return (
    <aside className="w-60 border-r border-border bg-card flex flex-col h-screen sticky top-0 shrink-0">
      <div className="p-6 flex items-center gap-2.5">
        <Logo size={30} />
        <h1 className="text-lg font-bold tracking-tight text-foreground">
          Quote<span className="text-primary">Forge</span>
        </h1>
      </div>

      <nav className="flex-1 px-4 space-y-1 py-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => cn(
              "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all group",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
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

      <div className="p-4 border-t border-border">
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
