import { useEffect } from 'react';
import { appBuilderStudioStreamService } from './appBuilderStudioStream';
import { useAppBuilderStudioStore } from './store';
import { useAuth } from '@/modules/auth';

/**
 * Mounts the single, per-user SSE pipe and routes its events into the store.
 *
 * Call this ONCE at the app shell (RootGuard), not per conversation page. The
 * connection is intentionally decoupled from any conversation view: it stays
 * open across navigation so multiple conversations can stream at the same time
 * and the user can switch between them freely. Events are tagged with their
 * `sessionId`; the store renders the current one live and accumulates the rest
 * in its background cache.
 */
export function useAppBuilderStudioStreamConnection() {
  const { isAuthenticated, user } = useAuth();
  const pendingApproval = user?.status === 'inactive';

  useEffect(() => {
    if (!isAuthenticated || pendingApproval) return;

    appBuilderStudioStreamService.connect();
    const handleVisibilityChange = () => {
      if (document.hidden) return;
      void useAppBuilderStudioStore.getState().reconcileCurrentSession();
      if (!appBuilderStudioStreamService.getIsConnected()) appBuilderStudioStreamService.reconnectWithNewToken();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const unsubscribeConnected = appBuilderStudioStreamService.subscribeConnected(() => {
      void useAppBuilderStudioStore.getState().reconcileCurrentSession();
    });
    const unsubscribe = appBuilderStudioStreamService.subscribe((event) => {
      useAppBuilderStudioStore.getState().handleStreamEvent(event.type, event.data);
    });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribeConnected();
      unsubscribe();
      appBuilderStudioStreamService.disconnect();
    };
  }, [isAuthenticated, pendingApproval]);
}
