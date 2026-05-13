import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { SseAuthGuard } from './guards/sse-auth.guard';
import { AuthModule } from '../auth/auth.module';
import { LoggerModule } from '../logger';
import notificationsConfig from '../../config/notifications.config';

@Module({
  imports: [
    ConfigModule.forFeature(notificationsConfig),
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
    ]),
    JwtModule.register({}),
    forwardRef(() => AuthModule),
    LoggerModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway, SseAuthGuard],
  exports: [NotificationsService, NotificationsGateway],
})
export class NotificationsModule {}
