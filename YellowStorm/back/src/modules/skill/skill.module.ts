import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SkillService } from './skill.service';
import { Skill, SkillSchema } from './schemas/skill.schema';
import { SkillController } from './skill.controller';
import { Agent, AgentSchema } from '../agent/schemas/agent.schema';
import { AgentType, AgentTypeSchema } from '../agent-type/schemas/agent-type.schema';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AdminSkillController } from './admin-skill.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Skill.name, schema: SkillSchema },
      { name: Agent.name, schema: AgentSchema },
      { name: AgentType.name, schema: AgentTypeSchema },
    ]),
    AuthorizationModule,
  ],
  controllers: [SkillController, AdminSkillController],
  providers: [SkillService],
  exports: [SkillService],
})
export class SkillModule {}
