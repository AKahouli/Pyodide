import { Module, forwardRef } from '@nestjs/common';
import { AgentTypeController } from './agent-type.controller';
import { AdminAgentTypeController } from './admin-agent-type.controller';
import { AgentTypeService } from './agent-type.service';
import { PgAgentTypeStore } from './persistence/pg-agent-type.store';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AgentModule } from '../agent/agent.module';
import { SkillModule } from '../skill/skill.module';

@Module({
  imports: [
    AuthorizationModule,
    SkillModule,
    forwardRef(() => AgentModule),
  ],
  controllers: [AgentTypeController, AdminAgentTypeController],
  providers: [
    // Agent types cutover (plan 1B.4.3): catalog.agent_types (+skills junction, prompts).
    PgAgentTypeStore,
    AgentTypeService,
  ],
  exports: [AgentTypeService],
})
export class AgentTypeModule {}
