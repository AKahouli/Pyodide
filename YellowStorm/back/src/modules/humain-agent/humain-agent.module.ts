import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HumainAgentService } from './humain-agent.service';
import { AgentType, AgentTypeSchema } from '../agent-type/schemas/agent-type.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AgentType.name, schema: AgentTypeSchema },
    ]),
  ],
  providers: [HumainAgentService],
  exports: [HumainAgentService],
})
export class HumainAgentModule {}
