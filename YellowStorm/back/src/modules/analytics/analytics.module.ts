import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LoggerModule } from '@modules/logger';
import { User, UserSchema } from '@modules/user/schemas/user.schema';
import { UsageLog, UsageLogSchema } from '@modules/usage/schemas/usage-log.schema';
import {
  Conversation,
  ConversationSchema,
} from '@modules/conversation/schemas/conversation.schema';
import {
  Message,
  MessageSchema,
} from '@modules/conversation/schemas/message.schema';
import { Report, ReportSchema } from '@modules/conversation/schemas/report.schema';
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
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: UsageLog.name, schema: UsageLogSchema },
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
      { name: Report.name, schema: ReportSchema },
    ]),
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
