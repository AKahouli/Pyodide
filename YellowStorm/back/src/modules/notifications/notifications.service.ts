import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import {
  Notification,
  NotificationDocument,
  NotificationStatus,
  NotificationType,
  NotificationPriority,
} from './schemas/notification.schema';
import { NotificationsGateway } from './notifications.gateway';
import {
  CreateNotificationData,
  InternalNotificationData,
  NotificationQueryParams,
  PaginatedNotifications,
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
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
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
  ): Promise<NotificationDocument> {
    const doc = await this.create({
      ...notification,
      userId,
      destination: userId,
    });

    if (!options?.skipPush) {
      await this.pushToUser(userId, doc);
    }

    return doc;
  }

  /**
   * Broadcast notification to all connected users
   */
  async broadcast(
    notification: InternalNotificationData,
    options?: SendNotificationOptions,
  ): Promise<NotificationDocument> {
    const doc = await this.create({
      ...notification,
      destination: 'broadcast',
    });

    if (!options?.skipPush) {
      await this.pushBroadcast(doc);
    }

    return doc;
  }

  /**
   * Send notification using destination routing
   */
  async send(
    dto: CreateNotificationData,
    options?: SendNotificationOptions,
  ): Promise<NotificationDocument> {
    const doc = await this.create(dto);

    if (!options?.skipPush) {
      if (dto.destination === 'broadcast') {
        await this.pushBroadcast(doc);
      } else if (dto.destination.startsWith('role:')) {
        this.logger.warn('Role-based notifications not yet implemented', {
          destination: dto.destination,
        });
      } else {
        await this.pushToUser(dto.destination, doc);
      }
    }

    return doc;
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

    const filter: Record<string, unknown> = {
      $or: [
        { userId: new Types.ObjectId(userId) },
        { destination: 'broadcast' },
      ],
    };

    if (status) {
      filter.status = status;
    }

    if (type) {
      filter.type = type;
    }

    if (unreadOnly) {
      filter.status = { $ne: NotificationStatus.READ };
    }

    const [notifications, total] = await Promise.all([
      this.notificationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.notificationModel.countDocuments(filter).exec(),
    ]);

    return {
      notifications: notifications.map((n) => ({
        id: n._id.toString(),
        userId: n.userId?.toString(),
        type: n.type,
        title: n.title,
        message: n.message,
        data: n.data,
        actions: n.actions,
        destination: n.destination,
        status: n.status,
        metadata: n.metadata,
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
        sentAt: n.sentAt?.toISOString(),
        readAt: n.readAt?.toISOString(),
      })),
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
  async getUnread(userId: string): Promise<NotificationDocument[]> {
    return this.notificationModel
      .find({
        $or: [
          { userId: new Types.ObjectId(userId) },
          { destination: 'broadcast' },
        ],
        status: { $ne: NotificationStatus.READ },
      })
      .sort({ createdAt: -1 })
      .limit(50)
      .exec();
  }

  /**
   * Get unread count
   */
  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationModel
      .countDocuments({
        $or: [
          { userId: new Types.ObjectId(userId) },
          { destination: 'broadcast' },
        ],
        status: { $ne: NotificationStatus.READ },
      })
      .exec();
  }

  /**
   * Mark notifications as read
   */
  async markAsRead(
    userId: string,
    dto: MarkReadDto,
  ): Promise<{ updated: number }> {
    const { notificationIds } = dto;

    const result = await this.notificationModel
      .updateMany(
        {
          _id: {
            $in: notificationIds.map((id) => new Types.ObjectId(id)),
          },
          $or: [
            { userId: new Types.ObjectId(userId) },
            { destination: 'broadcast' },
          ],
        },
        {
          $set: {
            status: NotificationStatus.READ,
            readAt: new Date(),
          },
        },
      )
      .exec();

    return { updated: result.modifiedCount };
  }

  /**
   * Mark all as read for user
   */
  async markAllAsRead(userId: string): Promise<{ updated: number }> {
    const result = await this.notificationModel
      .updateMany(
        {
          $or: [
            { userId: new Types.ObjectId(userId) },
            { destination: 'broadcast' },
          ],
          status: { $ne: NotificationStatus.READ },
        },
        {
          $set: {
            status: NotificationStatus.READ,
            readAt: new Date(),
          },
        },
      )
      .exec();

    return { updated: result.modifiedCount };
  }

  /**
   * Delete notification
   */
  async deleteNotification(
    notificationId: string,
    userId: string,
  ): Promise<void> {
    const notification = await this.notificationModel
      .findById(notificationId)
      .exec();

    if (!notification) {
      throw new NotFoundException(
        ErrorCode.NOTIFICATION_NOT_FOUND,
        'Notification not found',
      );
    }

    // Check ownership
    if (
      notification.userId?.toString() !== userId &&
      notification.destination !== 'broadcast'
    ) {
      throw new ForbiddenException(
        ErrorCode.NOTIFICATION_FORBIDDEN,
        'Cannot delete this notification',
      );
    }

    await this.notificationModel.deleteOne({ _id: notificationId }).exec();
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
  ): Promise<NotificationDocument> {
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

    const notification = new this.notificationModel({
      userId: dto.userId ? new Types.ObjectId(dto.userId) : undefined,
      type: dto.type,
      title: sanitizedTitle,
      message: sanitizedMessage,
      data: dto.data,
      actions: dto.actions,
      destination: dto.destination,
      status: NotificationStatus.PENDING,
      metadata: {
        sourceModule: dto.metadata?.sourceModule || 'system',
        priority: dto.metadata?.priority || NotificationPriority.NORMAL,
        expiresAt,
        extra: dto.metadata?.extra,
      },
    });

    const saved = await notification.save();
    this.logger.debug('Notification created', {
      id: saved._id,
      destination: dto.destination,
    });
    return saved;
  }

  private async pushToUser(
    userId: string,
    notification: NotificationDocument,
  ): Promise<void> {
    try {
      const sent = await this.gateway.sendToUser(userId, notification);

      if (sent) {
        await this.notificationModel
          .updateOne(
            { _id: notification._id },
            { $set: { status: NotificationStatus.SENT, sentAt: new Date() } },
          )
          .exec();
      }
    } catch (error) {
      this.logger.error('Failed to push notification', {
        notificationId: notification._id,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      await this.notificationModel
        .updateOne(
          { _id: notification._id },
          {
            $set: {
              status: NotificationStatus.FAILED,
              lastError: String(error),
            },
            $inc: { retryCount: 1 },
          },
        )
        .exec();
    }
  }

  private async pushBroadcast(
    notification: NotificationDocument,
  ): Promise<void> {
    try {
      await this.gateway.broadcast(notification);

      await this.notificationModel
        .updateOne(
          { _id: notification._id },
          { $set: { status: NotificationStatus.SENT, sentAt: new Date() } },
        )
        .exec();
    } catch (error) {
      this.logger.error('Failed to broadcast notification', {
        notificationId: notification._id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
