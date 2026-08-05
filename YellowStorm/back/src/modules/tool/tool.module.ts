import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ToolController } from './tool.controller';
import { ToolCategoryController } from './tool-category.controller';
import { UserToolController } from './user-tool.controller';
import { ToolService } from './tool.service';
import { ToolCategoryService } from './tool-category.service';
import { Tool, ToolSchema } from './schemas/tool.schema';
import { ToolCategory, ToolCategorySchema } from './schemas/tool-category.schema';
import { AuthorizationModule } from '../authorization/authorization.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Tool.name, schema: ToolSchema },
      { name: ToolCategory.name, schema: ToolCategorySchema },
    ]),
    AuthorizationModule,
  ],
  controllers: [ToolController, ToolCategoryController, UserToolController],
  providers: [ToolService, ToolCategoryService],
  exports: [ToolService, ToolCategoryService],
})
export class ToolModule {}
