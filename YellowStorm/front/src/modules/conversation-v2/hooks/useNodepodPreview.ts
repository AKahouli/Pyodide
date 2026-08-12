import { useCallback, useEffect, useRef, useState } from 'react';
import { getOrCreateHost, type HostState } from '../runtime/BrowserRuntimeHost';
import type { RuntimeHostStatus } from '../runtime/runtime.types';

// Re-export the port-resolution helpers so call-sites that import from here
// continue to work unchanged.
export {
  extractNodepodPortFromPreviewUrl,
  extractPortFromDevServerOutput,
  resolvePreviewPort,
} from '../runtime/PreviewController';

export type NodepodPreviewStatus =
  | 'idle'
  | 'loading'
  | 'installing'
  | 'starting'
  | 'ready'
  | 'error';

export interface UseNodepodPreviewArgs {
  sessionId: string | null;
}

export interface UseNodepodPreviewResult {
  status: NodepodPreviewStatus;
  previewUrl: string | null;
  error: string | null;
  files: Record<string, string | Uint8Array> | null;
  retry: () => void;
}

function hostStatusToPreviewStatus(s: RuntimeHostStatus): NodepodPreviewStatus {
  switch (s) {
    case 'connecting':
    case 'registering':
    case 'hydrating':
      return 'loading';
    case 'installing':
      return 'installing';
    case 'starting':
      return 'starting';
    case 'ready':
      return 'ready';
    case 'error':
    case 'disconnected':
      return 'error';
    case 'idle':
    default:
      return 'idle';
  }
}

/**
 * Thin wrapper around BrowserRuntimeHost.
 *
 * The host is long-lived at session scope (booted in ConversationV2SessionPage),
 * so this hook merely subscribes to its observable state and maps it to the
 * existing NodepodPreviewStatus shape that ApplicationComponentView expects.
 */
export function useNodepodPreview({
  sessionId,
}: UseNodepodPreviewArgs): UseNodepodPreviewResult {
  const [status, setStatus] = useState<NodepodPreviewStatus>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, string | Uint8Array> | null>(null);
  const hostRef = useRef<ReturnType<typeof getOrCreateHost> | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setStatus('idle');
      setPreviewUrl(null);
      setError(null);
      setFiles(null);
      return;
    }

    const host = getOrCreateHost(sessionId);
    hostRef.current = host;

    const sync = (state: HostState) => {
      setStatus(hostStatusToPreviewStatus(state.status));
      setPreviewUrl(state.previewUrl);
      setError(state.error);
      setFiles(state.files);
    };

    // Sync current state immediately
    sync(host.state);
    const unsubscribe = host.subscribe(sync);

    return () => {
      unsubscribe();
    };
  }, [sessionId]);

  const retry = useCallback(() => {
    hostRef.current?.retry();
  }, []);

  return { status, previewUrl, error, files, retry };
}
