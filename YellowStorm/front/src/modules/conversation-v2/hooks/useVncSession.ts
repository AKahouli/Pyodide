import { useEffect, useState, useCallback } from 'react';
import { conversationV2Api } from '../api';

export type VncStatus =
  | 'idle'
  | 'fetching-url'
  | 'connecting'
  | 'connected'
  | 'taken-over'
  | 'unavailable'
  | 'error';

interface State {
  status: VncStatus;
  url: string | null;
  error: string | null;
}

interface UseVncSessionOptions {
  autoStart?: boolean;
}

export function useVncSession(
  sessionId: string | null,
  opts: UseVncSessionOptions = {},
) {
  const [state, setState] = useState<State>({ status: 'idle', url: null, error: null });

  const start = useCallback(async () => {
    if (!sessionId) return;
    setState({ status: 'fetching-url', url: null, error: null });
    try {
      const { url } = await conversationV2Api.getVncSignedUrl(sessionId);
      setState({ status: 'connecting', url, error: null });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { code?: string } } }; message?: string };
      const code = e?.response?.data?.error?.code;
      if (code === 'VM_UNAVAILABLE') {
        setState({ status: 'unavailable', url: null, error: null });
        return;
      }
      setState({ status: 'error', url: null, error: e?.message ?? 'failed' });
    }
  }, [sessionId]);

  const markConnected = useCallback(
    () => setState((s) => ({ ...s, status: 'connected' })),
    [],
  );
  const markTakenOver = useCallback(
    () => setState((s) => ({ ...s, status: 'taken-over' })),
    [],
  );
  const markError = useCallback(
    (msg: string) => setState({ status: 'error', url: null, error: msg }),
    [],
  );

  useEffect(() => {
    if (opts.autoStart) void start();
  }, [opts.autoStart, start]);

  return { ...state, start, markConnected, markTakenOver, markError };
}
