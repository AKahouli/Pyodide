import { Loader2Icon, AlertCircleIcon, CheckCircle2Icon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AppBuildProgress } from '../../types';
import { useConversationV2Translation } from '../../translation';
import {
  APP_BUILD_PHASE_ORDER,
  buildPhaseTranslationKey,
  isFailedBuildPhase,
  isReadyBuildPhase,
  phaseIndex,
} from '../../utils/app-build-phase';

interface AppBuildProgressPanelProps {
  progress: AppBuildProgress;
  title?: string;
}

export function AppBuildProgressPanel({ progress, title }: AppBuildProgressPanelProps) {
  const { t } = useConversationV2Translation();
  const currentIdx = phaseIndex(progress.phase);
  const failed = isFailedBuildPhase(progress.phase);
  const ready = isReadyBuildPhase(progress.phase);
  const phaseKey = buildPhaseTranslationKey(progress.phase);
  const translatedPhase = t(phaseKey);
  const phaseLabel = translatedPhase === phaseKey ? progress.message : translatedPhase;

  return (
    <div className='flex h-full min-h-0 flex-col overflow-hidden bg-muted/10'>
      <div className='flex h-10 shrink-0 items-center gap-2 border-b bg-card/60 px-3'>
        <Badge
          variant='secondary'
          className={cn(
            'gap-1 border-0 text-[10px] font-normal',
            failed && 'bg-destructive/15 text-destructive',
            ready && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
            !failed && !ready && 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
          )}
        >
          {!failed && !ready && <Loader2Icon className='size-3 animate-spin' />}
          {failed && <AlertCircleIcon className='size-3' />}
          {ready && <CheckCircle2Icon className='size-3' />}
          {phaseLabel}
        </Badge>
        {title && (
          <span className='truncate text-xs text-muted-foreground'>{title}</span>
        )}
      </div>

      <div className='flex flex-1 flex-col items-center justify-center gap-6 overflow-auto px-6 py-8'>
        <div className='relative'>
          {!failed && !ready && (
            <div className='absolute inset-0 animate-ping rounded-full bg-primary/20' />
          )}
          <div
            className={cn(
              'relative flex size-12 items-center justify-center rounded-full',
              failed ? 'bg-destructive/10' : ready ? 'bg-emerald-500/10' : 'bg-primary/10',
            )}
          >
            {failed ? (
              <AlertCircleIcon className='size-5 text-destructive' />
            ) : ready ? (
              <CheckCircle2Icon className='size-5 text-emerald-600 dark:text-emerald-400' />
            ) : (
              <Loader2Icon className='size-5 animate-spin text-primary' />
            )}
          </div>
        </div>

        <div className='max-w-sm space-y-2 text-center'>
          <p className='text-sm font-medium'>{title || t('nodepod.previewTitle')}</p>
          <p className='text-xs text-muted-foreground leading-relaxed'>{progress.message}</p>
        </div>

        <ol className='w-full max-w-md space-y-2'>
          {APP_BUILD_PHASE_ORDER.filter((p) => p !== 'failed').map((phase) => {
            const idx = phaseIndex(phase);
            const done = idx < currentIdx || (ready && phase !== 'ready');
            const active = phase === progress.phase;
            const labelKey = buildPhaseTranslationKey(phase);
            const translated = t(labelKey);
            const label = translated === labelKey ? phase.replaceAll('_', ' ') : translated;
            return (
              <li
                key={phase}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                  active && 'bg-primary/10 text-foreground font-medium',
                  done && !active && 'text-muted-foreground',
                  !done && !active && 'text-muted-foreground/60',
                )}
              >
                <span
                  className={cn(
                    'inline-flex size-4 shrink-0 items-center justify-center rounded-full border text-[9px]',
                    done && 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
                    active && !done && 'border-primary/40 bg-primary/10',
                  )}
                >
                  {done ? '✓' : active ? '•' : ''}
                </span>
                <span className='truncate'>{label}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
