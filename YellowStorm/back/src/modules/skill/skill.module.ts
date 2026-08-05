import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SkillService } from './skill.service';
import { SkillCategoryService } from './skill-category.service';
import { Skill, SkillSchema } from './schemas/skill.schema';
import { SkillCategory, SkillCategorySchema } from './schemas/skill-category.schema';
import { SkillController } from './skill.controller';
import { SkillCategoryController } from './skill-category.controller';
import { AgentType, AgentTypeSchema } from '../agent-type/schemas/agent-type.schema';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AdminSkillController } from './admin-skill.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Skill.name, schema: SkillSchema },
      { name: SkillCategory.name, schema: SkillCategorySchema },
      { name: AgentType.name, schema: AgentTypeSchema },
    ]),
    AuthorizationModule,
  ],
  controllers: [SkillController, AdminSkillController, SkillCategoryController],
  providers: [SkillService, SkillCategoryService],
  exports: [SkillService, SkillCategoryService],
})
export class SkillModule {}
