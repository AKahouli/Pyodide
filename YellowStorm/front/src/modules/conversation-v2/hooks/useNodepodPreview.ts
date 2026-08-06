import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { UseNodepodPreviewArgs, UseNodepodPreviewResult } from '../interfaces';
import { nodepodRuntimeManager } from '../services/nodepod-runtime-manager';
import { nodepodRuntimeRegistry, createRuntimeKey } from '../services/nodepod-runtime-registry';
export {
  extractNodepodPortFromPreviewUrl,
  extractPortFromDevServerOutput,
  resolvePreviewPort,
} from '../services/nodepod-runtime-health';

export function useNodepodPreview({
  sessionId,
  cephPath,
  filesTree,
  revision = '',
}: UseNodepodPreviewArgs): UseNodepodPreviewResult {
  const runtimeKey = useMemo(
    () => (sessionId && revision ? createRuntimeKey(sessionId, revision) : null),
    [sessionId, revision],
  );

  const snapshot = useSyncExternalStore(
    (onStoreChange) => nodepodRuntimeRegistry.subscribe(onStoreChange),
    () => (runtimeKey ? nodepodRuntimeManager.getRuntime(runtimeKey) : null),
    () => null,
  );

  useEffect(() => {
    if (!sessionId || !cephPath || !filesTree || !revision) {
      return;
    }

    void nodepodRuntimeManager.ensureRuntime({
      sessionId,
      revision,
      cephPath,
      filesTree,
    }).catch(() => undefined);
  }, [sessionId, cephPath, filesTree, revision]);

  useEffect(() => {
    if (!runtimeKey) return;
    nodepodRuntimeManager.markAccessed(runtimeKey);
  }, [runtimeKey]);

  const retry = useCallback(() => {
    if (!runtimeKey) return;
    void nodepodRuntimeManager.retryRuntime(runtimeKey).catch(() => undefined);
  }, [runtimeKey]);

  if (!sessionId || !cephPath || !filesTree || !revision) {
    return {
      status: 'idle',
      previewUrl: null,
      error:
        !cephPath || !filesTree
          ? 'Source files are not available yet for in-browser preview.'
          : null,
      files: null,
      retry,
    };
  }

  return {
    status: snapshot?.status ?? 'queued',
    previewUrl: snapshot?.previewUrl ?? null,
    error: snapshot?.error ?? null,
    files: snapshot?.files ?? null,
    retry,
  };
}
