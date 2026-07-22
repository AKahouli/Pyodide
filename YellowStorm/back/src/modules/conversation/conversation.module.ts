import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

// Schemas
import { Conversation, ConversationSchema } from './schemas/conversation.schema';
import { Message, MessageSchema } from './schemas/message.schema';
import { Report, ReportSchema } from './schemas/report.schema';
import { SharedConversation, SharedConversationSchema } from './schemas/shared-conversation.schema';
import { User, UserSchema } from '../user/schemas/user.schema';

// Controllers
import { ConversationController } from './controllers/conversation.controller';
import { MessageController } from './controllers/message.controller';
import { StreamController } from './controllers/stream.controller';
import { ShareController } from './controllers/share.controller';
import { ReportController } from './controllers/report.controller';
import { ConversationFileController } from './controllers/conversation-file.controller';
import { ComposerSuggestionsController } from './controllers/composer-suggestions.controller';

// Services
import { ConversationService } from './services/conversation.service';
import { MessageService } from './services/message.service';
import { StreamService } from './services/stream.service';
import { StreamGatewayService } from './services/stream-gateway.service';
import { ShareService } from './services/share.service';
import { ReportService } from './services/report.service';
import { ComposerSuggestionsService } from './services/composer-suggestions.service';
import { ChoiceInteractionService } from './services/choice-interaction.service';

// Guards
import { ConversationOwnerGuard } from './guards/conversation-owner.guard';
import { SseAuthGuard } from './guards/stream-auth.guard';
import { ComposerSuggestionsRateLimitGuard } from './guards/composer-suggestions-rate-limit.guard';

// External modules
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ModelsModule } from '../models/models.module';
import { LoggerModule } from '../logger';
import { UsageModule } from '../usage';
import { AgentModule } from '../agent/agent.module';
import { TeamModule } from '../team/team.module';
import { AgentTypeModule } from '../agent-type/agent-type.module';
import { SkillModule } from '../skill/skill.module';
import { EmailModule } from '../email/email.module';
import conversationConfig from '../../config/conversation.config';
import { GovernanceRuntimeModule } from '../governance/governance-runtime.module';

@Module({
  imports: [
    ConfigModule.forFeature(conversationConfig),
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
      { name: Report.name, schema: ReportSchema },
      { name: SharedConversation.name, schema: SharedConversationSchema },
      { name: User.name, schema: UserSchema },
    ]),
    JwtModule.register({}),
    forwardRef(() => AuthModule),
    forwardRef(() => AuthorizationModule),
    forwardRef(() => WorkspaceModule),
    ModelsModule,
    LoggerModule,
    UsageModule,
    forwardRef(() => AgentModule),
    TeamModule,
    AgentTypeModule,
    SkillModule,
    EmailModule,
    GovernanceRuntimeModule,
  ],
  controllers: [
    StreamController,  // Must be before ConversationController to avoid route conflict with :id param
    ComposerSuggestionsController,
    ConversationController,
    MessageController,
    ShareController,
    ReportController,
    ConversationFileController,
  ],
  providers: [
    ConversationService,
    MessageService,
    StreamService,
    StreamGatewayService,
    ShareService,
    ReportService,
    ComposerSuggestionsService,
    ChoiceInteractionService,
    ConversationOwnerGuard,
    SseAuthGuard,
    ComposerSuggestionsRateLimitGuard,
  ],
  exports: [
    ConversationService,
    MessageService,
    StreamService,
    StreamGatewayService,
  ],
})
export class ConversationModule {}
