import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getOrCreateHost,
  type HostState,
} from '../runtime/BrowserRuntimeHost';
import {
  mapHostStatusToRuntimeUi,
  type RuntimeHostStatus,
} from '../runtime/runtime.types';
import { useConversationV2Store } from '../store';

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
  /**
   * Callback ref for the preview `<iframe>`. Registering it lets the
   * `preview_inspect` / `preview_action` tools reach the running app's DOM.
   */
  previewIframeRef: (element: HTMLIFrameElement | null) => void;
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
 * The host is long-lived at session scope (booted in ConversationV2SessionPage).
 * This hook MUST NOT call `host.start()` — that would double-boot Nodepod.
 * It only subscribes, mirrors status into the Zustand store, and wires the iframe.
 */
export function useNodepodPreview({
  sessionId,
}: UseNodepodPreviewArgs): UseNodepodPreviewResult {
  const [status, setStatus] = useState<NodepodPreviewStatus>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, string | Uint8Array> | null>(null);
  const hostRef = useRef<ReturnType<typeof getOrCreateHost> | null>(null);
  const setRuntimeStatus = useConversationV2Store((s) => s.setRuntimeStatus);

  useEffect(() => {
    if (!sessionId) {
      setStatus('idle');
      setPreviewUrl(null);
      setError(null);
      setFiles(null);
      setRuntimeStatus('idle');
      return;
    }

    const host = getOrCreateHost(sessionId);
    hostRef.current = host;

    const sync = (state: HostState) => {
      setStatus(hostStatusToPreviewStatus(state.status));
      setPreviewUrl(state.previewUrl);
      setError(state.error);
      setFiles(state.files);
      setRuntimeStatus(mapHostStatusToRuntimeUi(state.status));
    };

    sync(host.state);
    const unsubscribe = host.subscribe(sync);

    return () => {
      unsubscribe();
      host.detachPreviewIframe();
    };
  }, [sessionId, setRuntimeStatus]);

  const retry = useCallback(() => {
    hostRef.current?.retry();
  }, []);

  const previewIframeRef = useCallback((element: HTMLIFrameElement | null) => {
    const host = hostRef.current;
    if (!host) return;
    if (element) host.attachPreviewIframe(element);
    else host.detachPreviewIframe();
  }, []);

  return { status, previewUrl, error, files, retry, previewIframeRef };
}
