import { Module, forwardRef } from '@nestjs/common';
import { PgAgentShareStore } from './persistence/pg-agent-share.store';
import { ConfigModule } from '@nestjs/config';
import { AgentController } from './controllers/agent.controller';
import { PublicAgentController } from './controllers/public-agent.controller';
import { AdminAgentController } from './controllers/admin-agent.controller';
import { AgentA2AController } from './controllers/agent-a2a.controller';
import { AgentShareController } from './controllers/agent-share.controller';
import { AgentCrudInternalController } from './controllers/agent-crud-internal.controller';
import { AgentService } from './agent.service';
import { RootPolicyService } from './services/root-policy.service';
import { RootDelegateResolverService } from './services/root-delegate-resolver.service';
import { AgentShareService } from './services/agent-share.service';
import { AgentConnectorRuntimeService } from './services/agent-connector-runtime.service';
import { AgentPermissionGuard } from './guards/agent-permission.guard';
import { A2AAdminGrpcClientService } from './services/a2a-admin.grpc-client.service';
import { A2APublishService } from './services/a2a-publish.service';
import a2aAdminConfig from '@config/a2a-admin.config';
import { AgentTypeModule } from '../agent-type/agent-type.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { ToolModule } from '../tool/tool.module';
import { ModelsModule } from '../models/models.module';
import { SkillModule } from '../skill/skill.module';
import { ConnectorModule } from '../connector/connector.module';
import { ConnectedAppModule } from '../connected-app/connected-app.module';
import { AuthModule } from '../auth/auth.module';
import { TeamModule } from '../team/team.module';
import { UserModule } from '../user/user.module';
import { GuardrailsModule } from '../guardrails/guardrails.module';
import { ConversationModule } from '../conversation/conversation.module';
import { AgentTaskExecutionService } from './services/agent-task-execution.service';
import { AGENT_TASK_EXECUTION } from './agent-task-execution.token';
import { UsageModule } from '../usage/usage.module';
import { AgentRepositoryModule } from './repositories/agent-repository.module';
import { CHANNEL_TEARDOWN, type ChannelTeardown } from '../channels-teardown/channels-teardown.token';
import { TelegramChannelTeardown } from '../channels-teardown/telegram-channel-teardown';
import { WidgetChannelTeardown } from '../channels-teardown/widget-channel-teardown';
import { CryptoService } from '@common/services/crypto.service';
import { TelegramApiService } from '../telegram/services/telegram-api.service';
import { TELEGRAM_INTEGRATION_STORE } from '../telegram/persistence/telegram.store';
import { PgTelegramIntegrationStore } from '../telegram/persistence/pg-telegram.store';
import { PgWidgetTokenStore } from '../widget-chat/persistence/pg-widget.store';

@Module({
  imports: [
    ConfigModule,
    ConfigModule.forFeature(a2aAdminConfig),
    AgentTypeModule,
    AuthorizationModule,
    ToolModule,
    ModelsModule,
    SkillModule,
    ConnectorModule,
    ConnectedAppModule,
    AuthModule,
    forwardRef(() => TeamModule),
    UserModule,
    GuardrailsModule,
    forwardRef(() => ConversationModule),
    forwardRef(() => UsageModule),
    AgentRepositoryModule,
  ],
  controllers: [AgentController, PublicAgentController, AdminAgentController, AgentA2AController, AgentShareController, AgentCrudInternalController],
  providers: [
    // Shares cutover (plan 4.1); exported for the telegram/widget guards.
    PgAgentShareStore,
    // Channel teardown (plan 4.6). The adapters live here, not in the channel
    // modules, because those import AgentModule (a reverse import would cycle).
    CryptoService,
    TelegramApiService,
    { provide: TELEGRAM_INTEGRATION_STORE, useClass: PgTelegramIntegrationStore },
    PgWidgetTokenStore,
    TelegramChannelTeardown,
    WidgetChannelTeardown,
    {
      provide: CHANNEL_TEARDOWN,
      useFactory: (...teardowns: ChannelTeardown[]) => teardowns,
      inject: [TelegramChannelTeardown, WidgetChannelTeardown],
    },
    AgentService,
    RootPolicyService,
    RootDelegateResolverService,
    AgentShareService,
    AgentConnectorRuntimeService,
    AgentPermissionGuard,
    A2AAdminGrpcClientService,
    A2APublishService,
    AgentTaskExecutionService,
    { provide: AGENT_TASK_EXECUTION, useExisting: AgentTaskExecutionService },
  ],
  exports: [AgentService, RootPolicyService, RootDelegateResolverService, AgentShareService, AgentConnectorRuntimeService, AgentPermissionGuard, PgAgentShareStore, A2AAdminGrpcClientService, A2APublishService, AgentTaskExecutionService, AGENT_TASK_EXECUTION],
})
export class AgentModule {}
