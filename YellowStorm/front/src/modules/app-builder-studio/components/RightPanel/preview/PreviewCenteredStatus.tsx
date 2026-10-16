import { Button } from '@/components/ui/button';
import { PlaySquareIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppBuilderStudioTranslation } from '../../../translation';
import type { PreviewPhase } from './previewStateModel';

/**
 * Centred status surface while the NodePod runtime boots.
 * Calm motion + phase copy — presentation only.
 */

const ORB_SIZE = 'size-24';

interface PreviewCenteredStatusProps {
  phase: PreviewPhase;
  errorDetail?: string | null;
  onRetry: () => void;
}

function Orb({ phase }: { phase: PreviewPhase }) {
  const Icon = phase.icon;
  const isBusy = phase.animated;

  return (
    <div
      className={cn(
        'relative grid place-items-center',
        ORB_SIZE,
        isBusy ? 'text-primary' : phase.tone === 'error' ? 'text-fail' : 'text-muted-foreground',
      )}
    >
      {isBusy && (
        <>
          <div
            aria-hidden
            className='absolute inset-0 rounded-full bg-primary/15 blur-2xl motion-reduce:hidden animate-orb-breathe'
          />
          <div
            aria-hidden
            className='absolute inset-1 rounded-full border border-primary/30 motion-reduce:animate-none animate-orb-ping'
          />
        </>
      )}

      <div
        aria-hidden
        className={cn(
          'absolute inset-0 rounded-full border',
          isBusy ? 'border-primary/25 motion-reduce:animate-none animate-orb-orbit' : 'border-border/70',
        )}
      />
      <div
        aria-hidden
        className={cn(
          'absolute inset-2.5 rounded-full border border-dashed',
          isBusy
            ? 'border-primary/15 motion-reduce:animate-none animate-orb-orbit-reverse'
            : 'border-border/50',
        )}
      />

      {isBusy && (
        <div aria-hidden className='absolute inset-0 motion-reduce:animate-none animate-orb-orbit'>
          <span className='absolute -top-0.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-primary' />
        </div>
      )}

      <div
        key={phase.kind}
        className='relative grid size-11 place-items-center rounded-xl border border-border/50 bg-background shadow-sm motion-reduce:animate-none animate-status-in'
      >
        <Icon className='size-5' aria-hidden />
      </div>
    </div>
  );
}

export function PreviewCenteredStatus({ phase, errorDetail, onRetry }: PreviewCenteredStatusProps) {
  const { t } = useAppBuilderStudioTranslation();
  const hint = phase.hintKey ? t(phase.hintKey as Parameters<typeof t>[0]) : null;

  return (
    <div className='flex size-full flex-col items-center justify-center gap-5 bg-background px-6 text-center'>
      <Orb phase={phase} />

      <div className='max-w-sm space-y-1.5' role='status' aria-live='polite'>
        <p
          key={`label-${phase.kind}`}
          className='text-sm font-semibold tracking-tight text-foreground motion-reduce:animate-none animate-status-in'
        >
          {t(phase.labelKey as Parameters<typeof t>[0])}
        </p>
        {phase.tone === 'error' && errorDetail ? (
          <p className='text-sm leading-relaxed text-fail'>{errorDetail}</p>
        ) : hint ? (
          <p
            key={`hint-${phase.kind}`}
            className='text-sm leading-relaxed text-muted-foreground motion-reduce:animate-none animate-status-in'
          >
            {hint}
          </p>
        ) : null}
      </div>

      {phase.showRetry && (
        <Button type='button' variant='outline' size='sm' onClick={onRetry} className='h-9 gap-2 px-4'>
          <PlaySquareIcon className='size-3.5' />
          {t('nodepod.retry')}
        </Button>
      )}
    </div>
  );
}
