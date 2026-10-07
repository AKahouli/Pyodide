/** Flat row shape of ops.notifications (plan 1B.1). */
export type NotificationActions = { label?: string; url?: string; action?: string }[];

export interface NotificationRecord {
  id: string;
  userId: string | null;
  type: string;
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  actions: NotificationActions;
  destination: string;
  status: string;
  sourceModule: string;
  priority: string;
  expiresAt: Date | null;
  extra: Record<string, unknown> | null;
  sentAt: Date | null;
  readAt: Date | null;
  retryCount: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewNotification {
  userId?: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  actions?: NotificationActions;
  destination: string;
  sourceModule?: string;
  priority?: string;
  expiresAt: Date;
  extra?: Record<string, unknown>;
}

export interface NotificationFindOptions {
  status?: string;
  type?: string;
  unreadOnly?: boolean;
  skip: number;
  limit: number;
}

