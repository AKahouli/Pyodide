import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { IndexingStatus } from '../types';
import { IndexingStatusDot } from './IndexingStatusDot';

/** Inline collapsible group of indexed pages sharing a browse-session start URL. */
export function SourceGroupRow({
  label, rootUrl, count, status, defaultOpen = false, children,
}: {
  label: string;
  rootUrl: string;
  count: number;
  status?: IndexingStatus;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className='rounded border'>
      <button
        type='button'
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className='flex w-full items-center gap-2 border-b px-2 py-1.5 text-left text-sm'
      >
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <IndexingStatusDot status={status} />
        <span className='min-w-0 flex-1 truncate font-medium' title={rootUrl}>{label}</span>
        <span className='shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground'>{count}</span>
      </button>
      {open && <div className='space-y-1 p-1'>{children}</div>}
    </div>
  );
}
