/**
 * NotificationsContext - React context for notifications
 */

import * as React from 'react';
import { useAuth } from '@/modules/auth';
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

  // Subscribe to notification service
  React.useEffect(() => {
    if (!isAuthenticated || !user) {
      notificationsService.disconnect();
      setState({
        notifications: [],
        unreadCount: 0,
        isConnected: false,
        isLoading: false,
        error: null,
      });
      return;
    }

    // Subscribe to events
    const unsubscribe = notificationsService.subscribe(handleNotificationEvent);

    // Connect
    notificationsService.connect();

    // Fetch initial notifications and count
    fetchNotifications();
    fetchUnreadCount();

    return () => {
      unsubscribe();
      notificationsService.disconnect();
    };
  }, [isAuthenticated, user?.id, handleNotificationEvent]);

  // Fetch notifications
  const fetchNotifications = async () => {
    try {
      setState((prev) => ({ ...prev, isLoading: true }));
      const data = await notificationsApi.getNotifications({ limit: 50 });
      setState((prev) => ({
        ...prev,
        notifications: data.notifications,
        isLoading: false,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: tNotification('context.errors.fetchFailed', 'Failed to fetch notifications'),
        isLoading: false,
      }));
    }
  };

  // Fetch unread count
  const fetchUnreadCount = async () => {
    try {
      const { count } = await notificationsApi.getUnreadCount();
      setState((prev) => ({ ...prev, unreadCount: count }));
    } catch (error) {
      console.error('Failed to fetch unread count:', error);
    }
  };

  // Mark as read
  const markAsRead = async (notificationIds: string[]) => {
    try {
      await notificationsApi.markAsRead(notificationIds);

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
      toast.error(tNotification('context.errors.markReadFailed', 'Failed to mark notifications as read'));
      throw error;
    }
  };

  // Mark all as read
  const markAllAsRead = async () => {
    try {
      await notificationsApi.markAllAsRead();

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
      toast.error(tNotification('context.errors.markAllReadFailed', 'Failed to mark all notifications as read'));
      throw error;
    }
  };

  // Delete notification
  const deleteNotification = async (notificationId: string) => {
    try {
      await notificationsApi.deleteNotification(notificationId);

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
    ...state,
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
