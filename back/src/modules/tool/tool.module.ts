import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ToolController } from './tool.controller';
import { UserToolController } from './user-tool.controller';
import { ToolService } from './tool.service';
import { Tool, ToolSchema } from './schemas/tool.schema';
import { Agent, AgentSchema } from '../agent/schemas/agent.schema';
import { AuthorizationModule } from '../authorization/authorization.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Tool.name, schema: ToolSchema },
      { name: Agent.name, schema: AgentSchema },
    ]),
    AuthorizationModule,
  ],
  controllers: [ToolController, UserToolController],
  providers: [ToolService],
  exports: [ToolService],
})
export class ToolModule {}
