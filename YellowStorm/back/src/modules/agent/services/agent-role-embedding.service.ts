import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../logger';
import { EmbeddingService } from '../../models/embedding.service';
import { AgentRepository } from '../repositories/agent.repository';

/** Agent-type slug whose agents are semantically indexed by role. */
const HUMAIN_SLUG = 'humain';

/**
 * Keeps the `role_embedding` (pgvector) of humain agents in sync with their
 * `name`/`role`. Every entry point is fire-and-forget and never throws, so a
 * login/profile write is never blocked or failed by embedding maintenance.
 */
@Injectable()
export class AgentRoleEmbeddingService {
  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly agentRepository: AgentRepository,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(AgentRoleEmbeddingService.name);
  }

  /**
   * Reindex a humain agent's role embedding. No-op for non-humain agents. Never throws.
   *
   * Fully detached: scheduled on a later event-loop tick via setImmediate so the
   * create/update request completes and responds FIRST — no embedding work (not
   * even the outbound HTTP setup) runs on the request's synchronous path. The
   * embedding then computes on its own and sets `role_embedding` when done.
   */
  reindexHumainRole(agentId: string, agentTypeSlug: string, name: string, role: string): void {
    if (agentTypeSlug !== HUMAIN_SLUG) return;
    setImmediate(() => {
      void this.run(agentId, name, role).catch((error) => { this.logger.warn('Role embedding reindex failed', { agentId, error: (error as Error).message }); },
      );
    });
  }

  private async run(agentId: string, name: string, role: string): Promise<void> {
    const vec = await this.embeddingService.embed(`${name}. ${role}`);
    if (!vec) return; // embed() already logged; nothing to store
    await this.agentRepository.setRoleEmbedding(agentId, vec);
    this.logger.log('Role embedding indexed', { agentId, dims: vec.length });
  }
}
