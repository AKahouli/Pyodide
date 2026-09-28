import { Injectable } from '@nestjs/common';
import { newObjectId } from '@common/postgres/object-id';
import { deriveAgentSlug } from '@common/utils/slugify';
import { LoggerService } from '../logger';
import { AgentRepository } from '../agent/repositories/agent.repository';
import { AgentRoleEmbeddingService } from '../agent/services/agent-role-embedding.service';
import { PgAgentTypeStore } from '../agent-type/persistence/pg-agent-type.store';

/** Agent-type slug for the per-user "human" agent. Assumed created in the admin panel. */
const HUMAIN_AGENT_TYPE_SLUG = 'humain';

export interface HumainAgentInput {
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  description?: string;
}

@Injectable()
export class HumainAgentService {
  constructor(
    private readonly agentRepository: AgentRepository,
    // Store (not AgentTypeService): keeps the auth -> humain-agent import
    // chain free of the agent/skill service subtree.
    private readonly agentTypeStore: PgAgentTypeStore,
    private readonly roleEmbedding: AgentRoleEmbeddingService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(HumainAgentService.name);
  }

  /** Create the user's human agent if it does not exist yet. Does not modify an existing one. */
  async ensureForUser(input: HumainAgentInput): Promise<void> {
    await this.upsert(input, false);
  }

  /** Create the human agent if missing, and overwrite its name/role/description from the profile. */
  async syncFromProfile(input: HumainAgentInput): Promise<void> {
    await this.upsert(input, true);
  }

  private async upsert(input: HumainAgentInput, overwriteProfileFields: boolean): Promise<void> {
    try {
      const humainType = await this.agentTypeStore.findBySlug(HUMAIN_AGENT_TYPE_SLUG, true);
      if (!humainType) {
        this.logger.warn('Humain agent type not found; skipping human agent upsert', { userId: input.userId });
        return;
      }

      const agentType = humainType.id;
      const agentTypeSlug = humainType.slug;
      const name = this.deriveName(input);
      const slug = deriveAgentSlug(name);
      const role = this.deriveRole(input, name);
      const description = (input.description ?? '').slice(0, 1000);

      const existing = await this.agentRepository.findByOwnerAndType(input.userId, agentType);

      if (!existing) {
        const id = newObjectId();
        await this.agentRepository.create({
          id,
          name, slug, agentType, agentTypeSlug, role, description, email: input.email,
          temperature: 0, llmModel: undefined, instruction: '', ignorePrePrompt: false,
          knowledgeBases: [], tools: [], skills: [], disabledSkills: [], connectors: [], connectorActionSelections: [],
          guardrails: {}, deploymentSettings: {},
          enable_temporary_child_agents: false, max_temporary_child_agents: 4,
          isDefault: false, isDefaultForType: false, isActive: true, createdBy: input.userId,
        });
        this.roleEmbedding.reindexHumainRole(id, agentTypeSlug, name, role);
        this.logger.log('Human agent created', { userId: input.userId });
        return;
      }

      if (overwriteProfileFields) {
        await this.agentRepository.updateById(existing._id, { name, slug, role, description, email: input.email });
        this.roleEmbedding.reindexHumainRole(existing._id, agentTypeSlug, name, role);
        this.logger.log('Human agent synced', { userId: input.userId });
      } else if (input.email && existing.email !== input.email) {
        // Keep the humain agent's email aligned with the user's email even on plain
        // login (fills it for agents that predate the email field).
        await this.agentRepository.updateById(existing._id, { email: input.email });
        this.logger.log('Human agent email updated', { userId: input.userId });
      }
    } catch (error) {
      // Never throw: human-agent maintenance must not break auth/profile flows.
      this.logger.warn('Failed to upsert human agent', { userId: input.userId, error: (error as Error).message });
    }
  }

  private deriveName(input: HumainAgentInput): string {
    const full = [input.firstName?.trim(), input.lastName?.trim()].filter(Boolean).join(' ').trim();
    let base = full || input.email.split('@')[0]?.trim() || 'User';
    if (base.length < 2) base = `${base}-agent`; // satisfy the 2-char minimum
    return base.slice(0, 50);
  }

  private deriveRole(input: HumainAgentInput, name: string): string {
    const role = input.role?.trim();
    if (role) return role.slice(0, 50000);
    return `You are ${name}, a human agent.`;
  }
}
