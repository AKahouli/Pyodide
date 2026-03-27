import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MessageEvent } from '@nestjs/common';
import { Subject, Observable, BehaviorSubject, takeUntil } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger';
import { NotificationDocument } from './schemas/notification.schema';
import { SSEConnection, SSEConnectionStats } from './interfaces/notification.interface';

interface InternalSSEConnection extends SSEConnection {
  subject: Subject<MessageEvent>;
  disconnect$: Subject<void>;
  checkAlive: () => boolean;
}

/**
 * Gateway for managing SSE connections
 * Handles connection tracking, broadcasting, and cleanup
 */
@Injectable()
export class NotificationsGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger: LoggerService;
  private readonly connections = new Map<string, InternalSSEConnection>();
  private readonly userConnections = new Map<string, Set<string>>();
  private readonly connectionStats = new BehaviorSubject<SSEConnectionStats>({
    total: 0,
    byUser: 0,
  });
  private readonly maxConnectionsPerUser: number;
  private readonly staleCheckIntervalMs: number;
  private staleCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    loggerService: LoggerService,
    private readonly configService: ConfigService,
  ) {
    this.logger = loggerService;
    this.logger.setContext('NotificationsGateway');
    this.maxConnectionsPerUser = this.configService.get<number>(
      'notifications.maxConnectionsPerUser',
      10,
    );
    this.staleCheckIntervalMs = this.configService.get<number>(
      'notifications.staleCheckIntervalMs',
      30000,
    );
  }

  onModuleInit() {
    this.staleCheckInterval = setInterval(() => {
      this.sweepStaleConnections();
    }, this.staleCheckIntervalMs);
  }

  onModuleDestroy() {
    if (this.staleCheckInterval) {
      clearInterval(this.staleCheckInterval);
      this.staleCheckInterval = null;
    }

    // Close all connections
    for (const connection of this.connections.values()) {
      connection.disconnect$.next();
      connection.disconnect$.complete();
      connection.subject.complete();
    }

    this.connections.clear();
    this.userConnections.clear();
    this.logger.log('NotificationsGateway destroyed, all connections closed');
  }

  /**
   * Register a new SSE connection
   * @returns Observable for the connection, or null if connection limit exceeded
   */
  registerConnection(
    userId: string,
    connectionId: string,
    disconnect$: Subject<void>,
    checkAlive: () => boolean = () => true,
  ): Observable<MessageEvent> | null {
    // Check connection limit per user
    const userConns = this.userConnections.get(userId) || new Set();
    if (userConns.size >= this.maxConnectionsPerUser) {
      this.logger.warn('Connection limit exceeded, refusing new connection', {
        userId,
        currentConnections: userConns.size,
        maxConnections: this.maxConnectionsPerUser,
      });
      return null;
    }

    const subject = new Subject<MessageEvent>();

    const connection: InternalSSEConnection = {
      connectionId,
      userId,
      subject,
      disconnect$,
      checkAlive,
      connectedAt: new Date(),
      lastActivity: new Date(),
    };

    this.connections.set(connectionId, connection);

    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    this.userConnections.get(userId)!.add(connectionId);

    this.updateStats();
    this.logger.debug('Connection registered', {
      userId,
      connectionId,
      totalConnections: this.connections.size,
    });

    return subject.asObservable().pipe(takeUntil(disconnect$));
  }

  /**
   * Remove a connection
   */
  removeConnection(userId: string, connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.subject.complete();
      connection.disconnect$.next();
      connection.disconnect$.complete();
    }

    this.connections.delete(connectionId);

    const userConns = this.userConnections.get(userId);
    if (userConns) {
      userConns.delete(connectionId);
      if (userConns.size === 0) {
        this.userConnections.delete(userId);
      }
    }

    this.updateStats();
    this.logger.debug('Connection removed', {
      userId,
      connectionId,
      remainingConnections: this.connections.size,
    });
  }

  /**
   * Send notification to a specific user
   * @returns true if at least one connection received the message
   */
  async sendToUser(
    userId: string,
    notification: NotificationDocument,
  ): Promise<boolean> {
    const userConns = this.userConnections.get(userId);
    if (!userConns || userConns.size === 0) {
      this.logger.debug('No active connections for user', { userId });
      return false;
    }

    const message: MessageEvent = {
      type: 'notification',
      data: JSON.stringify(notification.toJSON()),
    };

    let sentCount = 0;
    const failedConnections: string[] = [];

    for (const connId of userConns) {
      const connection = this.connections.get(connId);
      if (connection) {
        try {
          connection.subject.next(message);
          connection.lastActivity = new Date();
          sentCount++;
        } catch (error) {
          this.logger.error('Failed to send to connection', {
            connectionId: connId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          failedConnections.push(connId);
        }
      }
    }

    // Clean up failed connections
    for (const connId of failedConnections) {
      this.removeConnection(userId, connId);
    }

    this.logger.debug('Notification sent to user', {
      userId,
      sentCount,
      notificationId: notification._id,
    });
    return sentCount > 0;
  }

  /**
   * Broadcast notification to all connected users
   */
  async broadcast(notification: NotificationDocument): Promise<void> {
    const message: MessageEvent = {
      type: 'notification',
      data: JSON.stringify(notification.toJSON()),
    };

    let sentCount = 0;
    const failedConnections: Array<{ userId: string; connectionId: string }> = [];

    for (const connection of this.connections.values()) {
      try {
        connection.subject.next(message);
        connection.lastActivity = new Date();
        sentCount++;
      } catch (error) {
        failedConnections.push({
          userId: connection.userId,
          connectionId: connection.connectionId,
        });
      }
    }

    // Clean up failed connections
    for (const { userId, connectionId } of failedConnections) {
      this.removeConnection(userId, connectionId);
    }

    this.logger.log('Broadcast notification sent', {
      notificationId: notification._id,
      sentCount,
      failedCount: failedConnections.length,
    });
  }

  /**
   * Check if user has active connections
   */
  isUserConnected(userId: string): boolean {
    const userConns = this.userConnections.get(userId);
    return !!userConns && userConns.size > 0;
  }

  /**
   * Get connection statistics
   */
  getStats(): SSEConnectionStats {
    return this.connectionStats.getValue();
  }

  /**
   * Get active connection count for a user
   */
  getUserConnectionCount(userId: string): number {
    return this.userConnections.get(userId)?.size || 0;
  }

  /**
   * Update last activity timestamp for a connection
   */
  updateActivity(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.lastActivity = new Date();
    }
  }

  private sweepStaleConnections(): void {
    const staleConnections: Array<{ userId: string; connectionId: string }> = [];

    for (const connection of this.connections.values()) {
      if (!connection.checkAlive()) {
        staleConnections.push({
          userId: connection.userId,
          connectionId: connection.connectionId,
        });
      }
    }

    if (staleConnections.length > 0) {
      this.logger.log('Sweeping stale connections', {
        count: staleConnections.length,
      });

      for (const { userId, connectionId } of staleConnections) {
        this.removeConnection(userId, connectionId);
      }
    }
  }

  private updateStats(): void {
    this.connectionStats.next({
      total: this.connections.size,
      byUser: this.userConnections.size,
    });
  }
}
