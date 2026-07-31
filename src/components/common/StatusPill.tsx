import React from 'react';
import { QuoteStatus } from '../../types';
import { cn } from '../../utils/cn';

interface StatusPillProps {
  status: QuoteStatus | string;
  className?: string;
}

export default function StatusPill({ status, className }: StatusPillProps) {
  const getStyles = () => {
    switch (status.toLowerCase()) {
      case 'won':
        return "bg-[#16a34a]/10 text-[#16a34a]";
      case 'lost':
        return "bg-[#dc2626]/10 text-[#dc2626]";
      case 'sent':
        return "bg-[#2563eb]/10 text-[#2563eb]";
      case 'draft':
        return "bg-[#525252]/10 text-[#525252]";
      case 'expired':
        return "bg-[#a3a3a3]/10 text-[#a3a3a3]";
      default:
        return "bg-[#525252]/10 text-[#525252]";
    }
  };

  return (
    <span className={cn(
      "inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-tight",
      getStyles(),
      className
    )}>
      {status}
    </span>
  );
}
