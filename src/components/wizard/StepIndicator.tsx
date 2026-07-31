import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../utils/cn';

interface StepIndicatorProps {
  currentStep: number;
  steps: string[];
}

export default function StepIndicator({ currentStep, steps }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-between w-full max-w-2xl mx-auto mb-12 relative overflow-hidden">
      {/* Background Line */}
      <div className="absolute top-5 left-0 w-full h-0.5 bg-border -z-10"></div>
      
      {steps.map((step, idx) => {
        const stepNum = idx + 1;
        const isCompleted = currentStep > stepNum;
        const isActive = currentStep === stepNum;

        return (
          <div key={step} className="flex flex-col items-center gap-3 relative z-10">
            <div className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300",
              isCompleted ? "bg-primary border-primary text-primary-foreground" : 
              isActive ? "bg-background border-primary text-primary shadow-[0_0_15px_rgba(37,99,235,0.2)]" : 
              "bg-background border-border text-muted-foreground"
            )}>
              {isCompleted ? <Check size={20} /> : <span className="text-sm font-semibold">{stepNum}</span>}
            </div>
            <span className={cn(
              "text-xs font-medium uppercase tracking-wider",
              isActive ? "text-primary" : "text-muted-foreground"
            )}>
              {step}
            </span>
          </div>
        );
      })}
    </div>
  );
}
