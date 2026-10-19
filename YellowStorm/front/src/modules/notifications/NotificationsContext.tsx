/**
 * NotificationsContext - React context for notifications
 */

import * as React from 'react';
import { useAuth } from '@/modules/auth';
import { isPendingAdminApproval } from '@/modules/auth/utils/isPendingAdminApproval';
import { notificationsService, tNotification } from './NotificationsService';
import * as notificationsApi from './api';
import { toast } from 'sonner';
import type {
  Notification,
  SSEEvent,
  NotificationsState,
  NotificationsContextType,
} from './types';

const NotificationsContext = React.createContext<
  NotificationsContextType | undefined
>(undefined);

interface NotificationsProviderProps {
  children: React.ReactNode;
  showToasts?: boolean;
}

export function NotificationsProvider({
  children,
  showToasts = true,
}: NotificationsProviderProps) {
  const { isAuthenticated, user } = useAuth();
  const [state, setState] = React.useState<NotificationsState>({
    notifications: [],
    unreadCount: 0,
    isConnected: false,
    isLoading: false,
    error: null,
  });

  const ownerId = isAuthenticated && user && !isPendingAdminApproval(user) ? user.id : null;
  const ownerScope = React.useRef({ id: ownerId, active: false });
  if (ownerScope.current.id !== ownerId) ownerScope.current = { id: ownerId, active: false };
  const stateOwner = React.useRef(ownerId);
  const listRequest = React.useRef(0);
  const countRequest = React.useRef(0);
  const isCurrent = (scope: typeof ownerScope.current) => scope.active && scope === ownerScope.current && Boolean(scope.id);

  // Handle notification events
  const handleNotificationEvent = React.useCallback(
    (event: SSEEvent) => {
      switch (event.type) {
        case 'connected':
          setState((prev) => ({ ...prev, isConnected: true, error: null }));
          break;

        case 'disconnected':
          setState((prev) => ({ ...prev, isConnected: false }));
          break;

        case 'notification': {
          const notification = event.data as Notification;

          // Add to state
          setState((prev) => ({
            ...prev,
            notifications: [notification, ...prev.notifications].slice(0, 100), // Keep max 100
            unreadCount: prev.unreadCount + 1,
          }));

          // Show toast
          if (showToasts) {
            const toastFn = {
              info: toast.info,
              warning: toast.warning,
              error: toast.error,
              success: toast.success,
              system: toast.info,
            }[notification.type] || toast.info;

            toastFn(notification.title, {
              description: notification.message,
              duration:
                notification.metadata.priority === 'urgent' ? 10000 : 5000,
            });
          }
          break;
        }

        case 'reconnecting':
          setState((prev) => ({ ...prev, isConnected: false }));
          break;

        case 'error':
          setState((prev) => ({
            ...prev,
            error: tNotification('context.errors.connectionError', 'Connection error'),
            isConnected: false,
          }));
          break;

        case 'evicted':
          setState((prev) => ({
            ...prev,
            error: tNotification('context.errors.tooManyTabs', 'Too many tabs open'),
            isConnected: false,
          }));
          break;
      }
    },
    [showToasts],
  );

  // Only passive notifications pause when hidden. Agent execution streams keep running.
  React.useEffect(() => {
    const scope = ownerScope.current;
    scope.active = Boolean(ownerId);
    if (stateOwner.current !== ownerId || !ownerId) {
      stateOwner.current = ownerId;
      setState({ notifications: [], unreadCount: 0, isConnected: false, isLoading: false, error: null });
    }
    if (!ownerId) {
      notificationsService.disconnect();
      return;
    }
    const unsubscribe = notificationsService.subscribe(event => { if (isCurrent(scope)) handleNotificationEvent(event); });
    const visible = () => {
      if (!isCurrent(scope)) return;
      if (document.visibilityState === 'hidden') notificationsService.pause();
      else {
        notificationsService.connect();
        void fetchNotifications();
        void fetchUnreadCount();
      }
    };
    document.addEventListener('visibilitychange', visible);
    visible();
    return () => {
      scope.active = false;
      document.removeEventListener('visibilitychange', visible);
      unsubscribe();
      notificationsService.disconnect();
    };
  }, [ownerId, handleNotificationEvent]);

  // Fetch notifications
  const fetchNotifications = async () => {
    const scope = ownerScope.current;
    if (!isCurrent(scope)) return;
    const request = ++listRequest.current;
    try {
      setState((prev) => ({ ...prev, isLoading: true }));
      const data = await notificationsApi.getNotifications({ limit: 50 });
      if (!isCurrent(scope) || request !== listRequest.current) return;
      setState((prev) => ({
        ...prev,
        notifications: data.notifications,
        isLoading: false,
      }));
    } catch (error) {
      if (!isCurrent(scope) || request !== listRequest.current) return;
      setState((prev) => ({
        ...prev,
        error: tNotification('context.errors.fetchFailed', 'Failed to fetch notifications'),
        isLoading: false,
      }));
    }
  };

  // Fetch unread count
  const fetchUnreadCount = async () => {
    const scope = ownerScope.current;
    if (!isCurrent(scope)) return;
    const request = ++countRequest.current;
    try {
      const { count } = await notificationsApi.getUnreadCount();
      if (!isCurrent(scope) || request !== countRequest.current) return;
      setState((prev) => ({ ...prev, unreadCount: count }));
    } catch (error) {
      if (!isCurrent(scope) || request !== countRequest.current) return;
      console.error('Failed to fetch unread count:', error);
    }
  };

  // Mark as read
  const markAsRead = async (notificationIds: string[]) => {
    const scope = ownerScope.current;
    if (!isCurrent(scope)) return;
    try {
      await notificationsApi.markAsRead(notificationIds);
      if (!isCurrent(scope)) return;

      setState((prev) => ({
        ...prev,
        notifications: prev.notifications.map((n) =>
          notificationIds.includes(n.id)
            ? { ...n, status: 'read' as const, readAt: new Date().toISOString() }
            : n,
        ),
        unreadCount: Math.max(0, prev.unreadCount - notificationIds.length),
      }));
    } catch (error) {
      if (!isCurrent(scope)) return;
      toast.error(tNotification('context.errors.markReadFailed', 'Failed to mark notifications as read'));
      throw error;
    }
  };

  // Mark all as read
  const markAllAsRead = async () => {
    const scope = ownerScope.current;
    if (!isCurrent(scope)) return;
    try {
      await notificationsApi.markAllAsRead();
      if (!isCurrent(scope)) return;

      setState((prev) => ({
        ...prev,
        notifications: prev.notifications.map((n) => ({
          ...n,
          status: 'read' as const,
          readAt: new Date().toISOString(),
        })),
        unreadCount: 0,
      }));
    } catch (error) {
      if (!isCurrent(scope)) return;
      toast.error(tNotification('context.errors.markAllReadFailed', 'Failed to mark all notifications as read'));
      throw error;
    }
  };

  // Delete notification
  const deleteNotification = async (notificationId: string) => {
    const scope = ownerScope.current;
    if (!isCurrent(scope)) return;
    try {
      await notificationsApi.deleteNotification(notificationId);
      if (!isCurrent(scope)) return;

      setState((prev) => {
        const notification = prev.notifications.find(
          (n) => n.id === notificationId,
        );
        const wasUnread = notification && notification.status !== 'read';

        return {
          ...prev,
          notifications: prev.notifications.filter(
            (n) => n.id !== notificationId,
          ),
          unreadCount: wasUnread ? prev.unreadCount - 1 : prev.unreadCount,
        };
      });
    } catch (error) {
      if (!isCurrent(scope)) return;
      toast.error(tNotification('context.errors.deleteFailed', 'Failed to delete notification'));
      throw error;
    }
  };

  // Refresh notifications
  const refreshNotifications = async () => {
    await Promise.all([fetchNotifications(), fetchUnreadCount()]);
  };

  // Clear error
  const clearError = () => {
    setState((prev) => ({ ...prev, error: null }));
  };

  const value: NotificationsContextType = {
    ...(stateOwner.current === ownerId ? state : { notifications: [], unreadCount: 0, isConnected: false, isLoading: false, error: null }),
    markAsRead,
    markAllAsRead,
    deleteNotification,
    refreshNotifications,
    clearError,
  };

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextType {
  const context = React.useContext(NotificationsContext);
  if (context === undefined) {
    throw new Error(
      'useNotifications must be used within a NotificationsProvider',
    );
  }
  return context;
}

export { NotificationsContext };
