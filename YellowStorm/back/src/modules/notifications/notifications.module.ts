import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { SseAuthGuard } from './guards/sse-auth.guard';
import { AuthModule } from '../auth/auth.module';
import { LoggerModule } from '../logger';
import notificationsConfig from '../../config/notifications.config';
import { NOTIFICATION_STORE } from './persistence/notification.store';
import { PgNotificationStore } from './persistence/pg-notification.store';

@Module({
  imports: [
    ConfigModule.forFeature(notificationsConfig),
    JwtModule.register({}),
    forwardRef(() => AuthModule),
    LoggerModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsGateway,
    SseAuthGuard,
    // Notifications cutover (plan 1B.1): the store runs on ops.notifications;
    // Mongo data was backfilled (expired rows skipped) before this flip.
    { provide: NOTIFICATION_STORE, useClass: PgNotificationStore },
  ],
  exports: [NotificationsService, NotificationsGateway],
})
export class NotificationsModule {}
