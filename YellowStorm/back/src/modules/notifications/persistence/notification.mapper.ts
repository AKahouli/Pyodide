import type { NotificationRecord } from './notification.store';

/** Wire shape identical to the Mongo schema's toJSON (plan 1B.1.3): nested
 * metadata rebuilt from flat columns, internal fields (retryCount/lastError)
 * never serialize. Date fields serialize to ISO when the object is
 * stringified — same as the schema transform did. */
export interface NotificationWire {
  id: string;
  userId?: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  actions: NotificationRecord['actions'];
  destination: string;
  status: string;
  metadata: {
    sourceModule: string;
    priority: string;
    expiresAt?: Date;
    extra?: Record<string, unknown>;
  };
  createdAt: Date;
  updatedAt: Date;
  sentAt?: Date;
  readAt?: Date;
}

export function toNotificationWire(record: NotificationRecord): NotificationWire {
  return {
    id: record.id,
    ...(record.userId !== null && { userId: record.userId }),
    type: record.type,
    title: record.title,
    message: record.message,
    ...(record.data !== null && { data: record.data }),
    actions: record.actions,
    destination: record.destination,
    status: record.status,
    metadata: {
      sourceModule: record.sourceModule,
      priority: record.priority,
      ...(record.expiresAt !== null && { expiresAt: record.expiresAt }),
      ...(record.extra !== null && { extra: record.extra }),
    },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.sentAt !== null && { sentAt: record.sentAt }),
    ...(record.readAt !== null && { readAt: record.readAt }),
  };
}
