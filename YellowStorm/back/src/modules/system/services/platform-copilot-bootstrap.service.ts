import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Types } from 'mongoose';
import { AgentRepository } from '@modules/agent/repositories/agent.repository';
import {
  PLATFORM_COPILOT,
  PLATFORM_COPILOT_AGENT_SLUG,
  PLATFORM_COPILOT_DEFAULT_INSTRUCTION,
  RESERVED_SYSTEM_OWNER_ID,
} from '@modules/agent/constants/platform-copilot.constants';
import { AgentTypeService } from '@modules/agent-type/agent-type.service';
import { FeatureVisibilityService } from '../feature-visibility.service';

@Injectable()
export class PlatformCopilotBootstrapService implements OnApplicationBootstrap {
  constructor(
    private readonly featureVisibility: FeatureVisibilityService,
    private readonly agentTypeService: AgentTypeService,
    private readonly agentRepository: AgentRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const visibility = await this.featureVisibility.getVisibility();
    if (!visibility.platformCopilot) return;

    const agentType = await this.agentTypeService.findOrCreateBySlug(PLATFORM_COPILOT, {
      name: 'Platform Copilot',
      defaultPrompt: '',
      isActive: true,
    });
    await this.agentRepository.createDefaultSystemAgentIfMissing({
      id: new Types.ObjectId().toString(),
      slug: PLATFORM_COPILOT_AGENT_SLUG,
      name: 'Yellowmind',
      agentType: agentType.id,
      agentTypeSlug: PLATFORM_COPILOT,
      role: 'Yellowmind platform copilot',
      description: 'Global Yellowmind platform copilot',
      temperature: 0,
      instruction: PLATFORM_COPILOT_DEFAULT_INSTRUCTION,
      ignorePrePrompt: false,
      knowledgeBases: [],
      tools: [],
      skills: [],
      disabledSkills: [],
      connectors: [],
      connectorActionSelections: [],
      guardrails: {},
      deploymentSettings: {},
      enable_temporary_child_agents: false,
      max_temporary_child_agents: 4,
      isDefault: true,
      isActive: true,
      isDefaultForType: true,
      createdBy: RESERVED_SYSTEM_OWNER_ID,
    });
  }
}
