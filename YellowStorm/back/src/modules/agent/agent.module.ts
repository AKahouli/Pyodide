import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { AgentController } from './controllers/agent.controller';
import { AdminAgentController } from './controllers/admin-agent.controller';
import { AgentA2AController } from './controllers/agent-a2a.controller';
import { AgentShareController } from './controllers/agent-share.controller';
import { AgentService } from './agent.service';
import { AgentShareService } from './services/agent-share.service';
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

@Module({
  imports: [
    ConfigModule,
    ConfigModule.forFeature(a2aAdminConfig),
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
  ],
  controllers: [AgentController, AdminAgentController, AgentA2AController, AgentShareController],
  providers: [AgentService, AgentShareService, AgentPermissionGuard, A2AAdminGrpcClientService, A2APublishService],
  exports: [
    AgentService,
    AgentShareService,
    AgentPermissionGuard,
    A2AAdminGrpcClientService,
    A2APublishService,
  ],
})
export class AgentModule {}
