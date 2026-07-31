import React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '../../utils/cn';

interface KpiCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  description?: string;
  className?: string;
  color?: 'primary' | 'success' | 'warning' | 'danger';
}

export default function KpiCard({ title, value, icon: Icon, trend, description, className, color = 'primary' }: KpiCardProps) {
  const colorMap = {
    primary: 'bg-[#2563eb]',
    success: 'bg-[#16a34a]',
    warning: 'bg-[#ea580c]',
    danger: 'bg-[#dc2626]',
  };

  return (
    <div className={cn("bg-white p-5 rounded-lg border border-[#e5e5e5] flex flex-col shadow-sm", className)}>
      <div className="flex items-start justify-between">
        <span className="text-[10px] font-bold text-[#525252] uppercase tracking-wider">{title}</span>
        <Icon size={16} className="text-[#a3a3a3]" />
      </div>
      <div className="flex items-end justify-between mt-2">
        <span className="text-2xl font-bold tracking-tight text-[#0a0a0a]">{value}</span>
        {trend ? (
          <span className={cn(
            "text-xs font-semibold px-2 py-0.5 rounded-full",
            trend.isPositive ? "bg-[#16a34a]/10 text-[#16a34a]" : "bg-[#dc2626]/10 text-[#dc2626]"
          )}>
            {trend.isPositive ? '+' : '-'}{trend.value}
          </span>
        ) : (
          description && <span className="text-xs text-[#a3a3a3] font-medium">{description}</span>
        )}
      </div>
      <div className="mt-3 h-1.5 w-full bg-[#fafaf9] rounded-full overflow-hidden">
        <div 
          className={cn("h-full transition-all duration-1000", colorMap[color] || colorMap.primary)} 
          style={{ width: trend ? (trend.isPositive ? '65%' : '20%') : '45%' }}
        ></div>
      </div>
    </div>
  );
}
