/** Flat row shape of ops.notifications (plan 1B.1). */
export type NotificationActions = Array<{ label?: string; url?: string; action?: string }>;

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

export const NOTIFICATION_STORE = Symbol('NOTIFICATION_STORE');

export interface NotificationStore {
  /** Owner-or-broadcast listing with optional status/type/unread filters. */
  findForUser(userId: string, options: NotificationFindOptions): Promise<{ records: NotificationRecord[]; total: number }>;
  findUnread(userId: string, limit?: number): Promise<NotificationRecord[]>;
  countUnread(userId: string): Promise<number>;
  /** Marks the given ids read when owned by the user or broadcast (plan: $or owner/broadcast in one statement). */
  markReadByIdsForUser(userId: string, notificationIds: string[]): Promise<number>;
  markAllReadForUser(userId: string): Promise<number>;
  findById(id: string): Promise<NotificationRecord | null>;
  deleteById(id: string): Promise<void>;
  create(init: NewNotification): Promise<NotificationRecord>;
  markSent(id: string): Promise<void>;
  /** Sets FAILED + lastError and increments retry_count. */
  markFailed(id: string, error: string): Promise<void>;
}
