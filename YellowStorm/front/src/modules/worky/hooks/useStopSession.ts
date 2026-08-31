import { useCallback } from 'react';
import { useModuleTranslation } from '@/modules/localization';
import { useStopTurn, useStream } from '../query/hooks';
import { useWorkyStore, useWorkyStreaming } from '../store';
import { useWorkyUiStore } from '../uiStore';
import type { WorkyStreamStatus } from '../types';

/**
 * Stream statuses for which there is a live orchestrator run to stop. Terminal
 * or idle states (created / stopped / completed / archived / paused) are
 * excluded so the global Stop control is only offered when it does something.
 */
const STOPPABLE_STATUSES: ReadonlySet<WorkyStreamStatus> = new Set([
  'planning',
  'start_requested',
  'active',
  'partially_blocked',
  'waiting_for_owner',
  'waiting_for_human',
  'waiting_for_budget_decision',
]);

export interface UseStopSession {
  /** Trigger the terminal StopSession RPC for this stream. Safe to call repeatedly. */
  stop: () => void;
  /** Whether there is a live run worth stopping (gates the button's enabled state). */
  canStop: boolean;
  /** Whether a stop request is currently in flight. */
  isStopping: boolean;
}

/**
 * Shared behaviour for every "stop the whole run" affordance (top bar button,
 * mobile header, composer stop icon, …). Wraps the StopSession mutation with:
 *   - gating (`canStop`) off the streaming flag and the stream status,
 *   - optimistic UI reset (clear the streaming flag + any stale stream error) so
 *     the composer flips back immediately; the authoritative flip still arrives
 *     via the `stream.stopped` / `stream.terminal` SSE events,
 *   - error surfacing through the module's inline banner (`notifySendError`),
 *     matching how send/transcription failures are shown rather than a toast.
 *
 * StopSession is terminal: the run cannot be resumed, so we do not attempt any
 * optimistic status rewrite beyond clearing the local streaming flag.
 */
export function useStopSession(streamId: string): UseStopSession {
  const { t } = useModuleTranslation('worky');
  const { data: stream } = useStream(streamId);
  const streaming = useWorkyStreaming();
  const setStreaming = useWorkyStore((s) => s.setStreaming);
  const setStreamError = useWorkyStore((s) => s.setStreamError);
  const notifySendError = useWorkyUiStore((s) => s.notifySendError);
  const stopTurn = useStopTurn();

  const canStop =
    !stopTurn.isPending &&
    (streaming || (stream ? STOPPABLE_STATUSES.has(stream.status) : false));

  const stop = useCallback(() => {
    if (stopTurn.isPending) return;
    stopTurn.mutate(
      { streamId },
      {
        onSuccess: () => {
          setStreaming(false);
          setStreamError(null);
        },
        onError: (err: unknown) => {
          const message = (err as { message?: string })?.message ?? t('stream.stopFailed');
          notifySendError(message);
        },
      },
    );
  }, [streamId, stopTurn, setStreaming, setStreamError, notifySendError, t]);

  return { stop, canStop, isStopping: stopTurn.isPending };
}
