import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronRight, FolderInput } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { IndexingStatus } from '../types';
import { IndexingStatusDot } from './IndexingStatusDot';

/** Inline collapsible group of indexed pages sharing a browse-session start URL. */
export function SourceGroupRow({
  label, rootUrl, count, status, defaultOpen = false, onOpenInNavigator, onMove, children,
}: {
  label: string;
  rootUrl: string;
  count: number;
  status?: IndexingStatus;
  defaultOpen?: boolean;
  onOpenInNavigator?: (url: string) => void;
  onMove?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className='rounded border'>
      <div className='flex items-center border-b'>
        <button
          type='button'
          aria-label={label}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          onDoubleClick={() => onOpenInNavigator?.(rootUrl)}
          className='flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm'
        >
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          <IndexingStatusDot status={status} />
          <span className='min-w-0 flex-1 truncate font-medium' title={rootUrl}>{label}</span>
          <span className='shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground'>{count}</span>
        </button>
        {onMove && (
          <button
            type='button'
            aria-label={`move ${label}`}
            onClick={onMove}
            className='mr-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground'
          >
            <FolderInput className='h-4 w-4' />
          </button>
        )}
      </div>
      {open && <div className='space-y-1 p-1'>{children}</div>}
    </div>
  );
}
