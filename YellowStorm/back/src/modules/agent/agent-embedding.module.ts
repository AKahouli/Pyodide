import { Global, Module } from '@nestjs/common';
import { ModelsModule } from '../models/models.module';
import { AgentRoleEmbeddingService } from './services/agent-role-embedding.service';

// Global so both AgentService and HumainAgentService can trigger reindexing
// without import churn. AgentRepository comes from the global AgentRepositoryModule;
// EmbeddingService comes from ModelsModule.
@Global()
@Module({
  imports: [ModelsModule],
  providers: [AgentRoleEmbeddingService],
  exports: [AgentRoleEmbeddingService],
})
export class AgentEmbeddingModule {}
