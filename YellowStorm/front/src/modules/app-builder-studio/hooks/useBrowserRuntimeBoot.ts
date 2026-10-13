import { useEffect } from 'react';
import { getOrCreateHost, removeHost } from '../runtime/BrowserRuntimeHost';
import { mapHostStatusToRuntimeUi } from '../runtime/runtime.types';
import { useAppBuilderStudioStore } from '../store';

export type RuntimeBootCapability = 'web_app' | 'database_design';

/**
 * Boot BrowserRuntimeHost at session open so Nodepod is long-lived.
 * Read-only viewers don't get a runtime (no ticket request).
 * Schema-design sessions skip NodePod entirely.
 * ApplicationComponentView / useNodepodPreview only subscribe — they must not call start().
 */
export function useBrowserRuntimeBoot(
  sessionId: string | null,
  loading: boolean,
  isReadOnlyViewer: boolean,
  capability: RuntimeBootCapability = 'web_app',
) {
  useEffect(() => {
    if (!sessionId || loading || isReadOnlyViewer) return;
    if (capability !== 'web_app') {
      useAppBuilderStudioStore.getState().setRuntimeStatus('idle');
      return;
    }
    const appComp = useAppBuilderStudioStore.getState().applicationComponent;
    const host = getOrCreateHost(sessionId);
    const syncRuntime = () => {
      useAppBuilderStudioStore
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
      useAppBuilderStudioStore.getState().setRuntimeStatus('idle');
    };
  }, [sessionId, loading, isReadOnlyViewer, capability]);
}
