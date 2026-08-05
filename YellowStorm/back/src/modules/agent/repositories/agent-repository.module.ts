import { Global, Module } from '@nestjs/common';
import { AgentRepository } from './agent.repository';

// AgentRepository depends only on DRIZZLE_DB (from the global PostgresModule),
// so this module is safe to import anywhere without circular-dependency risk.
@Global()
@Module({
  providers: [AgentRepository],
  exports: [AgentRepository],
})
export class AgentRepositoryModule {}
