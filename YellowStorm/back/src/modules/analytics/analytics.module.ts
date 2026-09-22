import { Module, forwardRef } from '@nestjs/common';
import { LoggerModule } from '@modules/logger';
import { UsageModule } from '@modules/usage/usage.module';
import { ConversationPersistenceModule } from '@modules/conversation/persistence/conversation-persistence.module';
import { UserModule } from '@modules/user/user.module';
import { AnalyticsController } from './controllers';
import {
  AnalyticsService,
  UserAnalyticsService,
  UsageAnalyticsService,
  ConversationAnalyticsService,
} from './services';
import { AuthorizationModule } from '../authorization/authorization.module';

@Module({
  imports: [
    UserModule,
    LoggerModule,
    forwardRef(() => AuthorizationModule),
    UsageModule,
    ConversationPersistenceModule,
  ],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    UserAnalyticsService,
    UsageAnalyticsService,
    ConversationAnalyticsService,
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
