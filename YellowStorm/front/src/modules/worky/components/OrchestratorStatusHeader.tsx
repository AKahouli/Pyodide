import { AlertTriangle, Bot, Loader2 } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { useWorkyStore } from '../store';
import type { WorkyBoardLane, WorkyStream, WorkyTask } from '../types';
import { cn } from '@/lib/utils';

interface OrchestratorStatusHeaderProps {
  stream: WorkyStream | undefined;
  board: Record<WorkyBoardLane, WorkyTask[]> | null;
}

type OrchestratorPhase =
  | 'idle'
  | 'thinking'
  | 'planning'
  | 'dispatching'
  | 'waiting'
  | 'reviewing';

function resolvePhase(
  stream: WorkyStream | undefined,
  board: Record<WorkyBoardLane, WorkyTask[]> | null,
  streaming: boolean,
  hasAssistantText: boolean,
): OrchestratorPhase {
  if (streaming) return hasAssistantText ? 'thinking' : 'planning';
  if (
    stream?.status === 'planning' ||
    stream?.status === 'start_requested' ||
    stream?.status === 'created'
  ) {
    return 'planning';
  }
  if (board && (board.running?.length ?? 0) > 0) return 'dispatching';
  if (
    stream?.status === 'waiting_for_owner' ||
    stream?.status === 'waiting_for_human' ||
    stream?.status === 'waiting_for_budget_decision' ||
    stream?.status === 'start_validation_failed'
  ) {
    return 'waiting';
  }
  if (board && (board.review?.length ?? 0) > 0) return 'reviewing';
  return 'idle';
}

export function OrchestratorStatusHeader({
  stream,
  board,
}: OrchestratorStatusHeaderProps): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const streaming = useWorkyStore((s) => s.streaming);
  const assistantText = useWorkyStore((s) => s.assistantText);
  const streamError = useWorkyStore((s) => s.streamError);
  const setStreamError = useWorkyStore((s) => s.setStreamError);
  const phase = resolvePhase(stream, board, streaming, assistantText.length > 0);
  const isActive = phase !== 'idle';

  return (
    <div
      data-testid='worky-orchestrator-status'
      data-phase={phase}
      className={cn(
        'flex flex-col gap-2 rounded-md border px-3 py-2 transition-colors',
        isActive
          ? 'border-primary/40 bg-primary/5'
          : 'border-border/60 bg-background/40',
      )}
    >
      <div className='flex items-center justify-between gap-2'>
        <div className='flex items-center gap-2'>
          {streaming ? (
            <Loader2 className='h-3.5 w-3.5 animate-spin text-primary' aria-hidden />
          ) : (
            <Bot className='h-3.5 w-3.5 text-muted-foreground' aria-hidden />
          )}
          <span className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
            {t('orchestrator.title')}
          </span>
        </div>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            isActive ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          {t(`orchestrator.status.${phase}`)}
        </span>
      </div>
      {stream ? (
        <p className='text-xs text-muted-foreground'>
          {t('orchestrator.models.summary', {
            manager: stream.managerModelId ?? t('orchestrator.models.default'),
            workers: stream.workerModelId ?? t('orchestrator.models.default'),
          })}
        </p>
      ) : null}
      {streaming && assistantText ? (
        <p
          aria-live='polite'
          className='line-clamp-3 whitespace-pre-wrap break-words text-xs italic text-foreground/80'
        >
          {assistantText}
        </p>
      ) : streaming ? (
        <div
          aria-live='polite'
          className='flex items-center gap-1 text-xs italic text-foreground/80'
          data-testid='worky-manager-progress'
        >
          <span>{t('messages.streamingLabel')}</span>
          <span className='h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.2s]' />
          <span className='h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.1s]' />
          <span className='h-1.5 w-1.5 animate-bounce rounded-full bg-primary' />
        </div>
      ) : null}
      {streamError ? (
        <div
          role='alert'
          data-testid='worky-stream-error'
          className='flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive'
        >
          <AlertTriangle className='mt-0.5 h-3.5 w-3.5 flex-none' aria-hidden />
          <span className='flex-1 break-words'>{streamError}</span>
          <button
            type='button'
            className='text-destructive/80 underline-offset-2 hover:underline'
            onClick={() => setStreamError(null)}
          >
            {t('stream.errorDismiss')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
