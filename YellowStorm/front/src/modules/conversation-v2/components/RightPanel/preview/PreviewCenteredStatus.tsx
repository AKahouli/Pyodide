import { Button } from '@/components/ui/button';
import { PlaySquareIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useConversationV2Translation } from '../../../translation';
import type { PreviewPhase } from './previewStateModel';

/**
 * Centred, ambient status surface shown while the NodePod runtime boots.
 *
 * Deliberately *not* a progress bar and deliberately not a skeleton preview: the
 * user asked for a single calm animation plus a message that names the phase.
 * Every layer animates `currentColor` only (see the orb keyframes in index.css)
 * so the whole effect re-themes for free across COLOR_THEMES.
 */

const ORB_SIZE = 'size-28';

interface PreviewCenteredStatusProps {
  phase: PreviewPhase;
  /** Sanitised, user-facing error detail. Only rendered for the error phase. */
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
        // Busy phases carry the primary colour; error/idle stay neutral so the
        // animation never reads as "working" when nothing is happening.
        isBusy ? 'text-primary' : phase.tone === 'error' ? 'text-fail' : 'text-muted-foreground',
      )}
    >
      {/* Ambient halo. Purely decorative, so it is hidden from assistive tech. */}
      {isBusy && (
        <>
          <div
            aria-hidden
            className='absolute inset-0 rounded-full bg-primary/20 blur-2xl motion-reduce:hidden animate-orb-breathe'
          />
          <div
            aria-hidden
            className='absolute inset-1 rounded-full border border-primary/40 motion-reduce:animate-none animate-orb-ping'
          />
        </>
      )}

      {/* Ring 1 — solid, slow clockwise spin. */}
      <div
        aria-hidden
        className={cn(
          'absolute inset-0 rounded-full border',
          isBusy ? 'border-primary/30 motion-reduce:animate-none animate-orb-orbit' : 'border-border',
        )}
      />
      {/* Ring 2 — dashed, counter-rotating at a different period so the two
          never realign, which is what keeps the motion from reading as a loop. */}
      <div
        aria-hidden
        className={cn(
          'absolute inset-2 rounded-full border border-dashed',
          isBusy ? 'border-primary/20 motion-reduce:animate-none animate-orb-orbit-reverse' : 'border-border/60',
        )}
      />

      {/* Orbiting dots. The container spins; each dot counter-spins so it stays
          upright instead of tumbling with the ring. */}
      {isBusy && (
        <div aria-hidden className='absolute inset-0 motion-reduce:animate-none animate-orb-orbit'>
          <span className='absolute -top-0.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-primary' />
          <span className='absolute -translate-x-1/2 rounded-full bg-primary/70 bottom-[6%] left-[12%] size-1 motion-reduce:rotate-0' />
          <span className='absolute -translate-x-1/2 rounded-full bg-primary/50 bottom-[18%] right-[4%] size-1 motion-reduce:rotate-0' />
        </div>
      )}

      {/* Centre icon. Keyed on the phase so it cross-fades between phases. */}
      <div
        key={phase.kind}
        className='relative grid size-11 place-items-center rounded-full bg-background/80 backdrop-blur-sm motion-reduce:animate-none animate-status-in'
      >
        <Icon className='size-5' aria-hidden />
      </div>
    </div>
  );
}

export function PreviewCenteredStatus({ phase, errorDetail, onRetry }: PreviewCenteredStatusProps) {
  const { t } = useConversationV2Translation();
  const hint = phase.hintKey ? t(phase.hintKey as Parameters<typeof t>[0]) : null;

  return (
    <div className='flex size-full flex-col items-center justify-center gap-7 bg-gradient-to-b from-muted/30 to-background px-6 text-center'>
      <Orb phase={phase} />

      {/* role=status announces each phase change without stealing focus. */}
      <div className='max-w-sm space-y-2' role='status' aria-live='polite'>
        <p
          key={`label-${phase.kind}`}
          className='text-lg font-semibold tracking-tight text-foreground motion-reduce:animate-none animate-status-in'
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
        <Button
          type='button'
          variant='outline'
          size='lg'
          onClick={onRetry}
          className='h-10 gap-2 px-6 text-sm font-medium transition-transform duration-200 hover:scale-[1.01] active:scale-[0.99]'
        >
          <PlaySquareIcon className='size-4' />
          {t('nodepod.retry')}
        </Button>
      )}
    </div>
  );
}
