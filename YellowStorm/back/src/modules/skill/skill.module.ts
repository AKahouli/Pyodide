import { Module } from '@nestjs/common';
import { SkillService } from './skill.service';
import { SkillCategoryService } from './skill-category.service';
import { SkillController } from './skill.controller';
import { SkillCategoryController } from './skill-category.controller';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AdminSkillController } from './admin-skill.controller';
import { SKILL_STORE } from './persistence/skill.store';
import { PgSkillStore } from './persistence/pg-skill.store';
import { PgSkillCategoryStore } from './persistence/pg-skill.store';

@Module({
  imports: [AuthorizationModule],
  controllers: [SkillController, AdminSkillController, SkillCategoryController],
  providers: [
    // Skills cutover (plan 1B.4.2): catalog.skills / skill_categories / skill_files.
    { provide: SKILL_STORE, useClass: PgSkillStore },
    PgSkillCategoryStore,
    SkillService,
    SkillCategoryService,
  ],
  exports: [SkillService, SkillCategoryService],
})
export class SkillModule {}
