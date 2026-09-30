import { useEffect } from 'react';
import { getOrCreateHost, removeHost } from '../runtime/BrowserRuntimeHost';
import { mapHostStatusToRuntimeUi } from '../runtime/runtime.types';
import { useConversationV2Store } from '../store';

/**
 * Boot BrowserRuntimeHost at session open so Nodepod is long-lived.
 * Read-only viewers don't get a runtime (no ticket request).
 * ApplicationComponentView / useNodepodPreview only subscribe — they must not call start().
 */
export function useBrowserRuntimeBoot(
  sessionId: string | null,
  loading: boolean,
  isReadOnlyViewer: boolean,
) {
  useEffect(() => {
    if (!sessionId || loading || isReadOnlyViewer) return;
    const appComp = useConversationV2Store.getState().applicationComponent;
    const host = getOrCreateHost(sessionId);
    const syncRuntime = () => {
      useConversationV2Store
        .getState()
        .setRuntimeStatus(mapHostStatusToRuntimeUi(host.state.status));
    };
    syncRuntime();
    const unsubscribe = host.subscribe(syncRuntime);
    if (host.state.status === 'idle') {
      void host.start(
        sessionId,
        appComp?.cephPath ?? null,
        appComp?.filesTree ?? null,
      );
    }
    return () => {
      unsubscribe();
      removeHost(sessionId);
      useConversationV2Store.getState().setRuntimeStatus('idle');
    };
  }, [sessionId, loading, isReadOnlyViewer]);
}
