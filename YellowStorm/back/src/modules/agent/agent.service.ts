import { Inject, Injectable, Optional, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { LoggerService } from '../logger';
import { IAgentResponse, IAgentForStream, IGrpcAgent, IGrpcCompaction, ISharedAgentInfo } from './interfaces/agent.interface';
import { AgentShareService } from './services/agent-share.service';
import { AgentConnectorRuntimeService } from './services/agent-connector-runtime.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { QueryAgentDto } from './dto/query-agent.dto';
import { PublicQueryAgentDto } from './dto/public-query-agent.dto';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import {
  SandboxRuntimeContext,
  applySandboxScopeHeaders,
} from '../../common/runtime/sandbox-scope';
import { NotFoundException, ConflictException, ForbiddenException, BadRequestException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { escapeRegex, collapseRepeatedChar, collapseWhitespace, stripLeadingTrailingChar } from '../../common/utils';
import { ToolService } from '../tool/tool.service';
import { IToolResponse } from '../tool/interfaces/tool.interface';
import { AgentTypeService } from '../agent-type/agent-type.service';
import { ModelsService } from '../models/models.service';
import { SkillService } from '../skill/skill.service';
import { ISkillResponse } from '../skill/interfaces/skill.interface';
import { ConnectorService } from '../connector/connector.service';
import { IConnectorResponse } from '../connector/interfaces/connector.interface';
import { ConnectorAuthService } from '../connector/interfaces/connector-auth.interface';
import { ConnectedAppTokenService } from '../connected-app/services/connected-app-token.service';
import { TeamService } from '../team/team.service';
import {
  GuardrailsSettingsService,
  normalizeAgentGuardrails,
  normalizeAdminGuardrailsSettings,
} from '../guardrails/services/guardrails-settings.service';
import { normalizeWidgetSettings } from './constants/widget-default-settings';
import { AgentRepository, CreateAgentInput, UpdateAgentInput } from './repositories/agent.repository';
import { AgentRecord } from './repositories/agent-record.mapper';
import { AgentRoleEmbeddingService } from './services/agent-role-embedding.service';
import {
  PLATFORM_COPILOT,
  PLATFORM_COPILOT_AGENT_SLUG,
  PLATFORM_COPILOT_HANDOFF_RUNTIME_INSTRUCTION,
  PLATFORM_COPILOT_PLAYBOOK_CONNECTOR_SLUG,
} from './constants/platform-copilot.constants';
import { SystemService } from '../system/system.service';

/** Agent-type slug of the orchestrating manager agent. */
const MANAGER_SLUG = 'manager';
/** Agent-type slug of the single default agent sent when no agent is tagged. */
const MONO_AGENT_SLUG = 'mono-agent';
/** Agent-type slug for human agents exposed to third-party integrations. */
const HUMAIN_AGENT_TYPE_SLUG = 'humain';

export interface PlaybookPlannerAgentConfig {
  agentTypeId: string;
  agentTypeSlug: string;
  agentId: string;
  agentRevision: string;
  model: string | null;
  temperature: number;
  instruction: string;
}

export interface PlaybookPlannerAgentOption {
  id: string;
  name: string;
  description?: string;
  model: string | null;
}

@Injectable()
export class AgentService {
  private fallbackConnectorRuntimeService?: AgentConnectorRuntimeService;

  constructor(
    private readonly logger: LoggerService,
    private readonly toolService: ToolService,
    private readonly agentTypeService: AgentTypeService,
    private readonly modelsService: ModelsService,
    private readonly skillService: SkillService,
    private readonly connectorService: ConnectorService,
    @Inject('ConnectorAuthService')
    private readonly connectorAuthService: ConnectorAuthService,
    private readonly connectedAppTokenService: ConnectedAppTokenService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => TeamService))
    private readonly teamService: TeamService,
    private readonly agentShareService: AgentShareService,
    private readonly guardrailsSettingsService: GuardrailsSettingsService,
    private readonly agentRepository: AgentRepository,
    private readonly agentRoleEmbedding: AgentRoleEmbeddingService,
    @Optional() private readonly connectorRuntimeService?: AgentConnectorRuntimeService,
    @Optional() private readonly systemService?: SystemService,
  ) {
    this.logger.setContext(AgentService.name);
  }

  // ==========================================
  // User (personal) methods
  // ==========================================

  async createPersonal(userId: string, dto: CreateAgentDto): Promise<IAgentResponse> {
    // Validate agent type exists and is active
    const agentType = await this.agentTypeService.findById(dto.agentType);
    if (!agentType || !agentType.isActive) {
      throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND);
    }

    // Check name uniqueness within user
    const existing = await this.agentRepository.findByNameAndOwner(dto.name, userId);
    if (existing) {
      throw new ConflictException(ErrorCode.CUSTOM_AGENT_ALREADY_EXISTS);
    }

    const normalizedSlug = this.normalizeSlug(dto.slug || dto.name);

    await this.ensureSlugUniqueness(normalizedSlug, false, userId);

    // Ensure only one default-for-type per user per agent type
    if (dto.isDefaultForType) {
      await this.ensureDefaultForTypeUniqueness(dto.agentType, true, userId);
    }

    await this.skillService.findByIds([...(dto.skills ?? []), ...(dto.disabledSkills ?? [])]);

    const id = new Types.ObjectId().toString();
    const agentTypeSlug = await this.resolveAgentTypeSlug(dto.agentType);
    const agent = await this.agentRepository.create(
      this.dtoToCreateInput(userId, dto, { id, isDefault: false, slug: normalizedSlug, agentTypeSlug }),
    );
    this.agentRoleEmbedding.reindexHumainRole(agent._id, agent.agentTypeSlug, agent.name, agent.role);

    this.logger.log('Personal agent created', {
      agentId: agent._id.toString(),
      name: agent.name,
      userId,
    });

    return this.toResponse((await this.hydrateOne(agent))!);
  }

  async findUserAgents(userId: string, query: QueryAgentDto): Promise<PaginatedResponseDto<IAgentResponse>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const { items, total } = await this.agentRepository.listUserAgents({
      userId,
      search: query.search,
      agentType: query.agentType,
      isActive: query.isActive,
      page,
      limit,
    });

    const hydrated = await this.hydrate(items);
    return new PaginatedResponseDto(
      hydrated.map((a) => this.toResponse(a)),
      total,
      page,
      limit,
    );
  }

  /**
   * Public listing for third-party integrations. Returns only agents of the
   * "humain" agent type, with optional case-insensitive substring filters on
   * name, role and description. The type constraint is fixed and cannot be
   * overridden by the caller. If the "humain" agent type does not exist yet,
   * an empty page is returned instead of an error.
   */
  async findHumainAgentsPublic(
    query: PublicQueryAgentDto,
  ): Promise<PaginatedResponseDto<IAgentResponse>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const humainType = await this.agentTypeService.findBySlug(HUMAIN_AGENT_TYPE_SLUG);
    if (!humainType) {
      return new PaginatedResponseDto([], 0, page, limit);
    }

    const { items, total } = await this.agentRepository.listHumainPublic({
      agentTypeId: humainType.id,
      name: query.name,
      role: query.role,
      description: query.description,
      page,
      limit,
    });

    const hydrated = await this.hydrate(items);
    return new PaginatedResponseDto(
      hydrated.map((a) => this.toResponse(a)),
      total,
      page,
      limit,
    );
  }

  /**
   * Resolve humain agents by id for cross-user delegation display (e.g. a
   * Worky stream can delegate tasks to *another* user's humain agent). Owner-
   * ship is intentionally NOT enforced: humain agents are public — the same
   * data is already exposed unauthenticated via {@link findHumainAgentsPublic}
   * — so a stream owner must be able to render a delegated agent they don't
   * own. Scoped strictly to the "humain" type, so no private (non-humain)
   * agent is ever leaked, and to active agents. Unknown/non-humain ids are
   * silently dropped. Capped to avoid unbounded id lists.
   */
  async resolveHumainByIds(
    ids: string[],
  ): Promise<Array<{ id: string; name: string; slug: string; role: string }>> {
    const unique = [...new Set(ids.filter(Boolean))].slice(0, 100);
    if (unique.length === 0) return [];
    const records = await this.agentRepository.findByIds(unique, { activeOnly: true });
    return records
      .filter((r) => r.agentTypeSlug === HUMAIN_AGENT_TYPE_SLUG)
      .map((r) => ({ id: r._id, name: r.name, slug: r.slug, role: r.role }));
  }

  async findUserAgentById(userId: string, agentId: string): Promise<IAgentResponse> {
    const agent = await this.agentRepository.findById(agentId);

    if (!agent) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }

    const isOwner = agent.createdBy.toString() === userId;
    if (agent.isDefault) {
      return this.toResponse((await this.hydrateOne(agent))!);
    }
    let shareInfo: ISharedAgentInfo | undefined;
    if (!isOwner) {
      // Non-owners may read the agent only if it was shared with them.
      const info = await this.agentShareService.getShareInfo(userId, agentId);
      if (!info) {
        throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_FORBIDDEN);
      }
      shareInfo = info;
    }

    const response = this.toResponse((await this.hydrateOne(agent))!);
    if (shareInfo) response.shareInfo = shareInfo;
    return response;
  }

  async updatePersonal(userId: string, agentId: string, dto: UpdateAgentDto): Promise<IAgentResponse> {
    const agent = await this.agentRepository.findById(agentId);

    if (!agent) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }

    if (agent.isDefault) {
      throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_DEFAULT_READONLY);
    }

    // Owner or a user the agent was shared with at the 'write' level may update it.
    const ownerId = agent.createdBy.toString();
    if (ownerId !== userId) {
      const permission = await this.agentShareService.getSharePermission(userId, agentId);
      if (permission !== 'write') {
        throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_FORBIDDEN);
      }
    }

    // Validate agent type if changing
    if (dto.agentType) {
      const agentType = await this.agentTypeService.findById(dto.agentType);
      if (!agentType || !agentType.isActive) {
        throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND);
      }
    }

    // Uniqueness is scoped to the agent's owner, not the (possibly shared) editor.
    if (dto.name && dto.name !== agent.name) {
      const duplicate = await this.agentRepository.findByNameAndOwner(dto.name, ownerId);
      if (duplicate) {
        throw new ConflictException(ErrorCode.CUSTOM_AGENT_ALREADY_EXISTS);
      }
    }

    const normalizedSlug = dto.slug ? this.normalizeSlug(dto.slug) : undefined;

    if (normalizedSlug && normalizedSlug !== agent.slug) {
      await this.ensureSlugUniqueness(normalizedSlug, false, ownerId, agentId);
    }

    // Ensure only one default-for-type per user per agent type
    if (dto.isDefaultForType === true) {
      const effectiveAgentTypeId = dto.agentType || agent.agentType.toString();
      await this.ensureDefaultForTypeUniqueness(effectiveAgentTypeId, true, ownerId, agentId);
    }

    await this.skillService.findByIds([...(dto.skills ?? []), ...(dto.disabledSkills ?? [])]);

    const agentTypeSlug = dto.agentType ? await this.resolveAgentTypeSlug(dto.agentType) : undefined;
    const patch = this.dtoToUpdateInput(dto, agent, { agentTypeSlug, normalizedSlug });
    const updated = await this.agentRepository.updateById(agentId, patch);

    if (!updated) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }

    // Re-index the role embedding only when name/role actually changed (humain agents only).
    if (dto.name !== undefined || dto.role !== undefined) {
      this.agentRoleEmbedding.reindexHumainRole(updated._id, updated.agentTypeSlug, updated.name, updated.role);
    }

    this.logger.log('Personal agent updated', {
      agentId,
      userId,
      changes: Object.keys(dto),
    });

    return this.toResponse((await this.hydrateOne(updated))!);
  }

  async deletePersonal(userId: string, agentId: string): Promise<void> {
    const agent = await this.agentRepository.findById(agentId);

    if (!agent) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }

    if (agent.isDefault) {
      throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_DEFAULT_READONLY);
    }

    if (agent.createdBy.toString() !== userId) {
      throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_FORBIDDEN);
    }

    await this.agentRepository.deleteById(agentId);

    // Keep teams consistent: drop this agent from any team that referenced it.
    await this.teamService.removeAgentFromAllTeams(agentId);

    // Drop any shares pointing at the now-deleted agent.
    await this.agentShareService.removeAllSharesForAgent(agentId);

    this.logger.log('Personal agent deleted', {
      agentId,
      userId,
      name: agent.name,
    });
  }

  // ==========================================
  // Admin (default) methods
  // ==========================================

  async createDefault(adminUserId: string, dto: CreateAgentDto): Promise<IAgentResponse> {
    const agentType = await this.agentTypeService.findById(dto.agentType);
    if (!agentType || !agentType.isActive) {
      throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND);
    }

    // Check name uniqueness among default agents
    const existing = await this.agentRepository.findByNameDefault(dto.name);
    if (existing) {
      throw new ConflictException(ErrorCode.CUSTOM_AGENT_ALREADY_EXISTS);
    }

    const normalizedSlug = this.normalizeSlug(dto.slug || dto.name);

    await this.ensureSlugUniqueness(normalizedSlug, true);

    // Ensure only one default-for-type among admin agents
    if (dto.isDefaultForType) {
      await this.ensureDefaultForTypeUniqueness(dto.agentType, false);
    }

    await this.skillService.findByIds([...(dto.skills ?? []), ...(dto.disabledSkills ?? [])]);

    const id = new Types.ObjectId().toString();
    const agentTypeSlug = await this.resolveAgentTypeSlug(dto.agentType);
    const agent = await this.agentRepository.create(
      this.dtoToCreateInput(adminUserId, dto, { id, isDefault: true, slug: normalizedSlug, agentTypeSlug }),
    );

    this.logger.log('Default agent created', {
      agentId: agent._id.toString(),
      name: agent.name,
    });

    return this.toResponse((await this.hydrateOne(agent))!);
  }

  async findDefaultAgents(query: QueryAgentDto): Promise<PaginatedResponseDto<IAgentResponse>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const { items, total } = await this.agentRepository.listDefaultAgents({
      search: query.search,
      agentType: query.agentType,
      isActive: query.isActive,
      page,
      limit,
    });

    const hydrated = await this.hydrate(items);
    return new PaginatedResponseDto(
      hydrated.map((a) => this.toResponse(a)),
      total,
      page,
      limit,
    );
  }

  async findDefaultAgentById(agentId: string): Promise<IAgentResponse> {
    const agent = await this.agentRepository.findByIdDefault(agentId);

    if (!agent) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }

    return this.toResponse((await this.hydrateOne(agent))!);
  }

  async findDefaultByAgentType(agentTypeId: string): Promise<IAgentResponse | null> {
    const agent = await this.agentRepository.findDefaultByType(agentTypeId);
    if (!agent) return null;
    return this.toResponse((await this.hydrateOne(agent))!);
  }

  async findDefaultAgentByName(name: string): Promise<IAgentResponse | null> {
    const agent = await this.agentRepository.findDefaultByNameActive(name);
    if (!agent) return null;
    return this.toResponse((await this.hydrateOne(agent))!);
  }

  async updateDefault(agentId: string, dto: UpdateAgentDto): Promise<IAgentResponse> {
    const agent = await this.agentRepository.findByIdDefault(agentId);
    if (!agent) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }
    this.assertReservedPlatformCopilotIdentity(agent, dto);

    if (dto.agentType) {
      const agentType = await this.agentTypeService.findById(dto.agentType);
      if (!agentType || !agentType.isActive) {
        throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND);
      }
    }

    if (dto.name && dto.name !== agent.name) {
      const duplicate = await this.agentRepository.findByNameDefault(dto.name);
      if (duplicate) {
        throw new ConflictException(ErrorCode.CUSTOM_AGENT_ALREADY_EXISTS);
      }
    }

    const normalizedSlug = dto.slug ? this.normalizeSlug(dto.slug) : undefined;

    if (normalizedSlug && normalizedSlug !== agent.slug) {
      await this.ensureSlugUniqueness(normalizedSlug, true, undefined, agentId);
    }

    // Ensure only one default-for-type among admin agents
    if (dto.isDefaultForType === true) {
      const effectiveAgentTypeId = dto.agentType || agent.agentType.toString();
      await this.ensureDefaultForTypeUniqueness(effectiveAgentTypeId, false, undefined, agentId);
    }

    await this.skillService.findByIds([...(dto.skills ?? []), ...(dto.disabledSkills ?? [])]);

    const agentTypeSlug = dto.agentType ? await this.resolveAgentTypeSlug(dto.agentType) : undefined;
    const patch = this.dtoToUpdateInput(dto, agent, { agentTypeSlug, normalizedSlug });
    const updated = await this.agentRepository.updateById(agentId, patch);

    if (!updated) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }

    this.logger.log('Default agent updated', {
      agentId,
      changes: Object.keys(dto),
    });

    return this.toResponse((await this.hydrateOne(updated))!);
  }

  async deleteDefault(agentId: string): Promise<void> {
    const agent = await this.agentRepository.findByIdDefault(agentId);
    if (!agent) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }
    if (this.isReservedPlatformCopilotAgent(agent)) {
      throw new ForbiddenException(
        ErrorCode.CUSTOM_AGENT_DEFAULT_READONLY,
        'Platform Copilot technical identity is system-reserved',
      );
    }

    await this.agentRepository.deleteById(agentId);

    this.logger.log('Default agent deleted', {
      agentId,
      name: agent.name,
    });
  }

  // ==========================================
  // Stream integration (internal)
  // ==========================================

  async getAgentsForUser(userId: string): Promise<IAgentForStream[]> {
    // Get personal active agents + all active default agents
    const agents = await this.agentRepository.findForUser(userId);
    const hydrated = await this.hydrate(agents);
    return hydrated.map((agent) => this.toStreamAgent(agent));
  }

  /**
   * Builds the full gRPC-ready agent array for a user's stream request.
   * Fetches user agents, resolves tools per agent type, and assembles prompts.
   * Uses batch prompt resolution for efficiency (2 DB queries max).
   */
  async buildAgentsForStream(
    userId: string,
    fallbackModelId?: string,
    agentIds?: string[],
    sharedAgentIds?: string[],
    groupMembers?: any[],
    selectedConnectorId?: string,
    semanticSchemaName?: string,
    runtimeContext?: { conversationId: string; correlationId: string; playbookHandoffAttached?: boolean },
    reasoningEffort?: string,
    compaction?: IGrpcCompaction,
  ): Promise<IGrpcAgent[]> {
    this.logger.log('Building agents for stream', {
      userId,
      fallbackModelId,
      agentIds,
      sharedAgentIds,
      selectedConnectorId,
    });

    // Fetch personal + default agents. The untagged chat path also needs the
    // hidden mono-agent resolved from the DB (it never appears in the roster),
    // so start that query chain alongside the roster fetch to overlap the two
    // round-trip chains instead of stacking them.
    const monoAgentPromise = agentIds && agentIds.length > 0 ? null : this.resolveDefaultMonoAgent();
    // Detach a handled branch so a rejection before this promise is awaited
    // (e.g. the roster fetch failing first on the same DB blip) cannot surface
    // as an unhandledRejection — the backend treats that as fatal. Awaiting
    // the original below still propagates the error to the request.
    monoAgentPromise?.catch(() => undefined);
    const userAgents = await this.getAgentsForUser(userId);

    // Fetch shared agents if any
    let finalUserAgents = [...userAgents];
    if (sharedAgentIds && sharedAgentIds.length > 0) {
      const existingIds = new Set(userAgents.map((a) => a.id));
      const missingSharedIds = sharedAgentIds.filter((id) => !existingIds.has(id));

      if (missingSharedIds.length > 0) {
        const sharedAgents = await this.agentRepository.findByIds(missingSharedIds, { activeOnly: true });
        const hydratedShared = await this.hydrate(sharedAgents);
        const streamSharedAgents = hydratedShared.map((agent) => this.toStreamAgent(agent));
        finalUserAgents = [...finalUserAgents, ...streamSharedAgents];

        this.logger.log('Shared agents fetched for stream', {
          userId,
          sharedCount: streamSharedAgents.length,
        });
      }
    }

    // Include agents shared *with* this user when they tag one. getAgentsForUser
    // only returns owned + default agents, and the group toolbox (sharedAgentIds)
    // only covers agents already persisted to the conversation. Without this, a
    // tagged agent that was shared to the user resolves to no roster entry, so
    // pingedAgents is empty and the request silently falls back to the default
    // mono-agent — the reply then comes from the wrong agent.
    if (agentIds && agentIds.length > 0) {
      const availableIds = new Set(finalUserAgents.map((a) => a.id));
      const unresolvedTaggedIds = agentIds.filter((id) => !availableIds.has(id));

      if (unresolvedTaggedIds.length > 0) {
        // Authorize against the user's share grants — only add agents genuinely
        // shared to them, never an arbitrary id from the (untrusted) request.
        const shareMap = await this.agentShareService.getShareInfoMapForUser(userId);
        const authorizedSharedIds = unresolvedTaggedIds.filter((id) => shareMap.has(id));

        if (authorizedSharedIds.length > 0) {
          const sharedWithUserAgents = await this.agentRepository.findByIds(authorizedSharedIds, { activeOnly: true });
          const hydratedSharedWithUser = await this.hydrate(sharedWithUserAgents);

          finalUserAgents = [
            ...finalUserAgents,
            ...hydratedSharedWithUser.map((agent) => this.toStreamAgent(agent)),
          ];

          this.logger.log('Shared-with-user agents resolved for stream', {
            userId,
            unresolvedCount: unresolvedTaggedIds.length,
            authorizedCount: authorizedSharedIds.length,
          });
        }
      }
    }

    this.logger.log('Total available agents fetched', {
      userId,
      agentCount: finalUserAgents.length,
      personalCount: finalUserAgents.filter((a) => !a.isDefault).length,
      defaultCount: finalUserAgents.filter((a) => a.isDefault).length,
    });

    // Filter agents based on mentioned agentIds
    let pingedAgents: IAgentForStream[];
    if (agentIds && agentIds.length > 0) {
      const pingedSet = new Set(agentIds);
      pingedAgents = finalUserAgents.filter((a) => pingedSet.has(a.id));
    } else {
      pingedAgents = [];
    }

    // Resolve the roster based on how many agents the user tagged:
    //   - 0 tagged  → send only the mono-agent (the default-available agent of type "mono-agent")
    //   - 1 tagged  → send only that agent (no manager, even if the agent itself is a manager)
    //   - 2+ tagged → send those agents + the default available manager
    let filteredAgents: IAgentForStream[];
    let selectedManager: IAgentForStream | undefined;

    if (pingedAgents.length === 0) {
      // No agents tagged: route through RunSingleAgent with the admin-created
      // mono-agent (resolved via its agentType reference + isDefault). If no
      // "mono-agent" type/agent is configured, fall back to a single agent
      // (never the full roster) — the caller decides RunSingleAgent vs.
      // RunAgentTeam purely from roster size, so dumping every available
      // agent here would silently flip an untagged message to RunAgentTeam.
      const monoAgent = monoAgentPromise ? await monoAgentPromise : await this.resolveDefaultMonoAgent();
      if (monoAgent) {
        filteredAgents = [monoAgent];
      } else {
        // The manager is an orchestrator, not a standalone chat agent — never
        // let it be picked as the fallback single agent (only use it if it's
        // truly the only agent available at all).
        const managerSlug = this.canonicalSlug(MANAGER_SLUG);
        const nonManagerAgents = finalUserAgents.filter(
          (a) => this.canonicalSlug(a.agentTypeSlug) !== managerSlug,
        );
        const fallbackPool = nonManagerAgents.length > 0 ? nonManagerAgents : finalUserAgents;
        const fallbackAgent = fallbackPool.find((a) => a.isDefault) ?? fallbackPool[0];
        filteredAgents = fallbackAgent ? [fallbackAgent] : [];
      }
    } else if (pingedAgents.length === 1) {
      // Exactly one agent tagged: send only that agent
      filteredAgents = [...pingedAgents];
    } else {
      // More than one agent tagged: send those agents + the default available manager
      filteredAgents = [...pingedAgents];
      const manager = this.resolveManager(finalUserAgents, pingedAgents);
      if (manager && !filteredAgents.some((a) => a.id === manager.id)) {
        filteredAgents.push(manager);
      }
      selectedManager = manager;
    }

    this.logger.log('Agents filtered for stream', {
      userId,
      filteredCount: filteredAgents.length,
      taggedCount: pingedAgents.length,
      mentionedIds: agentIds,
      managerId: selectedManager?.id,
      managerName: selectedManager?.name,
    });

    // A chat-level model selection is the default only for untagged mono-agent
    // requests. Explicitly routed agents retain their configured model.
    const effectiveModelIdForAgent = (agent: IAgentForStream): string =>
      pingedAgents.length === 0
        ? fallbackModelId || agent.model || ''
        : agent.model || fallbackModelId || '';

    // Batch-resolve prompts: collect all (agentTypeId, modelId) pairs
    const promptPairs = filteredAgents
      .filter((a) => !a.ignorePrePrompt && a.agentTypeId)
      .map((a) => ({
        agentTypeId: a.agentTypeId,
        modelId: effectiveModelIdForAgent(a),
      }));

    // Collect ALL unique tool IDs across filtered agents and batch-fetch
    const allToolIds = [...new Set(filteredAgents.flatMap((a) => a.toolIds))];

    // Batch-fetch all unique model IDs to resolve full LiteLLM model identifiers
    const allModelIds = [...new Set(
      filteredAgents
        .map(effectiveModelIdForAgent)
        .filter(Boolean) as string[],
    )];

    const allConnectorIds = [
      ...new Set(
        filteredAgents
          .flatMap((agent) => agent.connectorIds || [])
          .concat(selectedConnectorId ? [selectedConnectorId] : [])
          .filter(Boolean) as string[],
      ),
    ];

    // Every lookup below depends only on the filtered roster, not on each
    // other — run them in one round so the remote-DB latency stacks once
    // instead of once per lookup.
    const [promptMap, fetchedTools, modelResults, connectorsMap, adminGuardrailsSettings, guardrailsClassifierModel, documentTreeSettings] = await Promise.all([
      this.agentTypeService.resolvePromptsInBatch(promptPairs),
      allToolIds.length > 0 ? this.toolService.findByIds(allToolIds) : Promise.resolve([] as IToolResponse[]),
      Promise.all(allModelIds.map((id) => this.modelsService.findById(id))),
      this.buildConnectorsMap(allConnectorIds),
      this.guardrailsSettingsService.getSettings(),
      this.modelsService.getGuardrailsClassifierModel(),
      this.systemService?.getDocumentTreeInjectionSettings() ?? Promise.resolve({ enabled: true }),
    ]);
    const guardrailsClassifierModelId = this.modelsService.getModelIdentifier(guardrailsClassifierModel);

    const toolsMap = new Map<string, IToolResponse>();
    for (const t of fetchedTools) toolsMap.set(t.id, t);

    const modelMap = new Map<string, { model: string; omitTemperature: boolean; inputModalities: string[]; maxInputTokens: number | null; reasoningEfforts: string[] }>();
    for (const m of modelResults) {
      if (m) {
        modelMap.set(m.id, {
          model: m.id,
          omitTemperature: m.omitTemperature,
          inputModalities: m.inputModalities,
          maxInputTokens: m.maxInputTokens,
          reasoningEfforts: m.supportsReasoning ? m.reasoning.efforts.map((effort) => effort.id) : [],
        });
      }
    }

    const agentsWithConnectorSkills = filteredAgents.map((agent) => ({
      ...agent,
      connectorSkillIds: this.getConnectorSkillIds(connectorsMap, [
        ...(agent.connectorIds || []),
        ...(selectedConnectorId ? [selectedConnectorId] : []),
      ]),
    }));
    const allSkillIds = [
      ...new Set(
        agentsWithConnectorSkills.flatMap((a) => [
          ...(a.agentTypeSkillIds ?? []),
          ...(a.skillIds ?? []),
          ...(a.connectorSkillIds ?? []),
        ]),
      ),
    ];
    const skillsMap = new Map<string, ISkillResponse>();
    if (allSkillIds.length > 0) {
      const fetchedSkills = await this.skillService.findByIds(allSkillIds);
      for (const skill of fetchedSkills) skillsMap.set(skill.id, skill);
    }

    const grpcAgents = await Promise.all(agentsWithConnectorSkills.map(async (agent) => {
      const agentTools = agent.toolIds
        .map((id) => toolsMap.get(id))
        .filter(Boolean) as IToolResponse[];

      this.logger.debug('Resolved tools for agent', {
        agentId: agent.id,
        agentName: agent.name,
        agentTypeName: agent.agentTypeName,
        toolCount: agentTools.length,
        toolNames: agentTools.map((t) => t.name),
      });

      const effectiveModelId = effectiveModelIdForAgent(agent);
      const resolvedModel = modelMap.get(effectiveModelId);
      const proxyModel = resolvedModel?.model || effectiveModelId;
      const requestedReasoningEffort = reasoningEffort && pingedAgents.length === 0
        ? reasoningEffort
        : agent.reasoningEffort;
      const effectiveReasoningEffort = requestedReasoningEffort
        && resolvedModel?.reasoningEfforts.includes(requestedReasoningEffort)
        ? requestedReasoningEffort
        : undefined;
      const effectiveSkills = this.resolveEffectiveSkills(agent, skillsMap);
      const effectiveConnectorIds = [
        ...new Set([...(agent.connectorIds || []), ...(selectedConnectorId ? [selectedConnectorId] : [])]),
      ];
      const connectorBindings = await this.buildConnectorBindings(
        connectorsMap,
        effectiveConnectorIds,
        userId,
        this.buildRuntimeConnectorActionKeysByConnectorId(agent, effectiveConnectorIds, connectorsMap),
        undefined,
        agent.id,
      );
      if (agent.agentTypeSlug === PLATFORM_COPILOT && runtimeContext) {
        for (const binding of connectorBindings) {
          binding.auth_headers = {
            ...((binding.auth_headers as Record<string, string> | undefined) ?? {}),
            'X-YellowStorm-User-Id': userId,
            'X-YellowStorm-Agent-Id': agent.id,
            'X-YellowStorm-Conversation-Id': runtimeContext.conversationId,
            'X-Correlation-Id': runtimeContext.correlationId,
          };
        }
      }
      const connectorToolDefs = this.buildConnectorToolDefs(connectorBindings);

      // Build prompt using batch-resolved prompts
      let prompt = '';
      if (!agent.ignorePrePrompt && agent.agentTypeId) {
        const resolvedKey = `${agent.agentTypeId}:${effectiveModelId}`;
        const resolvedPrompt = promptMap.get(resolvedKey) || '';
        prompt = resolvedPrompt;
        if (agent.instruction) {
          prompt += (prompt ? '\n\n' : '') + agent.instruction;
        }
      } else {
        prompt = agent.instruction || '';
      }
      if (agent.agentTypeSlug === PLATFORM_COPILOT
        && runtimeContext?.playbookHandoffAttached
        && !prompt.includes(PLATFORM_COPILOT_HANDOFF_RUNTIME_INSTRUCTION)) {
        prompt += `${prompt ? '\n\n' : ''}${PLATFORM_COPILOT_HANDOFF_RUNTIME_INSTRUCTION}`;
      }

      // Append Group Members info if provided
      const hasGroupMembers = groupMembers && groupMembers.length > 0;

      if (hasGroupMembers) {
        let membersContext = '\n\nConversation Members Context:\n';
        groupMembers.forEach((m) => {
          membersContext += `- Name: ${m.name}, Email: ${m.email}, Role: ${m.role}${m.job ? `, Job: ${m.job}` : ''}\n`;
        });
        prompt += membersContext;
      }
      const grpcAgent: IGrpcAgent = {
        id: agent.id,
        name: agent.name,
        description: agent.role || `you are the ${agent.name}`,
        prompt,
        agent_type: agent.agentTypeName.toLowerCase(),
        save_memory: false,
        tools: (await this.buildToolsWithTokens(agentTools, userId)).concat(connectorToolDefs),
        skills: effectiveSkills.map((skill) => this.toGrpcSkill(skill)),
        brain_context: agent.knowledgeBases.map((wsId) => ({
          workspace_id: wsId,
          workspace_documents: [],
        })),
        chatbot: {
          model: proxyModel,
          input_modalities: resolvedModel?.inputModalities || ['text'],
          ...(effectiveReasoningEffort ? { reasoning_effort: effectiveReasoningEffort } : {}),
          ...(resolvedModel?.maxInputTokens ? { context_window_tokens: resolvedModel.maxInputTokens } : {}),
          ...(compaction ? { compaction } : {}),
        },
        agent_params: {
          params: {
            user_id: userId,

            connector_bindings_json: JSON.stringify(connectorBindings),
            enable_temporary_child_agents: String(agent.enable_temporary_child_agents),
            max_temporary_child_agents: String(agent.max_temporary_child_agents),
            document_tree_injection_enabled: String(documentTreeSettings.enabled),
            guardrails_json: JSON.stringify({
              agent: normalizeAgentGuardrails(agent.guardrails),
              admin: normalizeAdminGuardrailsSettings(adminGuardrailsSettings),
              classifier: { omitTemperature: guardrailsClassifierModel?.omitTemperature === true },
            }),
            guardrails_classifier_model: guardrailsClassifierModelId,
            platform_api_url: this.configService.get<string>('PLATFORM_API_URL', 'http://localhost:3000/api'),
            platform_api_token: this.configService.get<string>('INTERNAL_SERVICE_SECRET', ''),
            ...(semanticSchemaName ? {
              semantic_model_schema_name: semanticSchemaName,
              semantic_search_url: `${this.configService.get<string>('SEMANTIC_SEARCH_URL', 'http://127.0.0.1:8100').replace(/\/$/, '')}/v1/graphs/search/fused`,
              semantic_search_token: this.configService.get<string>('SEMANTIC_SEARCH_TOKEN', ''),
              semantic_search_timeout_seconds: String(this.configService.get<number>('SEMANTIC_SEARCH_TIMEOUT_SECONDS', 300)),
            } : {}),
            ...(resolvedModel?.omitTemperature
              ? { omit_temperature: 'true' }
              : { temperature: String(agent.temperature) }),
          },
        },
        connectorIds: effectiveConnectorIds,
      };

      this.logger.debug('Agent built for stream', {
        agentId: grpcAgent.id,
        agentName: grpcAgent.name,
        agentType: grpcAgent.agent_type,
        model: grpcAgent.chatbot.model,
        toolCount: grpcAgent.tools.length,
        connectorToolCount: connectorToolDefs.length,
        connectorBindingCount: connectorBindings.length,
        promptLength: grpcAgent.prompt.length,
        ignorePrePrompt: agent.ignorePrePrompt,
        isDefault: agent.isDefault,
      });

      return grpcAgent;
    }));

    this.logger.log('Agents built for stream', {
      userId,
      totalAgents: grpcAgents.length,
      agents: grpcAgents.map((a) => ({
        name: a.name,
        type: a.agent_type,
        tools: a.tools.length,
      })),
    });

    return grpcAgents;
  }

  /**
   * Builds gRPC-ready agents for playbook execution.
   * Unlike buildAgentsForStream, this skips manager/filtering logic and builds
   * agents for the exact IDs provided, with full tool/model/prompt resolution.
   */
  async buildGrpcAgentsForPlaybook(
    userId: string,
    agentIds: string[],
    fallbackModelId?: string,
    sessionId?: string,
    runtimeContext?: {
      tenantId?: string;
      conversationId?: string;
      correlationId?: string;
      userId?: string;
      scopeType?: 'conversation' | 'playbook';
      scopeId?: string;
      laneId?: string;
      nodeId?: string;
      iteration?: number;
    },
  ): Promise<IGrpcAgent[]> {
    if (agentIds.length === 0) return [];

    this.logger.log('Building gRPC agents for playbook', { userId, agentIds, fallbackModelId });

    // Fetch agents by exact IDs (with agentType populated including slug)
    const agents = await this.agentRepository.findByIds(agentIds, { activeOnly: true });
    const hydratedAgents = await this.hydrate(agents);

    const streamAgents = hydratedAgents.map((agent) => this.toStreamAgent(agent));

    // Resolve the admin's default model once so inherited (empty) agent.model
    // values fall back to it instead of becoming a hardcoded "gpt-4o-mini"
    // on the ADK side (which 400s on the current Azure deployment).
    const inheritedDefaultModelId = fallbackModelId
      || this.modelsService.getModelIdentifier(await this.modelsService.getDefaultModel());

    // Batch-resolve prompts
    const promptPairs = streamAgents
      .filter((a) => !a.ignorePrePrompt && a.agentTypeId)
      .map((a) => ({
        agentTypeId: a.agentTypeId,
        modelId: a.model || inheritedDefaultModelId,
      }));
    const promptMap = await this.agentTypeService.resolvePromptsInBatch(promptPairs);

    // Batch-fetch tools
    const allToolIds = [...new Set(streamAgents.flatMap((a) => a.toolIds))];
    const toolsMap = new Map<string, IToolResponse>();
    if (allToolIds.length > 0) {
      const fetched = await this.toolService.findByIds(allToolIds);
      for (const t of fetched) toolsMap.set(t.id, t);
    }

    // Batch-resolve models
    const allModelIds = [...new Set(
      streamAgents
        .map((a) => a.model || inheritedDefaultModelId)
        .filter(Boolean) as string[],
    )];
    const modelMap = new Map<string, { model: string; omitTemperature: boolean; inputModalities: string[]; reasoningEfforts: string[] }>();
    if (allModelIds.length > 0) {
      const modelResults = await Promise.all(
        allModelIds.map((id) => this.modelsService.findById(id)),
      );
      for (const m of modelResults) {
        if (m) modelMap.set(m.id, {
          model: m.id,
          omitTemperature: m.omitTemperature,
          inputModalities: m.inputModalities,
          reasoningEfforts: m.supportsReasoning ? m.reasoning.efforts.map((effort) => effort.id) : [],
        });
      }
    }

    const allConnectorIds = [
      ...new Set(streamAgents.flatMap((agent) => agent.connectorIds || []).filter(Boolean) as string[]),
    ];
    const connectorsMap = await this.buildConnectorsMap(allConnectorIds);
    const agentsWithConnectorSkills = streamAgents.map((agent) => ({
      ...agent,
      connectorSkillIds: this.getConnectorSkillIds(connectorsMap, agent.connectorIds || []),
    }));
    const allSkillIds = [
      ...new Set(
        agentsWithConnectorSkills.flatMap((a) => [
          ...(a.agentTypeSkillIds ?? []),
          ...(a.skillIds ?? []),
          ...(a.connectorSkillIds ?? []),
        ]),
      ),
    ];
    const skillsMap = new Map<string, ISkillResponse>();
    if (allSkillIds.length > 0) {
      const fetchedSkills = await this.skillService.findByIds(allSkillIds);
      for (const skill of fetchedSkills) skillsMap.set(skill.id, skill);
    }

    const [adminGuardrailsSettings, guardrailsClassifierModel, documentTreeSettings] = await Promise.all([
      this.guardrailsSettingsService.getSettings(),
      this.modelsService.getGuardrailsClassifierModel(),
      this.systemService?.getDocumentTreeInjectionSettings() ?? Promise.resolve({ enabled: true }),
    ]);
    const guardrailsClassifierModelId = this.modelsService.getModelIdentifier(guardrailsClassifierModel);

    const grpcAgents = await Promise.all(
      agentsWithConnectorSkills.map(async (agent) => {
        const agentTools = agent.toolIds
          .map((id) => toolsMap.get(id))
          .filter(Boolean) as IToolResponse[];
        const connectorBindings = await this.buildConnectorBindings(
          connectorsMap,
          agent.connectorIds || [],
          userId,
          this.buildConnectorActionKeysByConnectorId(agent.connectorActionSelections),
          undefined,
          agent.id,
        );
        for (const binding of connectorBindings) {
          if (String(binding.connector_slug || '').toLowerCase() !== 'playbook-mcp') continue;
          binding.auth_headers = {
            ...((binding.auth_headers as Record<string, string>) || {}),
            'X-YellowStorm-Agent-Id': agent.id,
            'X-YellowStorm-Conversation-Id': runtimeContext?.conversationId || sessionId || 'playbook-runtime',
            'X-Correlation-Id': runtimeContext?.correlationId || sessionId || 'playbook-runtime',
          };
        }
        // Runtime scope identity for the Code Interpreter (MCP Manus) connector:
        // stamp x-sandbox-* so MCP Manus forwards it to the Runtime Coordinator.
        // Must run before connector_bindings_json is serialized below.
        if (
          runtimeContext?.scopeId &&
          runtimeContext.scopeType &&
          runtimeContext.userId &&
          runtimeContext.laneId
        ) {
          const scopeCtx: SandboxRuntimeContext = {
            userId: runtimeContext.userId,
            scopeType: runtimeContext.scopeType,
            scopeId: runtimeContext.scopeId,
            laneId: runtimeContext.laneId,
            nodeId: runtimeContext.nodeId,
            iteration: runtimeContext.iteration,
          };
          applySandboxScopeHeaders(
            connectorBindings as Array<{ connector_slug?: string; auth_headers?: Record<string, string> }>,
            scopeCtx,
            (b) => b.connector_slug,
          );
        }
        const connectorToolDefs = this.buildConnectorToolDefs(connectorBindings);

        const effectiveModelId = agent.model || inheritedDefaultModelId;
        const resolvedModel = modelMap.get(effectiveModelId);
        const proxyModel = resolvedModel?.model || effectiveModelId;
        const effectiveReasoningEffort = agent.reasoningEffort
          && resolvedModel?.reasoningEfforts.includes(agent.reasoningEffort)
          ? agent.reasoningEffort
          : undefined;
        const effectiveSkills = this.resolveEffectiveSkills(agent, skillsMap);

        let prompt = '';
        if (!agent.ignorePrePrompt && agent.agentTypeId) {
          const resolvedKey = `${agent.agentTypeId}:${effectiveModelId}`;
          const resolvedPrompt = promptMap.get(resolvedKey) || '';
          prompt = resolvedPrompt;
          if (agent.instruction) {
            prompt += (prompt ? '\n\n' : '') + agent.instruction;
          }
        } else {
          prompt = agent.instruction || '';
        }

        const grpcAgent: IGrpcAgent = {
          id: agent.id,
          name: agent.name,
          description: agent.role || `you are the ${agent.name}`,
          prompt,
          agent_type: agent.agentTypeName.toLowerCase(),
          save_memory: false,
          tools: (await this.buildToolsWithTokens(agentTools, userId)).concat(connectorToolDefs),
          skills: effectiveSkills.map((skill) => this.toGrpcSkill(skill)),
          brain_context: agent.knowledgeBases.map((wsId) => ({
            workspace_id: wsId,
            workspace_documents: [],
          })),
          chatbot: {
            model: proxyModel,
            input_modalities: resolvedModel?.inputModalities || ['text'],
            ...(effectiveReasoningEffort ? { reasoning_effort: effectiveReasoningEffort } : {}),
          },
          agent_params: {
            params: {
              user_id: userId,
              enable_temporary_child_agents: String(agent.enable_temporary_child_agents),
              max_temporary_child_agents: String(agent.max_temporary_child_agents),
              document_tree_injection_enabled: String(documentTreeSettings.enabled),
              connector_bindings_json: JSON.stringify(connectorBindings),
              guardrails_json: JSON.stringify({
                agent: normalizeAgentGuardrails(agent.guardrails),
                admin: normalizeAdminGuardrailsSettings(adminGuardrailsSettings),
                classifier: { omitTemperature: guardrailsClassifierModel?.omitTemperature === true },
              }),
              guardrails_classifier_model: guardrailsClassifierModelId,
              ...(sessionId ? { session_id: sessionId } : {}),
              platform_api_url: this.configService.get<string>('PLATFORM_API_URL', 'http://localhost:3000/api'),
              platform_api_token: this.configService.get<string>('INTERNAL_SERVICE_SECRET', ''),
              ...(resolvedModel?.omitTemperature
                ? { omit_temperature: 'true' }
                : { temperature: String(agent.temperature) }),
            },
          },
          connector_bindings: connectorBindings,
          connectorIds: agent.connectorIds || [],
        };

        return grpcAgent;
      }),
    );

    this.logger.log('gRPC agents built for playbook', {
      userId,
      totalAgents: grpcAgents.length,
      agents: grpcAgents.map((a) => ({
        name: a.name,
        type: a.agent_type,
        tools: a.tools.length,
        brainContexts: a.brain_context.length,
      })),
    });

    return grpcAgents;
  }

  /** Trusted governed-runtime path: exact published roster with pinned knowledge. */
  async buildGovernedAgentsForStream(userId: string, agentIds: string[], workspaceIds: string[], fallbackModelId?: string): Promise<IGrpcAgent[]> {
    const requestedIds = [...new Set(agentIds)];
    const agents = await this.buildGrpcAgentsForPlaybook(userId, requestedIds, fallbackModelId);
    const builtIds = new Set(agents.map((agent) => agent.id));
    if (requestedIds.some((id) => !builtIds.has(id))) {
      throw new NotFoundException(ErrorCode.AGENT_NOT_FOUND, 'One or more published assistants are unavailable');
    }
    return agents.map((agent) => ({
      ...agent,
      brain_context: workspaceIds.map((workspaceId) => ({ workspace_id: workspaceId, workspace_documents: [] })),
    }));
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
    return this.getConnectorRuntime().buildGrpcConnectorRuntimeForPlaybook(userId, toolBindings);
  }

  async buildGrpcSkillsForPlaybook(skillIds: string[]): Promise<Record<string, unknown>[]> {
    return this.getConnectorRuntime().buildGrpcSkillsForPlaybook(skillIds);
  }

  async getAllForUserResponse(userId: string): Promise<IAgentResponse[]> {
    const [agents, shareMap] = await Promise.all([
      this.agentRepository.findForUser(userId),
      this.agentShareService.getShareInfoMapForUser(userId),
    ]);

    const owned = (await this.hydrate(agents)).map((a) => this.toResponse(a));

    // Append agents shared with the user (active only), tagged with shareInfo.
    if (shareMap.size > 0) {
      const sharedAgents = await this.agentRepository.findByIds(Array.from(shareMap.keys()), { activeOnly: true });

      for (const doc of await this.hydrate(sharedAgents)) {
        const response = this.toResponse(doc);
        response.shareInfo = shareMap.get(response.id);
        owned.push(response);
      }
    }

    await this.applySmartMemoryFlag(owned);

    return owned;
  }

  /**
   * Flags each agent response with `hasSmartMemory` = true when at least one of
   * its connectors has the slug "smart-memory". Resolves the referenced
   * connectors in a single query. Slugs are unique per creator, so a global
   * lookup by slug is not reliable — we match against the agents' own connectors.
   */
  private async applySmartMemoryFlag(responses: IAgentResponse[]): Promise<void> {
    const allConnectorIds = [
      ...new Set(responses.flatMap((r) => r.connectors ?? [])),
    ];
    if (allConnectorIds.length === 0) return;

    const connectors = await this.connectorService.findByIds(allConnectorIds);
    const smartMemoryIds = new Set(
      connectors.filter((c) => c.slug === 'smart-memory').map((c) => c.id),
    );
    if (smartMemoryIds.size === 0) return;

    for (const response of responses) {
      response.hasSmartMemory = (response.connectors ?? []).some((id) =>
        smartMemoryIds.has(id),
      );
    }
  }

  /**
   * Whether the user may modify the given agent (owner, or shared at the
   * 'write' level). Default agents are treated as read-only here. Used to gate
   * agent-memory deletion so read-only recipients can view but not delete.
   */
  async canWriteAgent(userId: string, agentId: string): Promise<boolean> {
    const agent = await this.agentRepository.findById(agentId);
    if (!agent || agent.isDefault) return false;
    if (agent.createdBy?.toString() === userId) return true;
    const permission = await this.agentShareService.getSharePermission(userId, agentId);
    return permission === 'write';
  }

  async findByIds(ids: string[], userId: string): Promise<IAgentResponse[]> {
    const agents = await this.agentRepository.findByIdsForUser(ids, userId);
    return (await this.hydrate(agents)).map((a) => this.toResponse(a));
  }

  /**
   * Fetch agents by id WITHOUT an ownership filter. Used to populate agent
   * details on a team the caller has verified team-level access to (e.g. a
   * shared team) but whose agents they may not own. Callers must enforce that
   * team-level access themselves before calling this.
   */
  async findByIdsUnrestricted(ids: string[]): Promise<IAgentResponse[]> {
    const agents = await this.agentRepository.findByIds(ids, { activeOnly: true });
    return (await this.hydrate(agents)).map((a) => this.toResponse(a));
  }

  // ==========================================
  // Helper: check if agent type is in use
  // ==========================================

  async countByAgentType(agentTypeId: string): Promise<number> {
    return this.agentRepository.countByAgentType(agentTypeId);
  }

  // ==========================================
  // Private helpers: isDefaultForType
  // ==========================================

  private async ensureDefaultForTypeUniqueness(
    agentTypeId: string,
    isPersonal: boolean,
    userId?: string,
    excludeAgentId?: string,
  ): Promise<void> {
    await this.agentRepository.clearDefaultForType({
      agentTypeId,
      isPersonal,
      userId,
      excludeId: excludeAgentId,
    });
  }

  private normalizeSlug(value: string): string {
    return stripLeadingTrailingChar(
      collapseRepeatedChar(
        collapseWhitespace(
          value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim(),
          '-',
        )
          .replace(/[^a-z0-9-]/g, '-'),
        '-',
      ),
      '-',
    );
  }

  private async ensureSlugUniqueness(
    slug: string,
    isDefault: boolean,
    userId?: string,
    excludeAgentId?: string,
  ): Promise<void> {
    const existing = await this.agentRepository.findBySlug({
      slug,
      isDefault,
      userId,
      excludeId: excludeAgentId,
    });
    if (existing) {
      throw new ConflictException(ErrorCode.CUSTOM_AGENT_ALREADY_EXISTS);
    }
  }

  /**
   * Resolve exactly ONE manager agent to include in the stream.
   * See {@link resolveDefaultAgentBySlug} for the resolution priority.
   */
  private resolveManager(
    allAgents: IAgentForStream[],
    pingedAgents: IAgentForStream[],
  ): IAgentForStream | undefined {
    return this.resolveDefaultAgentBySlug(MANAGER_SLUG, allAgents, pingedAgents);
  }

  /**
   * Resolve exactly ONE agent of a given agent-type slug to include in the stream.
   * Priority (highest → lowest):
   *   1. An agent of this type explicitly pinged by the user (from mentionedAgentIds)
   *   2. User's personal default-for-type agent of this type
   *   3. First personal agent of this type in the list
   *   4. Admin default-for-type agent of this type
   *   5. First admin agent of this type in the list
   */
  /**
   * Canonicalize an agent-type slug so lookups are tolerant of the two slug
   * conventions in the codebase: agent-type slugs use "_" separators
   * (AgentTypeService.generateSlug) while the lookup constants use "-".
   */
  private canonicalSlug(value: string): string {
    return (value || '').toLowerCase().replace(/[-_\s]+/g, '_');
  }

  /**
   * Resolve the admin-created mono-agent sent when no agent is tagged.
   *
   * The mono-agent is a hidden system default: it is not part of any user's
   * personal/shared roster (it's deliberately excluded from agent listings so
   * it's not user-selectable), so it must be fetched directly from the
   * collection rather than searched for inside an already-resolved roster —
   * it will never be found there.
   *
   * Agents reference their type via the `agentType` ObjectId (→ agent-types
   * collection), so we resolve the "mono-agent" type id from that collection
   * first and then look up the admin default (isDefault=true) agent of that
   * type directly.
   */
  private async resolveDefaultMonoAgent(): Promise<IAgentForStream | undefined> {
    const target = this.canonicalSlug(MONO_AGENT_SLUG);
    const agentTypes = await this.agentTypeService.findAllActive();
    const monoType = agentTypes.find((t) => this.canonicalSlug(t.slug) === target);

    if (!monoType) {
      this.logger.warn('No "mono-agent" agent type found; cannot resolve mono-agent', {
        target,
        availableTypeSlugs: agentTypes.map((t) => t.slug),
      });
      return undefined;
    }

    const monoAgentDoc = await this.agentRepository.findDefaultByType(monoType.id);

    if (!monoAgentDoc) {
      this.logger.warn('No admin default agent of the "mono-agent" type is configured', {
        monoTypeId: monoType.id,
        monoTypeSlug: monoType.slug,
      });
      return undefined;
    }

    return this.toStreamAgent((await this.hydrateOne(monoAgentDoc))!);
  }

  private resolveDefaultAgentBySlug(
    slug: string,
    allAgents: IAgentForStream[],
    pingedAgents: IAgentForStream[] = [],
  ): IAgentForStream | undefined {
    const target = this.canonicalSlug(slug);
    const matches = (a: IAgentForStream) => this.canonicalSlug(a.agentTypeSlug) === target;

    // 1. If the user pinged an agent of this type, use it (first one if multiple)
    const pinged = pingedAgents.find(matches);
    if (pinged) return pinged;

    // Separate all matching agents into personal vs admin
    const personal = allAgents.filter((a) => matches(a) && !a.isDefault);
    const admin = allAgents.filter((a) => matches(a) && a.isDefault);

    // 2. User's personal default-for-type agent
    const personalDefault = personal.find((a) => a.isDefaultForType);
    if (personalDefault) return personalDefault;

    // 3. First personal agent
    if (personal.length > 0) return personal[0];

    // 4. Admin default-for-type agent
    const adminDefault = admin.find((a) => a.isDefaultForType);
    if (adminDefault) return adminDefault;

    // 5. First admin agent
    if (admin.length > 0) return admin[0];

    return undefined;
  }

  // ==========================================
  // Postgres hydration + DTO mapping helpers
  // ==========================================

  /** Replace each record's bare agentType id with a populated {_id,name,slug,skills}. */
  private async hydrate(records: AgentRecord[]): Promise<Array<Record<string, unknown>>> {
    const typeIds = [...new Set(records.map((r) => r.agentType).filter(Boolean))];
    const typeMap = await this.agentTypeService.getManyForHydration(typeIds);
    return records.map((r) => {
      const t = typeMap.get(r.agentType);
      return {
        ...r,
        agentType: t
          ? { _id: t.id, name: t.name, slug: t.slug, skills: t.skills }
          : { _id: r.agentType, name: '', slug: '', skills: [] },
      };
    });
  }

  private async hydrateOne(record: AgentRecord | null): Promise<Record<string, unknown> | null> {
    if (!record) return null;
    const [one] = await this.hydrate([record]);
    return one;
  }

  private async resolveAgentTypeSlug(agentTypeId: string): Promise<string> {
    const map = await this.agentTypeService.getManyForHydration([agentTypeId]);
    return map.get(agentTypeId)?.slug ?? '';
  }

  private dtoToCreateInput(
    userId: string,
    dto: CreateAgentDto,
    opts: { id: string; isDefault: boolean; slug: string; agentTypeSlug: string },
  ): CreateAgentInput {
    return {
      id: opts.id,
      name: dto.name,
      slug: opts.slug,
      agentType: dto.agentType,
      agentTypeSlug: opts.agentTypeSlug,
      role: dto.role,
      description: dto.description ?? '',
      temperature: dto.temperature ?? 0,
      llmModel: dto.model,
      reasoningEffort: dto.reasoning_effort || undefined,
      instruction: dto.instruction ?? '',
      ignorePrePrompt: dto.ignorePrePrompt ?? false,
      knowledgeBases: dto.knowledgeBases ?? [],
      tools: dto.tools ?? [],
      skills: dto.skills ?? [],
      disabledSkills: dto.disabledSkills ?? [],
      connectors: dto.connectors ?? [],
      connectorActionSelections: this.normalizeConnectorActionSelectionsForInput(dto.connectors, dto.connectorActionSelections),
      guardrails: (dto.guardrails as Record<string, unknown>) ?? {},
      deploymentSettings: this.normalizeDeploymentSettings(dto.deploymentSettings) as unknown as Record<string, unknown>,
      enable_temporary_child_agents: dto.enable_temporary_child_agents ?? false,
      max_temporary_child_agents: dto.max_temporary_child_agents ?? 4,
      isDefault: opts.isDefault,
      isActive: dto.isActive ?? true,
      isDefaultForType: dto.isDefaultForType ?? false,
      createdBy: userId,
    };
  }

  /** connectorActionSelections for the repository input: {connectorId, actionKeys} scoped to attached connectors. */
  private normalizeConnectorActionSelectionsForInput(
    connectorIds: string[] | undefined,
    selections?: Array<{ connectorId: string; actionKeys: string[] }>,
  ): Array<{ connectorId: string; actionKeys: string[] }> {
    if (!connectorIds?.length || !selections?.length) return [];
    const allowed = new Set(connectorIds);
    return selections
      .filter((s) => allowed.has(s.connectorId))
      .map((s) => ({ connectorId: s.connectorId, actionKeys: [...new Set((s.actionKeys || []).filter((k) => k?.trim()))] }))
      .filter((s) => s.actionKeys.length > 0);
  }

  private dtoToUpdateInput(
    dto: UpdateAgentDto,
    existing: AgentRecord,
    opts: { agentTypeSlug?: string; normalizedSlug?: string },
  ): UpdateAgentInput {
    const patch: UpdateAgentInput = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (opts.normalizedSlug !== undefined) patch.slug = opts.normalizedSlug;
    if (dto.agentType !== undefined) { patch.agentType = dto.agentType; patch.agentTypeSlug = opts.agentTypeSlug ?? ''; }
    if (dto.role !== undefined) patch.role = dto.role;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.temperature !== undefined) patch.temperature = dto.temperature;
    if ('model' in dto) patch.llmModel = dto.model || '';
    if ('reasoning_effort' in dto) patch.reasoningEffort = dto.reasoning_effort || null;
    if (dto.instruction !== undefined) patch.instruction = dto.instruction;
    if (dto.ignorePrePrompt !== undefined) patch.ignorePrePrompt = dto.ignorePrePrompt;
    if (dto.enable_temporary_child_agents !== undefined) patch.enable_temporary_child_agents = dto.enable_temporary_child_agents;
    if (dto.max_temporary_child_agents !== undefined) patch.max_temporary_child_agents = dto.max_temporary_child_agents;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;
    if (dto.isDefaultForType !== undefined) patch.isDefaultForType = dto.isDefaultForType;
    if (dto.knowledgeBases !== undefined) patch.knowledgeBases = dto.knowledgeBases;
    if (dto.tools !== undefined) patch.tools = dto.tools;
    if (dto.skills !== undefined) patch.skills = dto.skills;
    if (dto.disabledSkills !== undefined) patch.disabledSkills = dto.disabledSkills;
    if (dto.connectors !== undefined) patch.connectors = dto.connectors;
    if (dto.guardrails !== undefined) patch.guardrails = dto.guardrails as Record<string, unknown>;
    if (dto.connectorActionSelections !== undefined) {
      patch.connectorActionSelections = this.normalizeConnectorActionSelectionsForInput(
        dto.connectors ?? existing.connectors, dto.connectorActionSelections,
      );
    }
    if (dto.deploymentSettings !== undefined) {
      patch.deploymentSettings = this.normalizeDeploymentSettings(
        dto.deploymentSettings, existing.deploymentSettings,
      ) as unknown as Record<string, unknown>;
    }
    return patch;
  }

  // ==========================================
  // Private mapping helpers
  // ==========================================

  private normalizeDeploymentSettings(settings?: {
    embedEnabled?: boolean;
    restEnabled?: boolean;
    widget?: unknown;
  }, existing?: {
    embedEnabled?: boolean;
    restEnabled?: boolean;
    widget?: unknown;
  }): { embedEnabled: boolean; restEnabled: boolean; widget: ReturnType<typeof normalizeWidgetSettings> } {
    return {
      embedEnabled: settings?.embedEnabled ?? existing?.embedEnabled ?? false,
      restEnabled: settings?.restEnabled ?? existing?.restEnabled ?? false,
      widget: normalizeWidgetSettings((settings?.widget ?? existing?.widget) as Parameters<typeof normalizeWidgetSettings>[0]),
    };
  }

  async listActiveDefaultAgentOptions(): Promise<Array<{ id: string; name: string; description?: string; agentTypeName?: string; model?: string }>> {
    const agents = await this.agentRepository.findActiveDefaults();
    const hydrated = await this.hydrate(agents);
    return hydrated.map((agent) => {
      const agentType = agent.agentType as unknown as { name?: string } | undefined;
      return { id: agent._id as string, name: agent.name as string, description: (agent.description as string) || undefined, agentTypeName: agentType?.name, model: agent.llmModel as string | undefined };
    });
  }

  async assertActiveDefaultAgent(agentId: string): Promise<void> {
    if (!Types.ObjectId.isValid(agentId)) {
      throw new BadRequestException(ErrorCode.AGENT_UNAVAILABLE, 'The selected decision-flow agent is invalid');
    }
    const exists = await this.agentRepository.existsActiveDefault(agentId);
    if (!exists) {
      throw new BadRequestException(ErrorCode.AGENT_UNAVAILABLE, 'The selected decision-flow agent must be an active default agent');
    }
  }

  async findActivePlatformCopilotAgentId(): Promise<string | null> {
    return this.agentRepository.findActiveDefaultIdBySlugAndType(PLATFORM_COPILOT_AGENT_SLUG, PLATFORM_COPILOT);
  }

  private isReservedPlatformCopilotAgent(agent: AgentRecord): boolean {
    return agent.isDefault
      && agent.slug === PLATFORM_COPILOT_AGENT_SLUG
      && agent.agentTypeSlug === PLATFORM_COPILOT;
  }

  private assertReservedPlatformCopilotIdentity(agent: AgentRecord, dto: UpdateAgentDto): void {
    if (!this.isReservedPlatformCopilotAgent(agent)) return;
    const changesIdentity = (dto.slug !== undefined && dto.slug !== PLATFORM_COPILOT_AGENT_SLUG)
      || (dto.agentType !== undefined && dto.agentType !== agent.agentType)
      || dto.isActive === false
      || dto.isDefaultForType === false;
    if (changesIdentity) {
      throw new ForbiddenException(
        ErrorCode.CUSTOM_AGENT_DEFAULT_READONLY,
        'Platform Copilot technical identity is system-reserved',
      );
    }
  }

  async listPlaybookPlannerAgentOptions(): Promise<PlaybookPlannerAgentOption[]> {
    const agents = await this.agentRepository.findActiveDefaults();
    return agents.map((agent) => {
      const model = agent.llmModel?.trim() || null;
      return {
        id: agent._id,
        name: agent.name,
        description: agent.description || undefined,
        model,
      };
    });
  }

  async findPlaybookPlannerById(agentId: string): Promise<PlaybookPlannerAgentConfig> {
    if (!Types.ObjectId.isValid(agentId)) {
      throw new BadRequestException(ErrorCode.PLAYBOOK_PLANNER_UNAVAILABLE, 'The selected Playbook Planner agent is invalid');
    }
    const record = await this.agentRepository.findById(agentId);
    const agentType = record
      ? (await this.agentTypeService.getManyForHydration([record.agentType])).get(record.agentType)
      : undefined;
    const model = record?.llmModel?.trim();
    if (
      !record
      || !record.isDefault
      || !record.isActive
      || !agentType
    ) {
      throw new BadRequestException(ErrorCode.PLAYBOOK_PLANNER_UNAVAILABLE, 'The selected Playbook Planner agent is unavailable or has no model configured');
    }
    return {
      agentTypeId: agentType.id,
      agentTypeSlug: agentType.slug,
      agentId: record._id,
      agentRevision: record.updatedAt?.toISOString() ?? record._id,
      model: model || null,
      temperature: record.temperature,
      instruction: record.instruction,
    };
  }

  private toResponse(
    doc: Record<string, unknown>,
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
      reasoning_effort: d.reasoningEffort as string | undefined,
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
      guardrails: normalizeAgentGuardrails(d.guardrails as Parameters<typeof normalizeAgentGuardrails>[0]),
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

  private toStreamAgent(doc: Record<string, unknown>): IAgentForStream {
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
      reasoningEffort: d.reasoningEffort as string | undefined,
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
      guardrails: normalizeAgentGuardrails(d.guardrails as Parameters<typeof normalizeAgentGuardrails>[0]),
      agentTypeSkillIds,
      enable_temporary_child_agents: (d.enable_temporary_child_agents as boolean) ?? false,
      max_temporary_child_agents: (d.max_temporary_child_agents as number) ?? 4,
      isDefault: (d.isDefault as boolean) || false,
      isDefaultForType: (d.isDefaultForType as boolean) || false,
    };
  }


  private resolveEffectiveSkills(
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

  private getConnectorSkillIds(
    connectorsMap: Map<string, IConnectorResponse>,
    connectorIds: string[],
  ): string[] {
    return this.getConnectorRuntime().getConnectorSkillIds(connectorsMap, connectorIds);
  }

  private toConnectorActionSelectionResponses(
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

  private normalizeConnectorActionSelections(
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

  private buildConnectorActionKeysByConnectorId(
    selections?: Array<{ connectorId: string; actionKeys: string[] }>,
  ): Map<string, Set<string>> | undefined {
    if (!selections?.length) {
      return undefined;
    }

    return new Map(
      selections.map((selection) => [selection.connectorId, new Set(selection.actionKeys)]),
    );
  }

  private buildRuntimeConnectorActionKeysByConnectorId(
    agent: Pick<IAgentForStream, 'agentTypeSlug' | 'connectorActionSelections'>,
    connectorIds: string[],
    connectorsMap: Map<string, IConnectorResponse>,
  ): Map<string, Set<string>> | undefined {
    const selected = this.buildConnectorActionKeysByConnectorId(agent.connectorActionSelections);
    if (agent.agentTypeSlug !== PLATFORM_COPILOT) return selected;

    const runtimeSelections = new Map(selected ?? []);
    for (const connectorId of connectorIds) {
      const connector = connectorsMap.get(connectorId);
      if (connector?.slug?.toLowerCase() === PLATFORM_COPILOT_PLAYBOOK_CONNECTOR_SLUG) {
        runtimeSelections.delete(connectorId);
      }
    }
    return runtimeSelections.size ? runtimeSelections : undefined;
  }

  private toGrpcSkill(skill: ISkillResponse): Record<string, unknown> {
    return this.getConnectorRuntime().toGrpcSkill(skill);
  }

  /**
   * Build tool objects for gRPC with accessToken injection for tools that require connected apps.
   */
  private async buildToolsWithTokens(
    tools: IToolResponse[],
    userId: string,
  ): Promise<Record<string, unknown>[]> {
    return Promise.all(
      tools.map(async (t) => {
        const toolObj: Record<string, unknown> = {
          name: t.name,
          description: t.description,
        };
        for (const attr of t.attributes || []) {
          toolObj[attr.name] = attr.value;
        }
        if (t.requiredAppKey) {
          try {
            toolObj.accessToken = await this.connectedAppTokenService.getValidToken(
              userId,
              t.requiredAppKey,
            );
          } catch {
            this.logger.warn('Could not inject accessToken for tool', {
              toolName: t.name,
              appKey: t.requiredAppKey,
              userId,
            });
          }
        }
        return toolObj;
      }),
    );
  }

  private async buildConnectorsMap(connectorIds: string[]): Promise<Map<string, IConnectorResponse>> {
    return this.getConnectorRuntime().buildConnectorsMap(connectorIds);
  }

  private async buildConnectorBindings(
    connectorsMap: Map<string, IConnectorResponse>,
    connectorIds: string[] = [],
    userId?: string,
    actionKeysByConnectorId?: Map<string, Set<string>>,
    fixedParamsByConnectorId?: Map<string, Record<string, unknown>>,
    agentId?: string,
  ): Promise<Record<string, unknown>[]> {
    return this.getConnectorRuntime().buildConnectorBindings(
      connectorsMap,
      connectorIds,
      userId,
      actionKeysByConnectorId,
      fixedParamsByConnectorId,
      agentId,
    );
  }

  private buildConnectorToolDefs(bindings: Record<string, unknown>[]): Record<string, unknown>[] {
    return this.getConnectorRuntime().buildConnectorToolDefs(bindings);
  }

  private getConnectorRuntime(): AgentConnectorRuntimeService {
    if (this.connectorRuntimeService) {
      return this.connectorRuntimeService;
    }
    this.fallbackConnectorRuntimeService ??= new AgentConnectorRuntimeService(
      this.logger,
      this.skillService,
      this.connectorService,
      this.connectorAuthService,
      this.configService,
    );
    return this.fallbackConnectorRuntimeService;
  }
}
