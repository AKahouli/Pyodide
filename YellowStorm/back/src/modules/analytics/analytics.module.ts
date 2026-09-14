import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LoggerModule } from '@modules/logger';
import { User, UserSchema } from '@modules/user/schemas/user.schema';
import { UsageModule } from '@modules/usage/usage.module';
import { ConversationPersistenceModule } from '@modules/conversation/persistence/conversation-persistence.module';
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
    LoggerModule,
    forwardRef(() => AuthorizationModule),
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
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
