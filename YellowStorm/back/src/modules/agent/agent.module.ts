import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { AgentController } from './controllers/agent.controller';
import { AdminAgentController } from './controllers/admin-agent.controller';
import { AgentService } from './agent.service';
import { Agent, AgentSchema } from './schemas/agent.schema';
import { AgentTypeModule } from '../agent-type/agent-type.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { ToolModule } from '../tool/tool.module';
import { ModelsModule } from '../models/models.module';
import { SkillModule } from '../skill/skill.module';
import { ConnectorModule } from '../connector/connector.module';
import { ConnectedAppModule } from '../connected-app/connected-app.module';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Agent.name, schema: AgentSchema },
    ]),
    AgentTypeModule,
    AuthorizationModule,
    ToolModule,
    ModelsModule,
    SkillModule,
    ConnectorModule,
    ConnectedAppModule,
  ],
  controllers: [AgentController, AdminAgentController],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
