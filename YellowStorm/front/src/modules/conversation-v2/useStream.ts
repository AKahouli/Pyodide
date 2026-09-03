import { useEffect } from 'react';
import { conversationV2StreamService } from './conversationV2Stream';
import { useConversationV2Store } from './store';
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
export function useConversationV2StreamConnection() {
  const { isAuthenticated, user } = useAuth();
  const pendingApproval = user?.status === 'inactive';

  useEffect(() => {
    if (!isAuthenticated || pendingApproval) return;

    conversationV2StreamService.connect();
    const handleVisibilityChange = () => {
      if (document.hidden) return;
      void useConversationV2Store.getState().reconcileCurrentSession();
      if (!conversationV2StreamService.getIsConnected()) conversationV2StreamService.reconnectWithNewToken();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const unsubscribeConnected = conversationV2StreamService.subscribeConnected(() => {
      void useConversationV2Store.getState().reconcileCurrentSession();
    });
    const unsubscribe = conversationV2StreamService.subscribe((event) => {
      useConversationV2Store.getState().handleStreamEvent(event.type, event.data);
    });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribeConnected();
      unsubscribe();
      conversationV2StreamService.disconnect();
    };
  }, [isAuthenticated, pendingApproval]);
}
