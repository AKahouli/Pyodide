/**
 * Notification Types
 */

export type NotificationType = 'info' | 'warning' | 'error' | 'success' | 'system';
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'read';
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface NotificationAction {
  label?: string;
  url?: string;
  action?: string;
}

export interface NotificationMetadata {
  sourceModule: string;
  priority: NotificationPriority;
  expiresAt?: string;
  extra?: Record<string, unknown>;
}

export interface Notification {
  id: string;
  userId?: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  actions?: NotificationAction[];
  destination: string;
  status: NotificationStatus;
  metadata: NotificationMetadata;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  readAt?: string;
}

export interface NotificationQueryParams {
  page?: number;
  limit?: number;
  status?: NotificationStatus;
  type?: NotificationType;
  unreadOnly?: boolean;
}

export interface PaginatedNotifications {
  notifications: Notification[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface UnreadCountResponse {
  count: number;
}

export interface MarkReadResponse {
  updated: number;
}

// SSE Event Types
export type SSEEventType =
  | 'notification'
  | 'connected'
  | 'heartbeat'
  | 'error'
  | 'reconnecting'
  | 'disconnected'
  | 'evicted';

export interface SSEEvent {
  type: SSEEventType;
  data?:
    | Notification
    | {
        connectionId?: string;
        timestamp?: string;
        attempt?: number;
        maxAttempts?: number;
        reason?: string;
        message?: string;
      };
}

// Context Types
export interface NotificationsState {
  notifications: Notification[];
  unreadCount: number;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface NotificationsContextType extends NotificationsState {
  markAsRead: (notificationIds: string[]) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (notificationId: string) => Promise<void>;
  refreshNotifications: () => Promise<void>;
  clearError: () => void;
}
