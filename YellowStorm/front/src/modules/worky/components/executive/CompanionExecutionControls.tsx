import type { JSX } from 'react';
import { Loader2, Pause, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useModuleTranslation } from '@/modules/localization';
import { showError } from '@/lib/notifications';
import { usePauseTurn, useResumeTurn, useStopTurn } from '../../query/hooks';

const STOPPABLE = new Set(['running', 'paused', 'waiting', 'blocked']);

export function CompanionExecutionControls({ streamId, sessionStatus, compact = false }: { streamId: string; sessionStatus?: string | null; compact?: boolean }): JSX.Element | null {
  const { t } = useModuleTranslation('worky');
  const pause = usePauseTurn();
  const resume = useResumeTurn();
  const stop = useStopTurn();
  const notifyError = (message: string) => (error: Error): void => {
    showError(message, { description: error.message });
  };
  if (!sessionStatus || !STOPPABLE.has(sessionStatus)) return null;
  const iconOnly = compact ? 'icon' : 'sm';

  return (
    <div className='flex items-center gap-2'>
      {sessionStatus === 'running' ? (
        <Button size={iconOnly} variant='outline' onClick={() => pause.mutate({ streamId }, { onError: notifyError(t('executive.controls.pauseFailed')) })} disabled={pause.isPending} aria-label={t('executive.controls.pause')}>
          {pause.isPending ? <Loader2 className='size-4 animate-spin' /> : <Pause className='size-4' />}
          {!compact ? <span>{t('executive.controls.pause')}</span> : null}
        </Button>
      ) : null}
      {sessionStatus === 'paused' ? (
        <Button size={iconOnly} variant='outline' onClick={() => resume.mutate({ streamId }, { onError: notifyError(t('executive.controls.resumeFailed')) })} disabled={resume.isPending} aria-label={t('executive.controls.resume')}>
          {resume.isPending ? <Loader2 className='size-4 animate-spin' /> : <Play className='size-4' />}
          {!compact ? <span>{t('executive.controls.resume')}</span> : null}
        </Button>
      ) : null}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size={iconOnly} variant='destructive' disabled={stop.isPending} aria-label={t('executive.controls.stop')}>
            {stop.isPending ? <Loader2 className='size-4 animate-spin' /> : <Square className='size-4' />}
            {!compact ? <span>{t('executive.controls.stop')}</span> : null}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('executive.controls.stopTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('executive.controls.stopDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction className='bg-destructive text-destructive-foreground hover:bg-destructive/90' onClick={() => stop.mutate({ streamId }, { onError: notifyError(t('executive.controls.stopFailed')) })}>
              {t('executive.controls.stopConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
