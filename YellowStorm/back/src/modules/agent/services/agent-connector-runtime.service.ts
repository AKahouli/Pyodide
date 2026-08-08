import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { LoggerService } from '../../logger';
import { SkillService } from '../../skill/skill.service';
import { ISkillResponse } from '../../skill/interfaces/skill.interface';
import { ConnectorService } from '../../connector/connector.service';
import { IConnectorResponse } from '../../connector/interfaces/connector.interface';
import { ConnectorAuthService } from '../../connector/interfaces/connector-auth.interface';
import { filterConnectorFixedParams } from '../../connector/utils/connector-fixed-params.util';

/**
 * Builds connector maps, auth bindings, tool defs, and skill payloads for
 * playbook/stream gRPC runtimes. Keeps connector-auth concerns out of AgentService.
 */
@Injectable()
export class AgentConnectorRuntimeService {
  constructor(
    private readonly logger: LoggerService,
    private readonly skillService: SkillService,
    private readonly connectorService: ConnectorService,
    @Inject('ConnectorAuthService')
    private readonly connectorAuthService: ConnectorAuthService,
    private readonly configService: ConfigService,
  ) {
    this.logger.setContext(AgentConnectorRuntimeService.name);
  }

  async buildGrpcConnectorRuntimeForPlaybook(
    userId: string,
    toolBindings: Record<string, unknown>[],
  ): Promise<{
    connectorIds: string[];
    connector_bindings: Record<string, unknown>[];
    tools: Record<string, unknown>[];
    skills: Record<string, unknown>[];
  }> {
    const normalizedBindings = toolBindings
      .filter((binding) => binding && typeof binding === 'object')
      .map((binding) => binding as Record<string, unknown>);

    if (normalizedBindings.length === 0) {
      return { connectorIds: [], connector_bindings: [], tools: [], skills: [] };
    }

    const connectorIds: string[] = [];
    const actionKeysByConnectorId = new Map<string, Set<string>>();
    const fixedParamsByConnectorId = new Map<string, Record<string, unknown>>();

    for (const binding of normalizedBindings) {
      if (binding.isEnabled === false) {
        continue;
      }

      const connectorId = String(binding.connectorId || '').trim();
      if (!connectorId) {
        this.logger.warn('Skipping playbook connector binding without connector id', { userId });
        continue;
      }

      const enabledActionKeys = new Set(
        (Array.isArray(binding.actions) ? binding.actions : [])
          .filter((action) => action && typeof action === 'object' && (action as Record<string, unknown>).isEnabled !== false)
          .map((action) => String((action as Record<string, unknown>).actionKey || '').trim())
          .filter(Boolean),
      );

      if (enabledActionKeys.size === 0) {
        this.logger.warn('Skipping playbook connector binding without enabled actions', { userId, connectorId });
        continue;
      }

      connectorIds.push(connectorId);
      actionKeysByConnectorId.set(connectorId, enabledActionKeys);

      if (binding.fixedParams && typeof binding.fixedParams === 'object' && !Array.isArray(binding.fixedParams)) {
        fixedParamsByConnectorId.set(connectorId, binding.fixedParams as Record<string, unknown>);
      }
    }

    const uniqueConnectorIds = [...new Set(connectorIds)];
    if (uniqueConnectorIds.length === 0) {
      return { connectorIds: [], connector_bindings: [], tools: [], skills: [] };
    }

    const connectorsMap = await this.buildConnectorsMap(uniqueConnectorIds);
    for (const [connectorId, fixedParams] of fixedParamsByConnectorId) {
      const connector = connectorsMap.get(connectorId);
      if (!connector) continue;

      const allowedActionKeys = actionKeysByConnectorId.get(connectorId);
      const selectedActions = (connector.actions || [])
        .filter((action) => action.isEnabled !== false)
        .filter((action) => !allowedActionKeys || allowedActionKeys.has(action.key))
        .map((action) => ({
          key: action.key,
          parameterSchema: action.parameterSchema || {},
        }));
      fixedParamsByConnectorId.set(
        connectorId,
        filterConnectorFixedParams(fixedParams, selectedActions),
      );
    }
    const connectorBindings = await this.buildConnectorBindings(
      connectorsMap,
      uniqueConnectorIds,
      userId,
      actionKeysByConnectorId,
      fixedParamsByConnectorId,
    );
    const connectorSkillIds = this.getConnectorSkillIds(connectorsMap, uniqueConnectorIds);
    const skills = await this.buildGrpcSkillsForPlaybook(connectorSkillIds);

    return {
      connectorIds: uniqueConnectorIds,
      connector_bindings: connectorBindings,
      tools: this.buildConnectorToolDefs(connectorBindings),
      skills,
    };
  }

  async buildGrpcSkillsForPlaybook(skillIds: string[]): Promise<Record<string, unknown>[]> {
    const uniqueSkillIds = [...new Set(skillIds.map((skillId) => skillId.trim()).filter(Boolean))];
    if (uniqueSkillIds.length === 0) {
      return [];
    }

    const skills = await this.skillService.findByIds(uniqueSkillIds);
    const resolvedSkillIds = new Set(skills.map((skill) => skill.id));
    const missingSkillIds = uniqueSkillIds.filter((skillId) => !resolvedSkillIds.has(skillId));
    if (missingSkillIds.length > 0) {
      this.logger.warn('Missing playbook runtime skills', { skillIds: missingSkillIds });
    }
    return skills.map((skill) => this.toGrpcSkill(skill));
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

  toGrpcSkill(skill: ISkillResponse): Record<string, unknown> {
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
      license: skill.license,
      compatibility: skill.compatibility,
      metadata: skill.metadata,
      allowed_tools: skill.allowedTools,
      files: skill.files.map((file) => ({
        path: file.path,
        kind: file.kind,
        mime_type: file.mimeType,
        content: file.content,
      })),
    };
  }

