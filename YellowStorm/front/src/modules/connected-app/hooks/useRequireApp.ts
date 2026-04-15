import { useCallback } from 'react';
import { useConnectedAppStore } from '../store';

/**
 * Hook for requiring an app connection before proceeding with an action.
 * If the user is not connected, triggers the OAuth popup.
 *
 * @example
 * const { isConnected, ensureConnected } = useRequireApp('google-drive');
 *
 * const handleAttachFile = async () => {
 *   const connected = await ensureConnected();
 *   if (!connected) return; // User cancelled
 *   // Open file picker...
 * };
 */
export function useRequireApp(appKey: string) {
  const isConnected = useConnectedAppStore((s) => s.isConnected(appKey));
  const isLoading = useConnectedAppStore((s) => s.isLoading);
  const connectingAppKey = useConnectedAppStore((s) => s.connectingAppKey);
  const connectApp = useConnectedAppStore((s) => s.connectApp);

  const ensureConnected = useCallback(async (): Promise<boolean> => {
    if (isConnected) return true;
    return connectApp(appKey);
  }, [isConnected, connectApp, appKey]);

  return {
    isConnected,
    isLoading,
    isConnecting: connectingAppKey === appKey,
    ensureConnected,
  };
}
