import { useEffect } from 'react';
import { useConversationV2Store } from '../store';

/**
 * While a turn is in flight, periodically gap-fill events in case the SSE
 * pipe missed the terminal `done` (backend already completed via gRPC).
 */
export function useStreamingReconcile(
  sessionId: string | null,
  loading: boolean,
  streaming: boolean,
  isReadOnlyViewer: boolean,
) {
  useEffect(() => {
    if (!sessionId || loading || !streaming || isReadOnlyViewer) return;
    const reconcile = () => {
      void useConversationV2Store.getState().reconcileCurrentSession();
    };
    reconcile();
    const timer = window.setInterval(reconcile, 8_000);
    return () => window.clearInterval(timer);
  }, [sessionId, loading, streaming, isReadOnlyViewer]);
}
