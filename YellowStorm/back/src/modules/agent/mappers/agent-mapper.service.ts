import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { LoggerService } from '../../logger';
import { AgentDocument } from '../schemas/agent.schema';
import { IAgentResponse, IAgentForStream } from '../interfaces/agent.interface';
import { ISkillResponse } from '../../skill/interfaces/skill.interface';
import { IConnectorResponse } from '../../connector/interfaces/connector.interface';
import {
  normalizePromptInjectionGuardrails,
} from '../../guardrails/services/guardrails-settings.service';
import { normalizeWidgetSettings } from '../constants/widget-default-settings';

@Injectable()
export class AgentMapperService {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(AgentMapperService.name);
  }

  toResponse(
    doc: AgentDocument | Record<string, unknown>,
    agentTypeDoc?: { id: string; name: string },
  ): IAgentResponse {
    const d = doc as Record<string, unknown>;
    const populatedAgentType = d.agentType as Record<string, unknown> | undefined;
    let agentTypeInfo: { id: string; name: string };

    if (agentTypeDoc) {
      agentTypeInfo = agentTypeDoc;
    } else if (populatedAgentType && typeof populatedAgentType === 'object' && populatedAgentType._id) {
      agentTypeInfo = {
        id: (populatedAgentType._id as { toString(): string }).toString(),
        name: (populatedAgentType.name as string) || '',
      };
    } else {
      agentTypeInfo = {
        id: d.agentType ? (d.agentType as { toString(): string }).toString() : '',
        name: '',
      };
    }

    return {
      id: (d._id as { toString(): string }).toString(),
      name: d.name as string,
      slug: ((d.slug as string) || this.normalizeSlug(d.name as string)),
      agentType: agentTypeInfo,
      role: d.role as string,
      description: (d.description as string) || '',
      temperature: (d.temperature as number) ?? 0,
      model: d.llmModel as string | undefined,
      instruction: (d.instruction as string) || '',
      ignorePrePrompt: (d.ignorePrePrompt as boolean) || false,
      knowledgeBases: ((d.knowledgeBases as Array<{ toString(): string }>) || []).map((id) =>
        id.toString(),
      ),
      tools: ((d.tools as Array<{ toString(): string }>) || []).map((id) =>
        id.toString(),
      ),
      skills: ((d.skills as Array<{ toString(): string }>) || []).map((id) => id.toString()),
      disabledSkills: ((d.disabledSkills as Array<{ toString(): string }>) || []).map((id) =>
        id.toString(),
      ),
      connectors: ((d.connectors as Array<{ toString(): string }>) || []).map((id) =>
        id.toString(),
      ),
      connectorActionSelections: this.toConnectorActionSelectionResponses(d.connectorActionSelections),
      guardrails: {
        promptInjection: normalizePromptInjectionGuardrails(
          (d.guardrails as { promptInjection?: unknown } | undefined)?.promptInjection as Parameters<typeof normalizePromptInjectionGuardrails>[0],
        ),
      },
      deploymentSettings: {
        embedEnabled: ((d.deploymentSettings as { embedEnabled?: boolean } | undefined)?.embedEnabled) ?? false,
        restEnabled: ((d.deploymentSettings as { restEnabled?: boolean } | undefined)?.restEnabled) ?? false,
        widget: normalizeWidgetSettings(
          (d.deploymentSettings as { widget?: Parameters<typeof normalizeWidgetSettings>[0] } | undefined)?.widget,
        ),
      },
      enable_temporary_child_agents: (d.enable_temporary_child_agents as boolean) ?? false,
      max_temporary_child_agents: (d.max_temporary_child_agents as number) ?? 4,
      hasSmartMemory: false,
      isDefault: (d.isDefault as boolean) || false,
      isDefaultForType: (d.isDefaultForType as boolean) || false,
      isActive: (d.isActive as boolean) ?? true,
      a2aPublished: (d.a2aPublished as boolean) || false,
      a2aAgentCardUrl: (d.a2aAgentCardUrl as string) || undefined,
      createdBy: d.createdBy ? (d.createdBy as { toString(): string }).toString() : '',
      createdAt: d.createdAt as Date,
      updatedAt: d.updatedAt as Date,
    };
  }

  toStreamAgent(doc: AgentDocument | Record<string, unknown>): IAgentForStream {
    const d = doc as Record<string, unknown>;
    const populatedAgentType = d.agentType as Record<string, unknown> | undefined;
    const agentTypeName =
      populatedAgentType && typeof populatedAgentType === 'object' && populatedAgentType.name
        ? (populatedAgentType.name as string)
        : '';
    const agentTypeSlug =
      populatedAgentType && typeof populatedAgentType === 'object' && populatedAgentType.slug
        ? (populatedAgentType.slug as string)
        : '';
    const agentTypeId =
      populatedAgentType && typeof populatedAgentType === 'object' && populatedAgentType._id
        ? (populatedAgentType._id as { toString(): string }).toString()
        : '';
    const agentTypeSkillIds =
      populatedAgentType && typeof populatedAgentType === 'object' && Array.isArray(populatedAgentType.skills)
        ? (populatedAgentType.skills as Array<{ toString(): string }>).map((id) => id.toString())
        : [];

    return {
      id: (d._id as { toString(): string }).toString(),
      name: d.name as string,
      agentTypeName,
      agentTypeSlug,
      agentTypeId,
      role: d.role as string,
      description: (d.description as string) || '',
      temperature: (d.temperature as number) ?? 0,
      model: d.llmModel as string | undefined,
      instruction: (d.instruction as string) || '',
      ignorePrePrompt: (d.ignorePrePrompt as boolean) || false,
      knowledgeBases: ((d.knowledgeBases as Array<{ toString(): string }>) || []).map((id) =>
        id.toString(),
      ),
      toolIds: ((d.tools as Array<{ toString(): string }>) || []).map((id) =>
        id.toString(),
      ),
      skillIds: ((d.skills as Array<{ toString(): string }>) || []).map((id) => id.toString()),
      disabledSkillIds: ((d.disabledSkills as Array<{ toString(): string }>) || []).map((id) =>
        id.toString(),
      ),
      connectorIds: ((d.connectors as Array<{ toString(): string }>) || []).map((id) =>
        id.toString(),
      ),
      connectorActionSelections: this.toConnectorActionSelectionResponses(d.connectorActionSelections),
      guardrails: {
        promptInjection: normalizePromptInjectionGuardrails(
          (d.guardrails as { promptInjection?: unknown } | undefined)?.promptInjection as Parameters<typeof normalizePromptInjectionGuardrails>[0],
        ),
      },
      agentTypeSkillIds,
      enable_temporary_child_agents: (d.enable_temporary_child_agents as boolean) ?? false,
      max_temporary_child_agents: (d.max_temporary_child_agents as number) ?? 4,
      isDefault: (d.isDefault as boolean) || false,
      isDefaultForType: (d.isDefaultForType as boolean) || false,
    };
  }

  resolveEffectiveSkills(
    agent: IAgentForStream,
    skillsMap: Map<string, ISkillResponse>,
  ): ISkillResponse[] {
    const disabled = new Set(agent.disabledSkillIds ?? []);
    const skillIds = [
      ...new Set([...(agent.agentTypeSkillIds ?? []), ...(agent.skillIds ?? []), ...(agent.connectorSkillIds ?? [])]),
    ];

    return skillIds
      .filter((id) => !disabled.has(id))
      .map((id) => skillsMap.get(id))
      .filter(Boolean) as ISkillResponse[];
  }

  getConnectorSkillIds(
    connectorsMap: Map<string, IConnectorResponse>,
    connectorIds: string[],
  ): string[] {
    return [...new Set(
      connectorIds
        .map((connectorId) => connectorsMap.get(connectorId)?.referencedSkillIds || [])
        .flat()
        .filter(Boolean) as string[],
    )];
  }

  toConnectorActionSelectionResponses(
    value: unknown,
  ): Array<{ connectorId: string; actionKeys: string[] }> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }

        const record = entry as {
          connector?: { toString(): string } | string;
          connectorId?: string;
          actionKeys?: unknown;
        };
        const connectorId = record.connectorId || record.connector?.toString() || '';
        const actionKeys = Array.isArray(record.actionKeys)
          ? [...new Set(record.actionKeys.filter((key): key is string => typeof key === 'string' && key.trim().length > 0))]
          : [];

        if (!connectorId || actionKeys.length === 0) {
          this.logger.warn('Dropping invalid connector action selection response', {
            connectorId: connectorId || '<missing-connector-id>',
            reason: !connectorId ? 'missing_connector_id' : 'missing_action_keys',
          });
          return null;
        }

        return { connectorId, actionKeys };
      })
      .filter(Boolean) as Array<{ connectorId: string; actionKeys: string[] }>;
  }

  normalizeConnectorActionSelections(
    connectorIds: string[] | undefined,
    selections?: Array<{ connectorId: string; actionKeys: string[] }>,
  ): Array<{ connector: Types.ObjectId; actionKeys: string[] }> {
    if (!connectorIds?.length || !selections?.length) {
      return [];
    }

    const allowedConnectorIds = new Set(connectorIds);
    return selections
      .map((selection) => {
        if (!allowedConnectorIds.has(selection.connectorId)) {
          this.logger.warn('Dropping connector action selection outside attached connectors', {
            connectorId: selection.connectorId,
            reason: 'connector_not_attached',
          });
          return null;
        }

        const actionKeys = [...new Set((selection.actionKeys || []).filter((key) => key?.trim()))];
        if (actionKeys.length === 0) {
          this.logger.warn('Dropping connector action selection without action keys', {
            connectorId: selection.connectorId,
            reason: 'missing_action_keys',
          });
          return null;
        }

        return {
          connector: new Types.ObjectId(selection.connectorId),
          actionKeys,
        };
      })
      .filter(Boolean) as Array<{ connector: Types.ObjectId; actionKeys: string[] }>;
  }

  buildConnectorActionKeysByConnectorId(
    selections?: Array<{ connectorId: string; actionKeys: string[] }>,
  ): Map<string, Set<string>> | undefined {
    if (!selections?.length) {
      return undefined;
    }

    return new Map(
      selections.map((selection) => [selection.connectorId, new Set(selection.actionKeys)]),
    );
  }

  private normalizeSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
