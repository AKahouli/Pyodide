import type { ReactNode } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  variant: 'information' | 'requirement';
  title?: string;
  children: ReactNode;
  className?: string;
}

export function ScopeAttentionNotice({ variant, title, children, className }: Readonly<Props>): JSX.Element {
  const isRequirement = variant === 'requirement';
  const Icon = isRequirement ? AlertTriangle : Info;
  return (
    <div
      role={isRequirement ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-xl border p-4 text-sm',
        isRequirement
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100'
          : 'border-primary/30 bg-primary/8 text-foreground',
        className,
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', isRequirement ? 'text-amber-600 dark:text-amber-300' : 'text-primary')} />
      <div className='min-w-0'>
        {title && <p className='font-semibold'>{title}</p>}
        <div className={cn(title && 'mt-1', 'text-muted-foreground')}>{children}</div>
      </div>
    </div>
  );
}
