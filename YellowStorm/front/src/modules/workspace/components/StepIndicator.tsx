/**
 * Step Indicator
 * Progress indicator showing current step in a multi-step wizard
 */

import { cn } from '@/lib/utils';

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
}

export function StepIndicator({ currentStep, totalSteps }: StepIndicatorProps) {
  return (
    <div className='flex items-center justify-center gap-2 py-2'>
      {Array.from({ length: totalSteps }).map((_, i) => (
        <div key={i} className={cn('w-2 h-2 rounded-full transition-colors', i + 1 <= currentStep ? 'bg-primary' : 'bg-muted')} />
      ))}
    </div>
  );
}
