import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { AgentController } from './controllers/agent.controller';
import { PublicAgentController } from './controllers/public-agent.controller';
import { AdminAgentController } from './controllers/admin-agent.controller';
import { AgentA2AController } from './controllers/agent-a2a.controller';
import { AgentShareController } from './controllers/agent-share.controller';
import { AgentService } from './agent.service';
import { AgentShareService } from './services/agent-share.service';
import { AgentConnectorRuntimeService } from './services/agent-connector-runtime.service';
import { AgentPermissionGuard } from './guards/agent-permission.guard';
import { A2AAdminGrpcClientService } from './services/a2a-admin.grpc-client.service';
import { A2APublishService } from './services/a2a-publish.service';
import { Agent, AgentSchema } from './schemas/agent.schema';
import { SharedAgent, SharedAgentSchema } from './schemas/shared-agent.schema';
import a2aAdminConfig from '@config/a2a-admin.config';
import { AgentTypeModule } from '../agent-type/agent-type.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { ToolModule } from '../tool/tool.module';
import { ModelsModule } from '../models/models.module';
import { SkillModule } from '../skill/skill.module';
import { ConnectorModule } from '../connector/connector.module';
import { ConnectedAppModule } from '../connected-app/connected-app.module';
import { TeamModule } from '../team/team.module';
import { UserModule } from '../user/user.module';
import { GuardrailsModule } from '../guardrails/guardrails.module';
import { ConversationModule } from '../conversation/conversation.module';
import { AgentTaskExecutionService } from './services/agent-task-execution.service';
import { UsageModule } from '../usage/usage.module';
import playbookFlowConfig from '@config/playbook-flow.config';
import { PlaybookAssistantConnectorReconcilerService } from './services/playbook-assistant-connector-reconciler.service';

@Module({
  imports: [
    ConfigModule,
    ConfigModule.forFeature(a2aAdminConfig),
    ConfigModule.forFeature(playbookFlowConfig),
    MongooseModule.forFeature([
      { name: Agent.name, schema: AgentSchema },
      { name: SharedAgent.name, schema: SharedAgentSchema },
    ]),
    AgentTypeModule,
    AuthorizationModule,
    ToolModule,
    ModelsModule,
    SkillModule,
    ConnectorModule,
    ConnectedAppModule,
    forwardRef(() => TeamModule),
    UserModule,
    GuardrailsModule,
    forwardRef(() => ConversationModule),
    forwardRef(() => UsageModule),
  ],
  controllers: [AgentController, PublicAgentController, AdminAgentController, AgentA2AController, AgentShareController],
  providers: [AgentService, AgentShareService, AgentPermissionGuard, A2AAdminGrpcClientService, A2APublishService, AgentTaskExecutionService, PlaybookAssistantConnectorReconcilerService],
  exports: [
    AgentService,
    AgentShareService,
    AgentConnectorRuntimeService,
    AgentPermissionGuard,
    A2AAdminGrpcClientService,
    A2APublishService,
    AgentTaskExecutionService,
  ],
})
export class AgentModule {}
