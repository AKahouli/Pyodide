import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';

// Configuration
import { configValidationSchema } from './config/config.schema';
import appConfig from './config/app.config';
import jwtConfig from './config/jwt.config';
import authConfig from './config/auth.config';
import microsoftConfig from './config/microsoft.config';
import healthConfig from './config/health.config';
import workspaceConfig from './config/workspace.config';
import litellmConfig from './config/litellm.config';
import conversationConfig from './config/conversation.config';
import conversationV2Config from './config/conversation-v2.config';
import playbookFlowConfig from './config/playbook-flow.config';
import grpcSecurityConfig from './config/grpc-security.config';
import grpcSecurityV2Config from './config/grpc-security-v2.config';
import telegramConfig from './config/telegram.config';
import whatsappConfig from './config/whatsapp.config';
import workyConfig from './config/worky.config';
import memoryCardsConfig from './config/memory-cards.config';
import dataRoomConfig from './config/data-room.config';

// Global Modules
import { LoggerModule } from './modules/logger';
import { ExceptionsModule } from './modules/exceptions';
import { RateLimiterModule } from './modules/rate-limiter';
import { RequestContextModule } from './modules/request-context';
import { ResponseModule } from './modules/response';
import { DatabaseModule } from './modules/database';
import { DocumentModule } from './modules/document';
import { EmailModule } from './modules/email';

// Feature Modules
import { HealthModule } from './modules/health';
import { UserModule } from './modules/user';
import { AuthModule, JwtAuthGuard } from './modules/auth';
import { AuthorizationModule } from './modules/authorization';
import { SystemModule } from './modules/system';
import { UsageModule } from './modules/usage';
import { NotificationsModule } from './modules/notifications';
import { WorkspaceModule } from './modules/workspace';
import { IndexingModule } from './modules/indexing';
import { BrowserSessionModule } from './modules/browser-session/browser-session.module';
import { ModelsModule } from './modules/models';
import { ChatCompletionModule } from './modules/chat-completion/chat-completion.module';
import { ConversationModule } from './modules/conversation';
import { ConversationV2Module } from './modules/conversation-v2/conversation-v2.module';
import { ToolModule } from './modules/tool';
import { AgentTypeModule } from './modules/agent-type/agent-type.module';
import { AgentModule } from './modules/agent/agent.module';
import { TeamModule } from './modules/team/team.module';
import { UserGroupModule } from './modules/user-group';
import { AnalyticsModule } from './modules/analytics';
import { PlaybookFlowModule } from './modules/playbook-flow/playbook-flow.module';
import { EvaluationModule } from './modules/evaluation/evaluation.module';
import { SkillModule } from './modules/skill/skill.module';
import { AuthProviderModule } from './modules/auth-provider/auth-provider.module';
import { ConnectedAppModule } from './modules/connected-app/connected-app.module';
import { ConnectorModule } from './modules/connector/connector.module';
import { ProjectModule } from './modules/project';
import { ClassifierModule } from './modules/classifier';
import { TelegramModule } from './modules/telegram';
import { WidgetChatModule } from './modules/widget-chat/widget-chat.module';
import { WhatsAppModule } from './modules/whatsapp';
import { WorkyModule } from './modules/worky';
import { GuardrailsModule } from './modules/guardrails/guardrails.module';
import { MemoryCardsModule } from './modules/memory-cards/memory-cards.module';
import { GovernanceModule } from './modules/governance';
import { IntegrationEventsModule } from './modules/integration-events/integration-events.module';
import { WorkspaceArtifactModule } from './modules/workspace-artifact/workspace-artifact.module';

@Module({
  imports: [
    // Configuration Module - Global
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      load: [appConfig, jwtConfig, authConfig, microsoftConfig, healthConfig, workspaceConfig, litellmConfig, conversationConfig, conversationV2Config, playbookFlowConfig, grpcSecurityConfig, grpcSecurityV2Config, telegramConfig, whatsappConfig, workyConfig, memoryCardsConfig, dataRoomConfig],
      validationSchema: configValidationSchema,
      validationOptions: {
        abortEarly: true,
      },
    }),

    // Schedule Module for cron jobs
    ScheduleModule.forRoot(),

    // Global Modules
    LoggerModule,
    DatabaseModule,
    DocumentModule,
    EmailModule,
    RequestContextModule,
    ResponseModule,
    ExceptionsModule,
    RateLimiterModule,

    // Feature Modules
    SystemModule, // Must be before other modules for maintenance guard
    UserModule,
    AuthorizationModule, // RBAC system
    AuthModule,
    UsageModule,
    NotificationsModule,
    IntegrationEventsModule,
    WorkspaceModule,
    WorkspaceArtifactModule,
    IndexingModule,
    BrowserSessionModule,
    ConversationModule,
    ConversationV2Module,
    ModelsModule,
    ChatCompletionModule,
    ToolModule,
    SkillModule,
    AgentTypeModule,
    AgentModule,
    TeamModule,
    UserGroupModule,
    PlaybookFlowModule,
    AuthProviderModule,
    AnalyticsModule,
    ConnectedAppModule,
    ConnectorModule,
    TelegramModule,
    WhatsAppModule,
    ProjectModule,
    ClassifierModule,
    HealthModule,
    EvaluationModule,
    WidgetChatModule,
    WorkyModule,
    GuardrailsModule,
    MemoryCardsModule,
    GovernanceModule,
  ],
  providers: [
    // Global JWT Auth Guard - all routes require authentication by default
    // Use @Public() decorator to make a route public
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule { }
