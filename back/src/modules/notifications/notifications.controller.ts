import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Sse,
  Req,
  HttpCode,
  HttpStatus,
  MessageEvent,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import {
  Observable,
  interval,
  map,
  merge,
  Subject,
  takeUntil,
  of,
} from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { SseAuth } from './decorators/sse-auth.decorator';
import { UserDocument } from '../user/schemas/user.schema';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import { LoggerService } from '../logger';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

interface RequestWithSseUser extends Request {
  sseUser?: JwtPayload;
}

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  private readonly logger: LoggerService;
  private readonly heartbeatIntervalMs: number;
  private readonly tcpKeepAliveMs: number;

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly configService: ConfigService,
    loggerService: LoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext('NotificationsController');
    this.heartbeatIntervalMs = this.configService.get<number>(
      'notifications.heartbeatIntervalMs',
      15000,
    );
    this.tcpKeepAliveMs = this.configService.get<number>(
      'notifications.tcpKeepAliveMs',
      30000,
    );
  }

  /**
   * SSE Stream Endpoint
   * Uses token from query param for EventSource compatibility
   */
  @Public()
  @SseAuth()
  @Sse('stream')
  @ApiOperation({ summary: 'Subscribe to real-time notifications via SSE' })
  @ApiQuery({
    name: 'token',
    description: 'JWT access token',
    required: true,
  })
  @ApiResponse({ status: 200, description: 'SSE stream established' })
  stream(@Req() req: RequestWithSseUser): Observable<MessageEvent> {
    const userId = req.sseUser!.sub;
    const sessionId = req.sseUser!.sessionId;
    const connectionId = `${userId}:${sessionId}:${Date.now()}`;

    // Enable TCP keep-alive to detect dead connections faster
    req.socket.setKeepAlive(true, this.tcpKeepAliveMs);

    // Create disconnect subject for cleanup
    const disconnect$ = new Subject<void>();

    // Register connection and get notification stream
    const notificationStream$ = this.notificationsGateway.registerConnection(
      userId,
      connectionId,
      disconnect$,
      () => !req.socket.destroyed,
    );

    // If connection limit exceeded, send error and close
    if (notificationStream$ === null) {
      this.logger.warn('SSE connection refused - too many tabs', { userId });

      const error$ = of<MessageEvent>({
        type: 'error',
        data: JSON.stringify({
          code: 'TOO_MANY_TABS',
          message: 'Too many tabs open. Please close some tabs and refresh this page.',
          timestamp: new Date().toISOString(),
        }),
      });

      // Clean up disconnect subject
      setTimeout(() => {
        disconnect$.next();
        disconnect$.complete();
      }, 100);

      return error$;
    }

    this.logger.log('SSE connection established', { userId, connectionId });

    // Heartbeat every configured interval
    const heartbeat$ = interval(this.heartbeatIntervalMs).pipe(
      map(
        (): MessageEvent => ({
          type: 'heartbeat',
          data: JSON.stringify({ timestamp: new Date().toISOString() }),
        }),
      ),
    );

    // Initial connection acknowledgment
    const connected$ = of<MessageEvent>({
      type: 'connected',
      data: JSON.stringify({
        connectionId,
        timestamp: new Date().toISOString(),
      }),
    });

    // Handle client disconnect
    req.on('close', () => {
      this.logger.log('SSE connection closed', { userId, connectionId });
      disconnect$.next();
      disconnect$.complete();
      this.notificationsGateway.removeConnection(userId, connectionId);
    });

    // Handle socket errors (e.g. broken pipe from ungraceful disconnect)
    req.socket.on('error', (err) => {
      this.logger.warn('SSE socket error', { userId, connectionId, error: err.message });
      disconnect$.next();
      disconnect$.complete();
      this.notificationsGateway.removeConnection(userId, connectionId);
    });

    // Merge all streams
    return merge(connected$, heartbeat$, notificationStream$).pipe(
      takeUntil(disconnect$),
    );
  }

  /**
   * Get user's notifications with pagination
   */
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get notifications for current user' })
  async getNotifications(
    @CurrentUser() user: UserDocument,
    @Query() query: NotificationQueryDto,
  ) {
    return this.notificationsService.getUserNotifications(
      user._id.toString(),
      query,
    );
  }

  /**
   * Get unread notification count
   */
  @Get('unread/count')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get unread notification count' })
  async getUnreadCount(@CurrentUser() user: UserDocument) {
    const count = await this.notificationsService.getUnreadCount(
      user._id.toString(),
    );
    return { count };
  }

  /**
   * Mark notification(s) as read
   */
  @Patch('read')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark notifications as read' })
  async markAsRead(
    @CurrentUser() user: UserDocument,
    @Body() dto: MarkReadDto,
  ) {
    return this.notificationsService.markAsRead(user._id.toString(), dto);
  }

  /**
   * Mark all notifications as read
   */
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async markAllAsRead(@CurrentUser() user: UserDocument) {
    return this.notificationsService.markAllAsRead(user._id.toString());
  }

  /**
   * Delete a notification
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a notification' })
  async deleteNotification(
    @Param('id') id: string,
    @CurrentUser() user: UserDocument,
  ) {
    await this.notificationsService.deleteNotification(id, user._id.toString());
    return { message: 'Notification deleted' };
  }

  /**
   * Get connection statistics (for debugging/monitoring)
   */
  @Get('stats')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get SSE connection statistics' })
  async getStats() {
    return this.notificationsService.getConnectionStats();
  }
}
