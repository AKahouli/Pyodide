import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HumainAgentService } from './humain-agent.service';
import { Agent, AgentSchema } from '../agent/schemas/agent.schema';
import { AgentType, AgentTypeSchema } from '../agent-type/schemas/agent-type.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Agent.name, schema: AgentSchema },
      { name: AgentType.name, schema: AgentTypeSchema },
    ]),
  ],
  providers: [HumainAgentService],
  exports: [HumainAgentService],
})
export class HumainAgentModule {}
