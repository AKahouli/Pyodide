import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentController } from './controllers/agent.controller';
import { AdminAgentController } from './controllers/admin-agent.controller';
import { AgentService } from './agent.service';
import { Agent, AgentSchema } from './schemas/agent.schema';
import { AgentTypeModule } from '../agent-type/agent-type.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { ToolModule } from '../tool/tool.module';
import { ModelsModule } from '../models/models.module';
import { SkillModule } from '../skill/skill.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Agent.name, schema: AgentSchema },
    ]),
    AgentTypeModule,
    AuthorizationModule,
    ToolModule,
    ModelsModule,
    SkillModule,
  ],
  controllers: [AgentController, AdminAgentController],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
