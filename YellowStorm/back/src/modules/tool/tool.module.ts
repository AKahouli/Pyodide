import { Module } from '@nestjs/common';
import { ToolController } from './tool.controller';
import { ToolCategoryController } from './tool-category.controller';
import { UserToolController } from './user-tool.controller';
import { ToolService } from './tool.service';
import { ToolCategoryService } from './tool-category.service';
import { PgToolStore, PgToolCategoryStore } from './persistence/pg-tool.store';
import { AuthorizationModule } from '../authorization/authorization.module';

@Module({
  imports: [
    AuthorizationModule,
  ],
  controllers: [ToolController, ToolCategoryController, UserToolController],
  providers: [
    // Tools cutover (plan 1B.4.1): catalog.tools / catalog.tool_categories.
    PgToolStore,
    PgToolCategoryStore,
    ToolService,
    ToolCategoryService,
  ],
  exports: [ToolService, ToolCategoryService],
})
export class ToolModule {}
