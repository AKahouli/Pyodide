import { newObjectId } from '@common/postgres/object-id';
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { AgentRepository } from '@modules/agent/repositories/agent.repository';
import {
  SEMANTIC_EXTRACTION_AGENT_NAME,
  SEMANTIC_EXTRACTION_AGENT_SLUG,
  SEMANTIC_EXTRACTION_AGENT_TYPE_SLUG,
  SEMANTIC_EXTRACTION_DEFAULT_INSTRUCTION,
  SEMANTIC_EXTRACTION_DEFAULT_MODEL,
} from '@modules/agent/constants/semantic-extraction.constants';
import { RESERVED_SYSTEM_OWNER_ID } from '@modules/agent/constants/platform-copilot.constants';
import { AgentTypeService } from '@modules/agent-type/agent-type.service';
import { FeatureVisibilityService } from '../feature-visibility.service';

/**
 * Seeds the product default agent used by AI extraction in the semantic model
 * population pipeline. Idempotent: the repository inserts on conflict do nothing,
 * so an admin's later edits (model, enablement) are never overwritten.
 */
@Injectable()
export class SemanticExtractionAgentBootstrapService implements OnApplicationBootstrap {
  constructor(
    private readonly featureVisibility: FeatureVisibilityService,
    private readonly agentTypeService: AgentTypeService,
    private readonly agentRepository: AgentRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const visibility = await this.featureVisibility.getVisibility();
    if (!visibility.semanticModel) return;

    const agentType = await this.agentTypeService.findOrCreateBySlug(SEMANTIC_EXTRACTION_AGENT_TYPE_SLUG, {
      name: 'Semantic extraction',
      defaultPrompt: '',
      isActive: true,
    });
    await this.seedAgent(agentType.id);
  }

  private async seedAgent(agentTypeId: string): Promise<void> {
    await this.agentRepository.createDefaultSystemAgentIfMissing({
      id: newObjectId(),
      slug: SEMANTIC_EXTRACTION_AGENT_SLUG,
      name: SEMANTIC_EXTRACTION_AGENT_NAME,
      agentType: agentTypeId,
      agentTypeSlug: SEMANTIC_EXTRACTION_AGENT_TYPE_SLUG,
      role: 'Semantic model field extraction',
      description: 'Extracts mapped business attributes from source documents for semantic model population',
      temperature: 0,
      llmModel: SEMANTIC_EXTRACTION_DEFAULT_MODEL,
      instruction: SEMANTIC_EXTRACTION_DEFAULT_INSTRUCTION,
      ignorePrePrompt: true,
      knowledgeBases: [],
      tools: [],
      skills: [],
      disabledSkills: [],
      connectors: [],
      connectorActionSelections: [],
      guardrails: {},
      deploymentSettings: {},
      enable_temporary_child_agents: false,
      // The schema requires 1..8 even when temporary children are disabled.
      max_temporary_child_agents: 1,
      isDefault: true,
      isActive: true,
      isDefaultForType: true,
      createdBy: RESERVED_SYSTEM_OWNER_ID,
    });

    // Installs seeded before the model was pinned have no model, and extraction
    // now requires an explicit one. Only fill an empty model; never overwrite an
    // administrator's choice.
    const existing = await this.agentRepository.findDefaultByNameActive(SEMANTIC_EXTRACTION_AGENT_NAME);
    if (existing && !existing.llmModel) {
      await this.agentRepository.updateById(existing._id, { llmModel: SEMANTIC_EXTRACTION_DEFAULT_MODEL });
    }
  }
}
