import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getOrCreateHost,
  type HostState,
} from '../runtime/BrowserRuntimeHost';
import {
  type RuntimeHostStatus,
} from '../runtime/runtime.types';

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
  /**
   * The un-collapsed runtime status. `status` folds `connecting`/`registering`/
   * `hydrating` into a single `loading`; the UI needs the distinction because
   * hydration is the slowest phase (it streams the whole template from Ceph) and
   * collapsing it leaves the user staring at one spinner for many seconds.
   */
  hostStatus: RuntimeHostStatus;
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
 * The host is long-lived at session scope (booted in AppBuilderStudioSessionPage).
 * This hook MUST NOT call `host.start()` — that would double-boot Nodepod.
 * It only subscribes, mirrors status into the Zustand store, and wires the iframe.
 */
export function useNodepodPreview({
  sessionId,
}: UseNodepodPreviewArgs): UseNodepodPreviewResult {
  const [status, setStatus] = useState<NodepodPreviewStatus>('idle');
  const [hostStatus, setHostStatus] = useState<RuntimeHostStatus>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, string | Uint8Array> | null>(null);
  const hostRef = useRef<ReturnType<typeof getOrCreateHost> | null>(null);

  useEffect(() => {
    if (!sessionId) {
      const prev = hostRef.current;
      hostRef.current = null;
      prev?.detachPreviewIframe();
      setStatus('idle');
      setHostStatus('idle');
      setPreviewUrl(null);
      setError(null);
      setFiles(null);
      return;
    }

    const host = getOrCreateHost(sessionId);
    // Only detach when switching to a different host instance; same reference
    // must keep the live iframe (avoids a blank flash on remount).
    if (hostRef.current && hostRef.current !== host) {
      hostRef.current.detachPreviewIframe();
    }
    hostRef.current = host;

    const sync = (state: HostState) => {
      setStatus(hostStatusToPreviewStatus(state.status));
      setHostStatus(state.status);
      setPreviewUrl(state.previewUrl);
      setError(state.error);
      setFiles(state.files);
    };

    sync(host.state);
    const unsubscribe = host.subscribe(sync);

    return () => {
      unsubscribe();
      // Detach only when leaving this host for a different one / null session —
      // handled at the top of the next effect run, or on unmount below.
    };
  }, [sessionId]);

  // Unmount: release the visible iframe (hidden preview iframe stays with the host).
  useEffect(() => {
    return () => {
      hostRef.current?.detachPreviewIframe();
      hostRef.current = null;
    };
  }, []);

  const retry = useCallback(() => {
    hostRef.current?.retry();
  }, []);

  const previewIframeRef = useCallback((element: HTMLIFrameElement | null) => {
    const host = hostRef.current;
    if (!host) return;
    if (element) host.attachPreviewIframe(element);
    else host.detachPreviewIframe();
  }, []);

  return { status, hostStatus, previewUrl, error, files, retry, previewIframeRef };
}
