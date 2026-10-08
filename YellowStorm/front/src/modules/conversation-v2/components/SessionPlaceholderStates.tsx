import { ArrowLeftIcon, RefreshCwIcon, SearchXIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useConversationV2Translation } from '../translation';

/**
 * Placeholder that mirrors the real session layout (header / messages / composer)
 * so the page does not visibly jump once the session resolves. Replaces the old
 * single centred line of text.
 */
export function SessionLoadingSkeleton() {
  return (
    <div className='flex min-h-0 flex-1 flex-col' aria-busy='true'>
      <div className='flex h-14 shrink-0 items-center gap-3 border-b border-border/70 px-4'>
        <Skeleton className='size-8 rounded-lg' />
        <Skeleton className='h-4 w-40' />
      </div>

      <div className='mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 overflow-hidden px-4 py-6'>
        <div className='flex flex-col items-end gap-2'>
          <Skeleton className='h-10 w-2/5 rounded-2xl' />
        </div>
        <div className='flex flex-col gap-3'>
          <Skeleton className='h-4 w-4/5' />
          <Skeleton className='h-4 w-3/5' />
          <Skeleton className='h-4 w-2/3' />
        </div>
        <div className='flex items-center gap-2'>
          <Skeleton className='size-4 rounded-full' />
          <Skeleton className='h-4 w-40' />
        </div>
        <div className='flex flex-col items-end gap-2'>
          <Skeleton className='h-10 w-1/3 rounded-2xl' />
        </div>
      </div>

      <div className='shrink-0 border-t border-border/50 p-4'>
        <div className='mx-auto w-full max-w-3xl'>
          <Skeleton className='h-16 w-full rounded-xl' />
        </div>
      </div>
    </div>
  );
}

/**
 * Recoverable "session not found" screen. The previous version rendered one
 * muted line with no way out of the view.
 */
export function SessionNotFound({ onRetry }: { onRetry?: () => void }) {
  const { t } = useConversationV2Translation();

  return (
    <div className='flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center'>
      <div className='flex size-12 items-center justify-center rounded-2xl border bg-muted/40'>
        <SearchXIcon className='size-5 text-muted-foreground' aria-hidden />
      </div>
      <div className='space-y-1'>
        <p className='text-base font-semibold text-foreground'>{t('session.notFound')}</p>
        <p className='text-sm text-muted-foreground'>{t('session.notFoundHint')}</p>
      </div>
      <div className='flex flex-wrap items-center justify-center gap-2'>
        <Button type='button' variant='outline' size='sm' className='gap-2' onClick={() => window.history.back()}>
          <ArrowLeftIcon className='size-3.5' aria-hidden />
          {t('session.back')}
        </Button>
        {onRetry && (
          <Button type='button' size='sm' className='gap-2' onClick={onRetry}>
            <RefreshCwIcon className='size-3.5' aria-hidden />
            {t('nodepod.retry')}
          </Button>
        )}
      </div>
    </div>
  );
}
