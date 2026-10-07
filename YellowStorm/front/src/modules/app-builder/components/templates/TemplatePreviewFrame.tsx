import type { ReactNode } from 'react';
import { AppWindow } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TemplatePreviewFrameProps {
  src?: string | null;
  title: string;
  emptyLabel?: string;
  className?: string;
  mediaClassName?: string;
  /** Overlays inside the 16:10 screenshot (clone pill, badges). */
  children?: ReactNode;
  /** Lightweight window chrome. `dots` keeps the screenshot dominant. */
  chrome?: 'none' | 'dots' | 'bar';
  /** `flush` fills a parent card; `window` is a standalone browser frame. */
  variant?: 'flush' | 'window';
}

/**
 * Shared App Market preview: fixed 16:10 media, overflow clipped, cover crop
 * anchored near the top so template chrome stays visible.
 */
export function TemplatePreviewFrame({
  src,
  title,
  emptyLabel,
  className,
  mediaClassName,
  children,
  chrome = 'dots',
  variant = 'flush',
}: TemplatePreviewFrameProps) {
  return (
    <div
      className={cn(
        'overflow-hidden bg-muted/30',
        variant === 'window' &&
          'rounded-xl border border-border/70 bg-background shadow-md ring-1 ring-black/5',
        className,
      )}
    >
      {chrome !== 'none' ? (
        <div
          className={cn(
            'flex shrink-0 items-center gap-1.5 border-b border-border/50 bg-muted/55',
            chrome === 'bar' ? 'h-8 px-3' : 'h-6 px-2.5',
          )}
          aria-hidden
        >
          <span className='size-1.5 rounded-full bg-border' />
          <span className='size-1.5 rounded-full bg-border' />
          <span className='size-1.5 rounded-full bg-border' />
          {chrome === 'bar' ? (
            <span className='ml-1.5 truncate text-[10px] leading-none text-muted-foreground'>
              {title}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className='relative aspect-[16/10] w-full overflow-hidden bg-muted/25'>
        {src ? (
          <img
            src={src}
            alt=''
            loading='lazy'
            decoding='async'
            sizes='(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw'
            className={cn(
              'size-full object-cover object-[center_12%]',
              mediaClassName,
            )}
          />
        ) : (
          <div className='flex size-full flex-col items-center justify-center gap-2 text-muted-foreground'>
            <AppWindow className='size-8 opacity-60' aria-hidden />
            {emptyLabel ? <span className='text-xs'>{emptyLabel}</span> : null}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
