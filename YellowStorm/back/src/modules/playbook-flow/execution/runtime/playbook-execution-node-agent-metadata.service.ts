import { Injectable, Logger } from '@nestjs/common';
import { AgentService } from '@modules/agent/agent.service';

function getConnectorIdsFromRuntimeBindings(bindings: unknown): Set<string> {
  if (!Array.isArray(bindings)) {
    return new Set<string>();
  }

  return new Set(
    bindings
      .filter((binding): binding is Record<string, unknown> => !!binding && typeof binding === 'object' && !Array.isArray(binding))
      .map((binding) => String(binding.connector_id || '').trim())
      .filter(Boolean),
  );
}

function getSkillIdsFromRuntimeSkills(skills: unknown): Set<string> {
  if (!Array.isArray(skills)) {
    return new Set<string>();
  }

  return new Set(
    skills
      .filter((skill): skill is Record<string, unknown> => !!skill && typeof skill === 'object' && !Array.isArray(skill))
      .map((skill) => String(skill.id || '').trim())
      .filter(Boolean),
  );
}

/**
 * Merges task-level connector/skill tool bindings into a node's runtime agent
 * before the gRPC dispatch. Keeps callGrpcRun/callGrpcRunFromCheckpoint on
 * PlaybookFlowExecutionService free of this merge logic.
 */
@Injectable()
export class PlaybookExecutionNodeAgentMetadataService {
  private readonly logger = new Logger(PlaybookExecutionNodeAgentMetadataService.name);

  constructor(private readonly agentService: AgentService) {}

  async buildNodeRuntimeAgentMetadata(
    ownerId: string,
    nodeId: string,
    baseMetadata: Record<string, unknown>,
    resolvedAgent?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | undefined> {
    if (!resolvedAgent) {
      return resolvedAgent;
    }

    const taskToolBindings = Array.isArray(baseMetadata.toolBindings)
      ? baseMetadata.toolBindings.filter((binding): binding is Record<string, unknown> => (
        !!binding && typeof binding === 'object' && !Array.isArray(binding)
      ))
      : [];

    if (taskToolBindings.length === 0) {
      return this.mergeNodeRuntimeSkills(ownerId, nodeId, baseMetadata, resolvedAgent);
    }

    const existingConnectorIds = new Set([
      ...getConnectorIdsFromRuntimeBindings(resolvedAgent.connector_bindings),
      ...((Array.isArray(resolvedAgent.connector_ids) ? resolvedAgent.connector_ids : [])
        .map((connectorId) => String(connectorId || '').trim())
        .filter(Boolean)),
    ]);

    const additionalBindings: Record<string, unknown>[] = [];
    const seenConnectorIds = new Set<string>();

    for (const binding of taskToolBindings) {
      if (binding.isEnabled === false) {
        continue;
      }

      const connectorId = String(binding.connectorId || '').trim();
      if (!connectorId || existingConnectorIds.has(connectorId) || seenConnectorIds.has(connectorId)) {
        continue;
      }

      seenConnectorIds.add(connectorId);
      additionalBindings.push(binding);
    }

    if (additionalBindings.length === 0) {
      return this.mergeNodeRuntimeSkills(ownerId, nodeId, baseMetadata, resolvedAgent);
    }

    const additionalRuntime = await this.agentService.buildGrpcConnectorRuntimeForPlaybook(ownerId, additionalBindings);
    if (additionalRuntime.connector_bindings.length === 0) {
      this.logger.warn('Skipped playbook task connector bindings without runtime actions', {
        ownerId,
        nodeId,
        connectorIds: additionalBindings.map((binding) => String(binding.connectorId || '')).filter(Boolean),
      });
      return this.mergeNodeRuntimeSkills(ownerId, nodeId, baseMetadata, resolvedAgent);
    }

    const mergedConnectorBindings = [
      ...(Array.isArray(resolvedAgent.connector_bindings) ? resolvedAgent.connector_bindings : []),
      ...additionalRuntime.connector_bindings,
    ];
    const existingSkillIds = getSkillIdsFromRuntimeSkills(resolvedAgent.skills);
    const additionalConnectorSkills = (Array.isArray(additionalRuntime.skills) ? additionalRuntime.skills : [])
      .filter((skill): skill is Record<string, unknown> => !!skill && typeof skill === 'object' && !Array.isArray(skill))
      .filter((skill) => {
        const skillId = String(skill.id || '').trim();
        return !!skillId && !existingSkillIds.has(skillId);
      });

    return this.mergeNodeRuntimeSkills(ownerId, nodeId, baseMetadata, {
      ...resolvedAgent,
      agent_tools: [
        ...(Array.isArray(resolvedAgent.agent_tools) ? resolvedAgent.agent_tools : []),
        ...additionalRuntime.tools,
      ],
      skills: [
        ...(Array.isArray(resolvedAgent.skills) ? resolvedAgent.skills : []),
        ...additionalConnectorSkills,
      ],
      agent_params: {
        ...(resolvedAgent.agent_params && typeof resolvedAgent.agent_params === 'object' && !Array.isArray(resolvedAgent.agent_params)
          ? resolvedAgent.agent_params as Record<string, unknown>
          : {}),
        connector_bindings_json: JSON.stringify(mergedConnectorBindings),
      },
      connector_bindings: mergedConnectorBindings,
      connector_ids: [
        ...existingConnectorIds,
        ...additionalRuntime.connectorIds,
      ],
    });
  }

  private async mergeNodeRuntimeSkills(
    ownerId: string,
    nodeId: string,
    baseMetadata: Record<string, unknown>,
    resolvedAgent: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const taskSkillBindings = Array.isArray(baseMetadata.skillBindings)
      ? baseMetadata.skillBindings.filter((binding): binding is Record<string, unknown> => (
        !!binding && typeof binding === 'object' && !Array.isArray(binding)
      ))
      : [];

    if (taskSkillBindings.length === 0) {
      return resolvedAgent;
    }

    const existingSkillIds = getSkillIdsFromRuntimeSkills(resolvedAgent.skills);
    const additionalSkillIds = [...new Set(taskSkillBindings
      .filter((binding) => binding.isEnabled !== false)
      .map((binding) => String(binding.skillId || '').trim())
      .filter((skillId) => skillId && !existingSkillIds.has(skillId)))];

    if (additionalSkillIds.length === 0) {
      return resolvedAgent;
    }

    const additionalSkills = await this.agentService.buildGrpcSkillsForPlaybook(additionalSkillIds);
    if (additionalSkills.length === 0) {
      this.logger.warn('Skipped playbook task skill bindings without active runtime skills', {
        ownerId,
        nodeId,
        skillIds: additionalSkillIds,
      });
      return resolvedAgent;
    }

    return {
      ...resolvedAgent,
      skills: [
        ...(Array.isArray(resolvedAgent.skills) ? resolvedAgent.skills : []),
        ...additionalSkills,
      ],
    };
  }
}
