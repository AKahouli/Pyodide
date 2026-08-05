import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import litellmConfig from '../../config/litellm.config';
import { EmbeddingService } from '../models/embedding.service';
import { AgentRoleEmbeddingService } from './services/agent-role-embedding.service';

// Global so both AgentService and HumainAgentService can trigger reindexing
// without import churn. Intentionally imports ONLY ConfigModule (for the litellm
// namespace) — NOT ModelsModule — so it does not pull AuthorizationModule/UserModule
// into the early global-load phase and disturb the app's module load order.
// AgentRepository comes from the global AgentRepositoryModule.
@Global()
@Module({
  imports: [ConfigModule.forFeature(litellmConfig)],
  providers: [EmbeddingService, AgentRoleEmbeddingService],
  exports: [EmbeddingService, AgentRoleEmbeddingService],
})
export class AgentEmbeddingModule {}
