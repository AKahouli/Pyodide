import { NotificationType, NotificationPriority, NotificationStatus } from '../schemas/notification.schema';

export interface NotificationAction {
  label?: string;
  url?: string;
  action?: string;
}

export interface NotificationMetadata {
  sourceModule: string;
  priority?: NotificationPriority;
  expiresAt?: Date;
  extra?: Record<string, unknown>;
}

export interface CreateNotificationData {
  userId?: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  actions?: NotificationAction[];
  destination: string;
  metadata: NotificationMetadata;
}

export interface InternalNotificationData {
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  actions?: NotificationAction[];
  metadata: Omit<NotificationMetadata, 'sourceModule'> & { sourceModule: string };
}

export interface NotificationQueryParams {
  page?: number;
  limit?: number;
  status?: NotificationStatus;
  type?: NotificationType;
  unreadOnly?: boolean;
}

export interface PaginatedNotifications {
  notifications: NotificationResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface NotificationResponse {
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

export interface SSEConnection {
  connectionId: string;
  userId: string;
  connectedAt: Date;
  lastActivity: Date;
}

export interface SSEConnectionStats {
  total: number;
  byUser: number;
}