  async buildConnectorsMap(connectorIds: string[]): Promise<Map<string, IConnectorResponse>> {
    const connectorsMap = new Map<string, IConnectorResponse>();
    if (connectorIds.length === 0) {
      return connectorsMap;
    }

    const fetchedConnectors = await this.connectorService.findByIds(connectorIds);
    for (const connector of fetchedConnectors) {
      connectorsMap.set(connector.id, connector);
    }

    const missingConnectorIds = connectorIds.filter((connectorId) => !connectorsMap.has(connectorId));
    if (missingConnectorIds.length > 0) {
      this.logger.warn('Missing playbook runtime connectors', { connectorIds: missingConnectorIds });
    }

    return connectorsMap;
  }

  async buildConnectorBindings(
    connectorsMap: Map<string, IConnectorResponse>,
    connectorIds: string[] = [],
    userId?: string,
    actionKeysByConnectorId?: Map<string, Set<string>>,
    fixedParamsByConnectorId?: Map<string, Record<string, unknown>>,
  ): Promise<Record<string, unknown>[]> {
    const bindings = connectorIds
      .map((connectorId) => connectorsMap.get(connectorId))
      .filter(Boolean)
      .map((connector: any) => ({
        connector_id: connector.id,
        connector_name: connector.name,
        connector_slug: connector.slug || connector.name,
        actions: (connector.actions || [])
          .filter((action: any) => action.isEnabled !== false)
          .filter((action: any) => {
            const allowedActionKeys = actionKeysByConnectorId?.get(connector.id);
            return !allowedActionKeys || allowedActionKeys.has(action.key);
          })
          .map((action: any) => ({
            action_key: action.key,
            label: action.label || action.key,
            description: action.description || '',
            parameter_schema: action.parameterSchema || {},
            safety: String(action.safety || 'read').toLowerCase(),
          })),
        fixed_params: fixedParamsByConnectorId?.get(connector.id) || {},
        mcp_transport_type: connector.mcpTransportType || '',
        mcp_server_url: connector.mcpServerUrl || '',
        mcp_server_config: connector.mcpServerConfig || {},
        auth_headers: {} as Record<string, string>,
        auth_env: {} as Record<string, string>,
      }))
      .filter((binding: any) => binding.actions.length > 0);

    if (userId) {
      for (const binding of bindings) {
        const connector = connectorsMap.get(binding.connector_id);
        if (connector?.authSourceType && connector.authSourceType !== 'none') {
          try {
            const auth = await this.connectorAuthService.resolveRuntimeAuth(userId, {
              authSourceType: connector.authSourceType,
              connectedAppKey: connector.connectedAppKey,
              runtimeAuthConfig: connector.runtimeAuthConfig || {},
              connectorId: connector.id,
            });
            binding.auth_headers = auth.headers;
            binding.auth_env = auth.env;
          } catch (err) {
            this.logger.warn('Failed to resolve connector auth for agent runtime', {
              connector_id: binding.connector_id,
              error: (err as Error).message,
            });
          }
        }
        try {
          const dynamicHeaders = await this.connectorAuthService.resolveDynamicHeaders(
            userId,
            connector?.dynamicHeaders || [],
          );
          binding.auth_headers = {
            ...binding.auth_headers,
            ...dynamicHeaders,
          };
          this.logger.debug('Connector runtime auth headers resolved', {
            connector_id: binding.connector_id,
            authHeaderNames: Object.keys(binding.auth_headers),
          });
        } catch (err) {
          this.logger.warn('Failed to resolve connector dynamic headers for agent runtime', {
            connector_id: binding.connector_id,
            error: (err as Error).message,
          });
        }
      }
    }

    const mcpLogicalSearchKey = this.configService.get<string>('MCP_LOGICAL_SEARCH_API_KEY', '');
    if (mcpLogicalSearchKey) {
      for (const binding of bindings) {
        const transport = String(binding.mcp_transport_type || '');
        const hasAuth = Boolean((binding.auth_headers as Record<string, string>)?.Authorization);
        if (transport === 'streamable_http' && !hasAuth) {
          binding.auth_headers = {
            ...(binding.auth_headers as Record<string, string>),
            Authorization: `Bearer ${mcpLogicalSearchKey}`,
          };
        }
      }
    }

    return bindings;
  }

  buildConnectorToolDefs(bindings: Record<string, unknown>[]): Record<string, unknown>[] {
    return bindings.flatMap((binding) => {
      const connectorName = String(binding.connector_name || 'connector');
      const actions = Array.isArray(binding.actions) ? binding.actions : [];

      return actions.map((action) => {
        const normalizedAction = action as Record<string, unknown>;
        const actionKey = String(normalizedAction.action_key || '');
        const connectorSlug = String(binding.connector_slug || connectorName);
        const label = String(normalizedAction.label || actionKey);
        const description = String(normalizedAction.description || '');

        return {
          name: this.buildConnectorToolName(connectorSlug, actionKey),
          description: description || `${connectorName} connector action ${label}`,
          prompt: '',
          top_k: 0,
        };
      });
    });
  }

  buildConnectorToolName(connectorSlug: string, actionKey: string): string {
    const candidate = `${connectorSlug}_${actionKey}`;
    const sanitized = candidate.replace(/[^A-Za-z0-9_-]+/g, '_');
    if (sanitized === candidate && sanitized.length <= 64) {
      return sanitized;
    }

    const suffix = createHash('sha256').update(candidate, 'utf8').digest('hex').slice(0, 16);
    return `${sanitized.slice(0, 47)}_${suffix}`;
  }
}
