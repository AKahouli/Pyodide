import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentTypeController } from './agent-type.controller';
import { AdminAgentTypeController } from './admin-agent-type.controller';
import { AgentTypeService } from './agent-type.service';
import { AgentType, AgentTypeSchema } from './schemas/agent-type.schema';
import { AgentTypePrompt, AgentTypePromptSchema } from './schemas/agent-type-prompt.schema';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AgentModule } from '../agent/agent.module';
import { SkillModule } from '../skill/skill.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AgentType.name, schema: AgentTypeSchema },
      { name: AgentTypePrompt.name, schema: AgentTypePromptSchema },
    ]),
    AuthorizationModule,
    SkillModule,
    forwardRef(() => AgentModule),
  ],
  controllers: [AgentTypeController, AdminAgentTypeController],
  providers: [AgentTypeService],
  exports: [AgentTypeService],
})
export class AgentTypeModule {}
