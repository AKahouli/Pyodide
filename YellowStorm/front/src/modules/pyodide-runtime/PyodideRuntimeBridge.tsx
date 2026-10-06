import { useEffect } from 'react';
import { AUTH_STORAGE_KEYS } from '@/lib/api/config';
import { useAuth } from '@/modules/auth';
import { PyodideRuntimeClient } from './PyodideRuntimeClient';

export const DEFAULT_PYODIDE_INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';

/**
 * Application-level bridge: exposes the browser Python runtime to YellowMind
 * everywhere (Conversations and Playbooks). Rendered once in `App.tsx` so it is
 * independent of any single conversation surface.
 */
export function PyodideRuntimeBridge(): null {
  const { user, isAuthenticated } = useAuth();
  const enabled = import.meta.env.VITE_PYODIDE_RUNTIME_ENABLED === 'true';

  useEffect(() => {
    if (!enabled || !isAuthenticated) return undefined;

    const client = new PyodideRuntimeClient({
      getToken: () => localStorage.getItem(AUTH_STORAGE_KEYS.accessToken),
      indexUrl: import.meta.env.VITE_PYODIDE_INDEX_URL || DEFAULT_PYODIDE_INDEX_URL,
    });
    client.connect();
    return () => client.disconnect();
  }, [enabled, isAuthenticated, user?.id]);

  return null;
}

export default PyodideRuntimeBridge;
