import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationPriority, NotificationStatus, NotificationType } from './notification.types';
import { NOTIFICATION_STORE, type NotificationRecord, type NotificationStore } from './persistence/notification.store';
import { toNotificationWire, type NotificationWire } from './persistence/notification.mapper';
import { NotificationsGateway } from './notifications.gateway';
import {
  CreateNotificationData,
  InternalNotificationData,
  NotificationQueryParams,
  PaginatedNotifications,
  NotificationResponse,
} from './interfaces/notification.interface';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import { LoggerService } from '../logger';
import { NotFoundException, ForbiddenException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { sanitizeHtml, validatePayloadSize } from './utils/sanitize';
import { BadRequestException } from '../exceptions';

export interface SendNotificationOptions {
  skipPush?: boolean;
}

/**
 * Service for managing notifications
 * Used by other modules to send notifications to users
 */
@Injectable()
export class NotificationsService implements OnModuleDestroy {
  private readonly logger: LoggerService;
  private readonly defaultTtlDays: number;
  private readonly maxPayloadSize: number;

  constructor(
    @Inject(NOTIFICATION_STORE) private readonly notificationStore: NotificationStore,
    private readonly gateway: NotificationsGateway,
    private readonly configService: ConfigService,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext('NotificationsService');
    this.defaultTtlDays = this.configService.get<number>(
      'notifications.ttlDays',
      30,
    );
    this.maxPayloadSize = this.configService.get<number>(
      'notifications.maxPayloadSizeBytes',
      10240,
    );
  }

  onModuleDestroy() {
    this.logger.log('NotificationsService shutting down');
  }

  /**
   * Send a notification to a specific user
   * Primary method for other modules to use
   */
  async sendToUser(
    userId: string,
    notification: InternalNotificationData,
    options?: SendNotificationOptions,
  ): Promise<NotificationWire> {
    const record = await this.create({
      ...notification,
      userId,
      destination: userId,
    });

    if (!options?.skipPush) {
      await this.pushToUser(userId, record);
    }

    return toNotificationWire(record);
  }

  /**
   * Broadcast notification to all connected users
   */
  async broadcast(
    notification: InternalNotificationData,
    options?: SendNotificationOptions,
  ): Promise<NotificationWire> {
    const record = await this.create({
      ...notification,
      destination: 'broadcast',
    });

    if (!options?.skipPush) {
      await this.pushBroadcast(record);
    }

    return toNotificationWire(record);
  }

  /**
   * Send notification using destination routing
   */
  async send(
    dto: CreateNotificationData,
    options?: SendNotificationOptions,
  ): Promise<NotificationWire> {
    const record = await this.create(dto);

    if (!options?.skipPush) {
      if (dto.destination === 'broadcast') {
        await this.pushBroadcast(record);
      } else if (dto.destination.startsWith('role:')) {
        this.logger.warn('Role-based notifications not yet implemented', {
          destination: dto.destination,
        });
      } else {
        await this.pushToUser(dto.destination, record);
      }
    }

    return toNotificationWire(record);
  }

  /**
   * Get paginated notifications for a user
   */
  async getUserNotifications(
    userId: string,
    query: NotificationQueryDto,
  ): Promise<PaginatedNotifications> {
    const { page = 1, limit = 20, status, type, unreadOnly } = query;
    const skip = (page - 1) * limit;

    const { records, total } = await this.notificationStore.findForUser(userId, {
      status,
      type,
      unreadOnly: Boolean(unreadOnly),
      skip,
      limit,
    });

    return {
      notifications: records.map((n): NotificationResponse => {
        const wire = toNotificationWire(n);
        return {
          ...wire,
          createdAt: wire.createdAt.toISOString(),
          updatedAt: wire.updatedAt.toISOString(),
          sentAt: wire.sentAt?.toISOString(),
          readAt: wire.readAt?.toISOString(),
          metadata: {
            ...wire.metadata,
            expiresAt: wire.metadata.expiresAt?.toISOString(),
          },
        } as unknown as NotificationResponse;
      }),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get unread notifications for a user
   */
  async getUnread(userId: string): Promise<NotificationWire[]> {
    const records = await this.notificationStore.findUnread(userId);
    return records.map(toNotificationWire);
  }

  /**
   * Get unread count
   */
  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationStore.countUnread(userId);
  }

  /**
   * Mark notifications as read
   */
  async markAsRead(
    userId: string,
    dto: MarkReadDto,
  ): Promise<{ updated: number }> {
    const { notificationIds } = dto;

    const updated = await this.notificationStore.markReadByIdsForUser(userId, notificationIds);
    return { updated };
  }

  /**
   * Mark all as read for user
   */
  async markAllAsRead(userId: string): Promise<{ updated: number }> {
    const updated = await this.notificationStore.markAllReadForUser(userId);
    return { updated };
  }

  /**
   * Delete notification
   */
  async deleteNotification(
    notificationId: string,
    userId: string,
  ): Promise<void> {
    const notification = await this.notificationStore.findById(notificationId);

    if (!notification) {
      throw new NotFoundException(
        ErrorCode.NOTIFICATION_NOT_FOUND,
        'Notification not found',
      );
    }

    // Check ownership
    if (
      notification.userId !== userId &&
      notification.destination !== 'broadcast'
    ) {
      throw new ForbiddenException(
        ErrorCode.NOTIFICATION_FORBIDDEN,
        'Cannot delete this notification',
      );
    }

    await this.notificationStore.deleteById(notificationId);
  }

  /**
   * Check if user is connected to SSE
   */
  isUserConnected(userId: string): boolean {
    return this.gateway.isUserConnected(userId);
  }

  /**
   * Get SSE connection stats
   */
  getConnectionStats() {
    return this.gateway.getStats();
  }

  // ==================== Private Methods ====================

  private async create(
    dto: CreateNotificationData,
  ): Promise<NotificationRecord> {
    // Validate payload size
    if (dto.data && !validatePayloadSize(dto.data, this.maxPayloadSize)) {
      throw new BadRequestException(
        `Notification data exceeds maximum size of ${this.maxPayloadSize} bytes`,
      );
    }

    // Sanitize content
    const sanitizedTitle = sanitizeHtml(dto.title);
    const sanitizedMessage = sanitizeHtml(dto.message);

    // Calculate expiry
    const expiresAt =
      dto.metadata?.expiresAt ||
      new Date(Date.now() + this.defaultTtlDays * 24 * 60 * 60 * 1000);

    const saved = await this.notificationStore.create({
      userId: dto.userId,
      type: dto.type,
      title: sanitizedTitle,
      message: sanitizedMessage,
      data: dto.data,
      actions: dto.actions,
      destination: dto.destination,
      sourceModule: dto.metadata?.sourceModule || 'system',
      priority: dto.metadata?.priority || NotificationPriority.NORMAL,
      expiresAt,
      extra: dto.metadata?.extra,
    });

    this.logger.debug('Notification created', {
      id: saved.id,
      destination: dto.destination,
    });
    return saved;
  }

  private async pushToUser(
    userId: string,
    record: NotificationRecord,
  ): Promise<void> {
    try {
      const sent = await this.gateway.sendToUser(userId, toNotificationWire(record));

      if (sent) {
        await this.notificationStore.markSent(record.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to push notification', {
        notificationId: record.id,
        userId,
        error: message,
      });

      await this.notificationStore.markFailed(record.id, message);
    }
  }

  private async pushBroadcast(
    record: NotificationRecord,
  ): Promise<void> {
    try {
      await this.gateway.broadcast(toNotificationWire(record));

      await this.notificationStore.markSent(record.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to broadcast notification', {
        notificationId: record.id,
        error: message,
      });
      await this.notificationStore.markFailed(record.id, message);
    }
  }
}
