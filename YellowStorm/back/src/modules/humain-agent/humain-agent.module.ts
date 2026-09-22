import { Module } from '@nestjs/common';
import { HumainAgentService } from './humain-agent.service';
import { AGENT_TYPE_STORE } from '../agent-type/persistence/agent-type.store';
import { PgAgentTypeStore } from '../agent-type/persistence/pg-agent-type.store';

@Module({
  providers: [
    // Direct store provider (plan 1B.4.4): humain-agent resolves the 'humain'
    // type without importing the agent-type service subtree.
    { provide: AGENT_TYPE_STORE, useClass: PgAgentTypeStore },
    HumainAgentService,
  ],
  exports: [HumainAgentService],
})
export class HumainAgentModule {}
