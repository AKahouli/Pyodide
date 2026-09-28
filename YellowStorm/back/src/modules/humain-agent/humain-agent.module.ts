import { Module } from '@nestjs/common';
import { HumainAgentService } from './humain-agent.service';
import { PgAgentTypeStore } from '../agent-type/persistence/pg-agent-type.store';

@Module({
  providers: [
    // Direct store provider (plan 1B.4.4): humain-agent resolves the 'humain'
    // type without importing the agent-type service subtree.
    PgAgentTypeStore,
    HumainAgentService,
  ],
  exports: [HumainAgentService],
})
export class HumainAgentModule {}
