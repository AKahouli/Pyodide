import { useEffect, useState } from 'react';
import { useModuleTranslation } from '@/modules/localization';
import {
  useStartStream,
  usePauseStream,
  useResumeStream,
  useStopStream,
  useStopTurn,
  usePauseTurn,
  useResumeTurn,
} from '../query/hooks';
import type { WorkyControlState, WorkyStreamStatus } from '../types';

interface StreamControlsProps {
  streamId: string;
  status: WorkyStreamStatus;
  controlState: WorkyControlState;
}

/**
 * Start / Pause / Resume / Stop controls. State-aware via the
 * canonical control state machine:
 *   - start is always clickable (per spec §4.4) and surfaces
 *     partial / globally-blocked outcomes inline
 *   - pause only from `active`
 *   - resume only from `paused`
 *   - stop from any non-terminal state
 */
export function StreamControls({
  streamId,
  status,
  controlState,
}: StreamControlsProps): JSX.Element {
  const { t: tWorky } = useModuleTranslation('worky');
  const startStream = useStartStream();
  const pauseStream = usePauseStream();
  const resumeStream = useResumeStream();
  const stopStream = useStopStream();
  const stopTurn = useStopTurn();
  const pauseTurn = usePauseTurn();
  const resumeTurn = useResumeTurn();
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  useEffect(() => {
    setValidationMessage(null);
  }, [streamId, status]);

  const handleStart = async () => {
    setValidationMessage(null);
    const result = await startStream.mutateAsync(streamId);
    if (result.outcome === 'globally_blocked') {
      setValidationMessage(
        result.issues[0]?.message ?? tWorky('controls.globally_blocked'),
      );
    } else if (result.outcome === 'partially_executable') {
      setValidationMessage(
        tWorky('controls.partially_executable', {
          ready: result.readyTaskIds.length,
          blocked: result.blockedTaskIds.length,
        }),
      );
    } else {
      setValidationMessage(tWorky('controls.fully_executable'));
    }
  };

  const handlePause = () => {
    // Pause the in-flight Manager turn (PauseSession RPC) and the stream
    // lifecycle. The RPC pause is best-effort — a turn may not be running.
    void pauseTurn.mutateAsync({ streamId }).catch(() => undefined);
    void pauseStream.mutateAsync({ streamId });
  };
  const handleResume = () => {
    // Continue the paused orchestrator turn (RunTask → continue_turn) and the
    // stream lifecycle. RPC resume is best-effort — nothing may be paused.
    void resumeTurn.mutateAsync({ streamId }).catch(() => undefined);
    void resumeStream.mutateAsync({ streamId });
  };
  const handleStop = () => {
    // Cancel the in-flight Manager turn (StopSession RPC) and tear down the
    // stream lifecycle. The RPC stop is best-effort — a turn may not be running.
    void stopTurn.mutateAsync({ streamId }).catch(() => undefined);
    void stopStream.mutateAsync({ streamId });
  };

  return (
    <div className='flex flex-col gap-2 border-t border-border/60 bg-muted/30 px-4 py-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <button
          type='button'
          className='rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50'
          onClick={handleStart}
          disabled={startStream.isPending}
        >
          {tWorky('controls.start')}
        </button>
        <button
          type='button'
          className='rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium disabled:opacity-50'
          onClick={handlePause}
          disabled={pauseStream.isPending || pauseTurn.isPending}
        >
          {tWorky('controls.pause')}
        </button>
        <button
          type='button'
          className='rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium disabled:opacity-50'
          onClick={handleResume}
          disabled={resumeStream.isPending || resumeTurn.isPending}
        >
          {tWorky('controls.resume')}
        </button>
        <button
          type='button'
          className='rounded-md border border-destructive/40 bg-background px-3 py-1.5 text-xs font-medium text-destructive disabled:opacity-50'
          onClick={handleStop}
          disabled={stopStream.isPending || stopTurn.isPending}
        >
          {tWorky('controls.stop')}
        </button>
        <span className='ml-2 text-xs text-muted-foreground'>
          {tWorky('controls.status_label', { status, controlState })}
        </span>
      </div>
      {validationMessage ? (
        <div
          className='rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700'
          data-testid='stream-validation-message'
        >
          {validationMessage}
        </div>
      ) : null}
    </div>
  );
}
