import { LockIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PreviewBrowserFrameProps {
  children: React.ReactNode;
  /** Shown in the address bar (never secrets). */
  addressLabel: string;
  live?: boolean;
  liveLabel?: string;
  className?: string;
}

/**
 * Decorative browser chrome around the live preview iframe.
 * Presentation only — does not affect sandbox / security of the iframe.
 */
export function PreviewBrowserFrame({
  children,
  addressLabel,
  live = false,
  liveLabel,
  className,
}: PreviewBrowserFrameProps) {
  return (
    <div
      className={cn(
        'flex size-full min-h-0 overflow-hidden',
        'bg-muted/25 p-2.5 sm:p-3',
        className,
      )}
    >
      <div
        className={cn(
          'flex min-h-0 w-full flex-1 flex-col overflow-hidden',
          'rounded-xl border border-border/50 bg-background',
          'shadow-[0_1px_0_hsl(var(--border)/0.5),0_18px_40px_-28px_rgba(0,0,0,0.45)]',
        )}
      >
        <div className='flex h-9 shrink-0 items-center gap-2.5 border-b border-border/50 bg-muted/30 px-3'>
          <div className='flex shrink-0 items-center gap-1.5' aria-hidden>
            <span className='size-2 rounded-full bg-fail/65' />
            <span className='size-2 rounded-full bg-muted-foreground/35' />
            <span className='size-2 rounded-full bg-ok/65' />
          </div>

          <div
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1.5 rounded-md',
              'border border-border/40 bg-background/80 px-2.5 py-[5px]',
              'text-[11px] text-muted-foreground',
            )}
          >
            <LockIcon className='size-3 shrink-0 opacity-55' aria-hidden />
            <span className='truncate tracking-tight'>{addressLabel}</span>
            {live && liveLabel ? (
              <span className='ml-auto inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-ok'>
                <span className='relative flex size-1.5'>
                  <span className='absolute inline-flex size-full animate-ping rounded-full bg-ok/70 opacity-50 motion-reduce:animate-none' />
                  <span className='relative inline-flex size-1.5 rounded-full bg-ok' />
                </span>
                {liveLabel}
              </span>
            ) : null}
          </div>
        </div>

        <div className='relative min-h-0 flex-1 overflow-hidden bg-background'>{children}</div>
      </div>
    </div>
  );
}
