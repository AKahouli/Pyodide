import {
  Injectable,
  Inject,
  forwardRef,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery, Types } from 'mongoose';
import { Team, TeamDocument, TeamMember } from './schemas/team.schema';
import { CreateTeamDto, UpdateTeamDto, QueryTeamDto, UpdateHierarchyDto, GenerateTeamDto } from './dto';
import {
  ITeamResponse,
  ITeamMemberResponse,
  ITeamWithAgentsResponse,
  ITeamMemberWithAgentResponse,
  ISharedTeamInfo,
} from './interfaces/team.interface';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { escapeRegex } from '../../common/utils';
import { LoggerService } from '../logger';
import { AgentService } from '../agent/agent.service';
import { IAgentResponse } from '../agent/interfaces/agent.interface';
import { CreateAgentDto } from '../agent/dto/create-agent.dto';
import { ChatCompletionService } from '../chat-completion/chat-completion.service';
import { AgentTypeService } from '../agent-type/agent-type.service';
import { ToolService } from '../tool/tool.service';
import { ModelsService } from '../models/models.service';
import { TeamShareService } from './services/team-share.service';
import { TeamAutoBuilderConfigService } from './services/team-auto-builder-config.service';
import { TeamExecutionDefinition, TeamExecutionNode, validateExecutableTeam } from './team-execution';

/** Fields stripped from a real agent when building the AI template. */
const AGENT_TEMPLATE_STRIP_FIELDS = new Set([
  'id', 'slug', 'isDefault', 'isDefaultForType', 'isActive',
  'createdBy', 'createdAt', 'updatedAt', 'knowledgeBases',
  'a2aPublished', 'a2aAgentCardUrl',
]);

/** Subset of agent fields surfaced on populated org-chart members. */
type MemberAgentInfo = {
  id: string;
  name: string;
  agentType: { id: string; name: string; slug: string };
  role: string;
  description: string;
};

/**
 * Teams are user-owned groups of agents organised as a hierarchy (org-chart).
 * They serve conversation mentions — a `@TeamName` mention is expanded into the
 * team's agents at send time (see `resolveAgentIds`) — and an editable org-chart
 * (`updateHierarchy`).
 *
 * The service depends on AgentService (via forwardRef, since agent → team
 * already exists for delete cleanup) only to populate agent details on the
 * org-chart and validate membership. Access to each resolved agent is still
 * enforced downstream when streaming.
 */
@Injectable()
export class TeamService {
  constructor(
    @InjectModel(Team.name)
    private readonly teamModel: Model<TeamDocument>,
    private readonly logger: LoggerService,
    @Inject(forwardRef(() => AgentService))
    private readonly agentService: AgentService,
    private readonly teamShareService: TeamShareService,
    private readonly chatCompletionService: ChatCompletionService,
    private readonly autoBuilderConfigService: TeamAutoBuilderConfigService,
    private readonly agentTypeService: AgentTypeService,
    private readonly toolService: ToolService,
    private readonly modelsService: ModelsService,
  ) {
    this.logger.setContext(TeamService.name);
  }

  async create(userId: string, dto: CreateTeamDto): Promise<ITeamResponse> {
    const existing = await this.teamModel
      .findOne({ name: dto.name, createdBy: new Types.ObjectId(userId) })
      .lean()
      .exec();
    if (existing) {
      throw new ConflictException(ErrorCode.TEAM_ALREADY_EXISTS);
    }

    const team = await this.teamModel.create({
      name: dto.name,
      description: dto.description ?? '',
      members: this.agentIdsToMembers(dto.agentIds),
      isActive: true,
      createdBy: new Types.ObjectId(userId),
    });

    this.logger.log('Team created', { teamId: team._id.toString(), name: team.name, userId });
    return this.toResponse(team);
  }

  async findUserTeams(userId: string, query: QueryTeamDto): Promise<PaginatedResponseDto<ITeamResponse>> {
    const filter: FilterQuery<TeamDocument> = { createdBy: new Types.ObjectId(userId) };

    if (query.search) {
      filter.name = { $regex: escapeRegex(query.search), $options: 'i' };
    }
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const [teams, total] = await Promise.all([
      this.teamModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
      this.teamModel.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponseDto(teams.map((t) => this.toResponse(t)), total, page, limit);
  }

  /**
   * All active teams the user can see (owned + shared), unpaginated. Used by the
   * teams list and the mention picker. Shared teams carry their `shareInfo`.
   */
  async findAllForUser(userId: string): Promise<ITeamResponse[]> {
    const [owned, shared] = await Promise.all([
      this.teamModel
        .find({ createdBy: new Types.ObjectId(userId), isActive: true })
        .sort({ createdAt: -1 })
        .lean()
        .exec(),
      this.teamShareService.getSharedTeamsForUser(userId),
    ]);
    return [...owned.map((t) => this.toResponse(t)), ...shared];
  }

  /**
   * Get a team with each member enriched with its agent details (org-chart).
   * Accessible to the owner and to users it has been shared with (read/write);
   * for shared viewers, agent details are loaded without an ownership filter.
   */
  async findUserTeamById(userId: string, teamId: string): Promise<ITeamWithAgentsResponse> {
    if (!Types.ObjectId.isValid(teamId)) {
      throw new NotFoundException(ErrorCode.TEAM_NOT_FOUND);
    }
    const team = await this.teamModel.findById(teamId).lean().exec();
    if (!team) {
      throw new NotFoundException(ErrorCode.TEAM_NOT_FOUND);
    }

    const isOwner = team.createdBy.toString() === userId;
    let shareInfo: ISharedTeamInfo | undefined;
    if (!isOwner) {
      const info = await this.teamShareService.getShareInfo(userId, teamId);
      if (!info) {
        throw new ForbiddenException(ErrorCode.TEAM_FORBIDDEN);
      }
      shareInfo = info;
    }

    const obj = team as unknown as Record<string, unknown>;
    const agentIds = this.readMembers(obj).map((m) => m.agentId.toString());
    const agentMap = isOwner
      ? await this.buildAgentMap(agentIds, userId)
      : await this.buildAgentMapForTeamAccess(agentIds);

    const response = this.toResponseWithAgents(obj, agentMap);
    if (shareInfo) response.shareInfo = shareInfo;
    return response;
  }

  async update(userId: string, teamId: string, dto: UpdateTeamDto): Promise<ITeamResponse> {
    const team = await this.loadTeamForWrite(userId, teamId);

    if (dto.name !== undefined && dto.name !== team.name) {
      // Name must be unique within the owner's namespace (not the editor's).
      const clash = await this.teamModel
        .findOne({ name: dto.name, createdBy: team.createdBy, _id: { $ne: team._id } })
        .lean()
        .exec();
      if (clash) {
        throw new ConflictException(ErrorCode.TEAM_ALREADY_EXISTS);
      }
      team.name = dto.name;
    }

    if (dto.description !== undefined) team.description = dto.description;
    if (dto.isActive !== undefined) team.isActive = dto.isActive;
    // Editing the agent list from the simple dialog: reconcile against the
    // existing hierarchy so positions/parents are preserved for kept agents.
    if (dto.agentIds !== undefined) {
      team.members = this.reconcileMembers(team.members, dto.agentIds);
    }

    await team.save();
    this.logger.log('Team updated', { teamId, userId });
    return this.toResponse(team);
  }

  /** Replace the whole hierarchy (org-chart save). Validates structure + access. */
  async updateHierarchy(userId: string, teamId: string, dto: UpdateHierarchyDto): Promise<ITeamResponse> {
    const team = await this.loadTeamForWrite(userId, teamId);
    const isOwner = team.createdBy.toString() === userId;
    const existingAgentIds = team.members.map((m) => m.agentId.toString());
    const { members } = dto;

    const agentIds = members.map((m) => m.agentId);

    // No duplicate agents.
    if (new Set(agentIds).size !== agentIds.length) {
      throw new BadRequestException(ErrorCode.TEAM_DUPLICATE_AGENT);
    }

    // No self-references, and every parent must be part of the members set.
    const agentIdSet = new Set(agentIds);
    for (const m of members) {
      if (m.parentAgentId && m.agentId === m.parentAgentId) {
        throw new BadRequestException(ErrorCode.TEAM_SELF_REFERENCE);
      }
      if (m.parentAgentId && !agentIdSet.has(m.parentAgentId)) {
        throw new BadRequestException(ErrorCode.TEAM_AGENT_NOT_FOUND);
      }
    }

    // No cycles.
    if (this.detectCycle(members)) {
      throw new BadRequestException(ErrorCode.TEAM_CYCLE_DETECTED);
    }

    // Agents must exist; the owner must own them, a write-shared user only needs
    // to own any newly-added agents (existing ones were already validated).
    if (agentIds.length > 0) {
      if (isOwner) {
        await this.validateAgentsExist(agentIds, userId);
      } else {
        await this.validateAgentsForSharedTeam(agentIds, userId, existingAgentIds);
      }
    }

    team.members = members.map((m) => ({
      agentId: new Types.ObjectId(m.agentId),
      parentAgentId: m.parentAgentId ? new Types.ObjectId(m.parentAgentId) : null,
      order: m.order ?? 0,
      positionX: m.positionX ?? 0,
      positionY: m.positionY ?? 0,
    })) as TeamMember[];

    await team.save();
    this.logger.log('Team hierarchy updated', { teamId, userId, memberCount: members.length });

    const agentMap = isOwner
      ? await this.buildAgentMap(agentIds, userId)
      : await this.buildAgentMapForTeamAccess(agentIds);
    return this.toResponseWithAgents(team, agentMap);
  }

  async delete(userId: string, teamId: string): Promise<void> {
    const team = await this.getOwnedTeam(userId, teamId);
    await Promise.all([
      this.teamModel.findByIdAndDelete(team._id).exec(),
      this.teamShareService.removeAllSharesForTeam(teamId),
    ]);
    this.logger.log('Team deleted', { teamId, userId });
  }

  // ==========================================
  // AI generation (auto-builder)
  // ==========================================

  /**
   * Generate a team (and any missing agents) from a natural-language prompt via
   * the configured LLM. Creates new agents the AI proposes, resolves the
   * hierarchy, validates it, and persists the team.
   */
  async generateTeam(userId: string, dto: GenerateTeamDto): Promise<ITeamWithAgentsResponse> {
    const config = await this.autoBuilderConfigService.getConfig();
    if (!config || !config.isEnabled) {
      throw new BadRequestException(ErrorCode.TEAM_AUTO_BUILDER_NOT_CONFIGURED);
    }

    const existing = await this.teamModel
      .findOne({ name: dto.name, createdBy: new Types.ObjectId(userId) })
      .lean()
      .exec();
    if (existing) {
      throw new ConflictException(ErrorCode.TEAM_ALREADY_EXISTS);
    }

    const [agents, agentTypes, tools, modelsData] = await Promise.all([
      this.agentService.getAllForUserResponse(userId),
      this.agentTypeService.findAllActive(),
      this.toolService.findAllActive(),
      this.modelsService.findAll(true),
    ]);

    const agentContext = agents.length > 0
      ? agents
          .map((a) => `- Agent ID: "${a.id}", Name: "${a.name}", Type: "${a.agentType?.name || 'unknown'}", Role: "${a.role}", Description: "${a.description}"`)
          .join('\n')
      : '(No existing agents)';

    const agentTemplate = this.buildAgentTemplate(agents[0]);
    const outputInstruction = this.buildOutputFormatInstruction(
      agentTemplate,
      agentTypes,
      tools,
      modelsData.models,
    );

    const userMessage = `User request: ${dto.prompt}\n\nExisting agents available for reuse:\n${agentContext}`;
    const systemPrompt = `${config.systemPrompt}\n\n${outputInstruction}`;

    let aiContent: string;
    try {
      const result = await this.chatCompletionService.complete({
        messages: [{ role: 'user', content: userMessage }],
        modelId: config.modelId,
        systemPrompt,
        temperature: config.temperature,
      });
      aiContent = result.content;
      this.logger.log('Team auto-builder AI call succeeded', {
        userId,
        teamName: dto.name,
        model: result.model,
        tokens: result.usage.totalTokens,
        latencyMs: result.latencyMs,
      });
    } catch (error) {
      this.logger.error('Team auto-builder AI call failed', {
        userId,
        teamName: dto.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new InternalServerErrorException(ErrorCode.TEAM_GENERATE_FAILED);
    }

    let parsed: {
      newAgents: Array<{ tempId: string; [key: string]: unknown }>;
      members: Array<{ agentId: string; parentAgentId: string | null; order: number }>;
    };
    try {
      parsed = this.parseAiResponse(aiContent);
    } catch {
      this.logger.error('Team auto-builder failed to parse AI response', {
        userId,
        teamName: dto.name,
        aiContent: aiContent.substring(0, 500),
      });
      throw new BadRequestException(ErrorCode.TEAM_GENERATE_FAILED);
    }

    // Create new agents and map temp IDs ($1, $2…) to real IDs.
    const tempIdMap = new Map<string, string>();
    for (const newAgent of parsed.newAgents) {
      const { tempId, ...agentFields } = newAgent;
      if (!tempId || typeof tempId !== 'string' || !tempId.startsWith('$')) {
        throw new BadRequestException(ErrorCode.TEAM_GENERATE_FAILED);
      }

      // If an agent with the same name already exists (e.g. left over from a
      // previous generation), reuse it instead of creating a duplicate. This
      // avoids name/slug collisions and keeps re-runs idempotent.
      const proposedName = typeof agentFields.name === 'string' ? agentFields.name.trim() : '';
      const existingByName = proposedName
        ? agents.find((a) => a.name.trim().toLowerCase() === proposedName.toLowerCase())
        : undefined;
      if (existingByName) {
        tempIdMap.set(tempId, existingByName.id);
        this.logger.log('Auto-builder reused an existing agent by name', {
          tempId,
          agentId: existingByName.id,
          name: existingByName.name,
        });
        continue;
      }

      try {
        const createDto = {
          name: agentFields.name,
          agentType: typeof agentFields.agentType === 'object' && agentFields.agentType !== null
            ? (agentFields.agentType as { id: string }).id
            : agentFields.agentType,
          role: agentFields.role,
          description: agentFields.description,
          temperature: agentFields.temperature,
          model: agentFields.model,
          instruction: agentFields.instruction,
          ignorePrePrompt: agentFields.ignorePrePrompt,
          tools: agentFields.tools,
        } as CreateAgentDto;
        const created = await this.agentService.createPersonal(userId, createDto);
        tempIdMap.set(tempId, created.id);
      } catch (error) {
        this.logger.error('Auto-builder failed to create agent', {
          tempId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new BadRequestException(ErrorCode.TEAM_GENERATE_FAILED);
      }
    }

    // Resolve temp IDs in the members array.
    const resolvedMembers = parsed.members.map((m) => ({
      agentId: m.agentId.startsWith('$') ? (tempIdMap.get(m.agentId) ?? m.agentId) : m.agentId,
      parentAgentId: m.parentAgentId
        ? (m.parentAgentId.startsWith('$') ? (tempIdMap.get(m.parentAgentId) ?? m.parentAgentId) : m.parentAgentId)
        : null,
      order: m.order,
    }));

    for (const m of resolvedMembers) {
      if (m.agentId.startsWith('$') || (m.parentAgentId && m.parentAgentId.startsWith('$'))) {
        throw new BadRequestException(ErrorCode.TEAM_GENERATE_FAILED);
      }
    }

    // Validate hierarchy.
    const allowedIds = new Set([...agents.map((a) => a.id), ...tempIdMap.values()]);
    for (const m of resolvedMembers) {
      if (!allowedIds.has(m.agentId) || (m.parentAgentId && !allowedIds.has(m.parentAgentId))) {
        throw new BadRequestException(ErrorCode.TEAM_AGENT_NOT_FOUND);
      }
      if (m.agentId === m.parentAgentId) {
        throw new BadRequestException(ErrorCode.TEAM_SELF_REFERENCE);
      }
    }
    if (new Set(resolvedMembers.map((m) => m.agentId)).size !== resolvedMembers.length) {
      throw new BadRequestException(ErrorCode.TEAM_DUPLICATE_AGENT);
    }
    if (this.detectCycle(resolvedMembers)) {
      throw new BadRequestException(ErrorCode.TEAM_CYCLE_DETECTED);
    }

    const selectedAgentIds = resolvedMembers.map((m) => m.agentId);
    const membersToStore: TeamMember[] = resolvedMembers.map((m) => ({
      agentId: new Types.ObjectId(m.agentId),
      parentAgentId: m.parentAgentId ? new Types.ObjectId(m.parentAgentId) : null,
      order: m.order ?? 0,
      positionX: 0,
      positionY: 0,
    })) as TeamMember[];

    const team = await this.teamModel.create({
      name: dto.name,
      description: dto.prompt,
      members: membersToStore,
      isActive: true,
      createdBy: new Types.ObjectId(userId),
    });

    this.logger.log('Team generated via auto-builder', {
      teamId: team._id.toString(),
      name: team.name,
      userId,
      memberCount: membersToStore.length,
      newAgentsCreated: tempIdMap.size,
    });

    const agentMap = await this.buildAgentMap(selectedAgentIds, userId);
    return this.toResponseWithAgents(team, agentMap);
  }

  private buildAgentTemplate(sampleAgent?: IAgentResponse): string {
    if (!sampleAgent) {
      return JSON.stringify({
        name: 'Agent Name',
        agentType: 'agent-type-id',
        role: 'Agent role/behavior description',
        description: 'Short description',
        temperature: 0.7,
        model: '',
        instruction: '',
        ignorePrePrompt: false,
        tools: [],
      }, null, 2);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const template: Record<string, any> = {};
    for (const [key, value] of Object.entries(sampleAgent)) {
      if (AGENT_TEMPLATE_STRIP_FIELDS.has(key)) continue;
      if (key === 'agentType' && typeof value === 'object' && value !== null) {
        template[key] = (value as { id: string }).id;
      } else {
        template[key] = value;
      }
    }
    return JSON.stringify(template, null, 2);
  }

  private buildOutputFormatInstruction(
    agentTemplate: string,
    agentTypes: Array<{ id: string; name: string; slug: string }>,
    tools: Array<{ id: string; name: string; description: string }>,
    models: Array<{ id: string; name: string }>,
  ): string {
    const agentTypeList = agentTypes
      .map((t) => `  - ID: "${t.id}", Name: "${t.name}", Slug: "${t.slug}"`)
      .join('\n');
    const toolList = tools.length > 0
      ? tools.map((t) => `  - ID: "${t.id}", Name: "${t.name}", Description: "${t.description}"`).join('\n')
      : '  (No tools available)';
    const modelList = models.length > 0
      ? models.map((m) => `  - ID: "${m.id}", Name: "${m.name}"`).join('\n')
      : '  (No models available)';

    return `
CRITICAL — You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no extra text.
The JSON must follow this exact schema:

{
  "newAgents": [
    {
      "tempId": "$1",
      ... agent fields following the template below ...
    }
  ],
  "members": [
    {
      "agentId": "<existing agent ID or temp ID like $1, $2 for new agents>",
      "parentAgentId": "<agent ID or temp ID of the parent, or null if root>",
      "order": <integer, execution priority among siblings, starting at 0>
    }
  ]
}

Each new agent in "newAgents" MUST include a "tempId" field ($1, $2, $3...) and follow this field template:
${agentTemplate}

Available agent types (use the ID in the "agentType" field):
${agentTypeList}

Available tools (use the IDs in the "tools" array):
${toolList}

Available models (use the ID in the "model" field, or leave empty for default):
${modelList}

Rules:
- Reuse existing agents when they fit. Create new agents only when no suitable existing agent is available.
- For new agents, use temp IDs ($1, $2, $3...) in both "newAgents" and "members".
- For existing agents, use their real agent ID in "members".
- "newAgents" may be an empty array if all needed agents already exist.
- Each agent (existing or new) must appear exactly once in the "members" array.
- parentAgentId must reference another agent's ID from members, or be null for root nodes.
- No agent can be its own parent (agentId !== parentAgentId).
- The hierarchy must not contain cycles.
- order defines priority among siblings (lower = executes first).
- Do NOT assign knowledgeBases.
`.trim();
  }

  private parseAiResponse(content: string): {
    newAgents: Array<{ tempId: string; [key: string]: unknown }>;
    members: Array<{ agentId: string; parentAgentId: string | null; order: number }>;
  } {
    let jsonStr = content.trim();
    const fencedContent = this.extractMarkdownCodeFenceContent(jsonStr);
    if (fencedContent) {
      jsonStr = fencedContent.trim();
    }
    if (!jsonStr.startsWith('{')) {
      const objectText = this.extractBalancedJsonObject(jsonStr);
      if (objectText) {
        jsonStr = objectText;
      }
    }
    const parsed = JSON.parse(jsonStr);
    if (!parsed.members || !Array.isArray(parsed.members)) {
      throw new Error('Invalid AI response: missing members array');
    }
    return {
      newAgents: Array.isArray(parsed.newAgents) ? parsed.newAgents : [],
      members: parsed.members,
    };
  }

  /**
   * Expand a set of team IDs into a deduped list of agent IDs, for teams the
   * user owns. Unknown or non-owned teams are silently skipped. Entry point used
   * by the conversation send path to turn `@TeamName` into agents. Agents are
   * returned in hierarchy (BFS) order so the root is addressed first.
   */
  async resolveAgentIds(teamIds: string[], userId: string): Promise<string[]> {
    if (!teamIds || teamIds.length === 0) return [];

    const validIds = teamIds.filter((id) => Types.ObjectId.isValid(id));
    if (validIds.length === 0) return [];

    const teams = await this.teamModel
      .find({
        _id: { $in: validIds.map((id) => new Types.ObjectId(id)) },
        createdBy: new Types.ObjectId(userId),
        isActive: true,
      })
      .lean()
      .exec();

    const agentIds = new Set<string>();
    for (const team of teams) {
      for (const agentId of this.orderMembers(this.readMembers(team))) {
        agentIds.add(agentId);
      }
    }
    return [...agentIds];
  }

  async resolveExecutionDefinition(userId: string, teamId: string): Promise<TeamExecutionDefinition> {
    if (!Types.ObjectId.isValid(teamId)) throw new NotFoundException(ErrorCode.TEAM_NOT_FOUND);
    const team = await this.teamModel.findById(teamId).lean().exec();
    if (!team || !team.isActive) throw new NotFoundException(ErrorCode.TEAM_NOT_FOUND);

    if (team.createdBy.toString() !== userId) {
      const permission = await this.teamShareService.getSharePermission(userId, teamId);
      if (permission !== 'read' && permission !== 'write') throw new ForbiddenException(ErrorCode.TEAM_FORBIDDEN);
    }

    const nodes: TeamExecutionNode[] = this.readMembers(team as unknown as Record<string, unknown>).map((member) => ({
      agentId: member.agentId.toString(),
      parentAgentId: member.parentAgentId?.toString() ?? null,
      order: member.order ?? 0,
    }));
    const agents = await this.agentService.findByIdsUnrestricted(nodes.map((node) => node.agentId));
    const ordered = validateExecutableTeam(
      nodes,
      agents.filter((agent) => agent.isActive).map((agent) => ({ id: agent.id, agentTypeSlug: agent.agentType.slug })),
    );
    return { teamId, nodes: ordered };
  }

  /** Ordered (BFS) agent IDs of a single team. */
  async getOrderedAgentIds(teamId: string): Promise<string[]> {
    const team = await this.teamModel.findById(teamId).lean().exec();
    if (!team) return [];
    return this.orderMembers(this.readMembers(team));
  }

  /**
   * Remove an agent from every team that references it (as a member or a
   * parent). Called when an agent is deleted, so teams never point at a dangling
   * agent and orphaned children become roots.
   */
  async removeAgentFromAllTeams(agentId: string): Promise<void> {
    if (!Types.ObjectId.isValid(agentId)) return;
    const objectId = new Types.ObjectId(agentId);

    const removed = await this.teamModel
      .updateMany({ 'members.agentId': objectId }, { $pull: { members: { agentId: objectId } } })
      .exec();

    await this.teamModel
      .updateMany(
        { 'members.parentAgentId': objectId },
        { $set: { 'members.$[elem].parentAgentId': null } },
        { arrayFilters: [{ 'elem.parentAgentId': objectId }] },
      )
      .exec();

    if (removed.modifiedCount > 0) {
      this.logger.log('Agent removed from teams', { agentId, teamsAffected: removed.modifiedCount });
    }
  }

  // ===== Helpers =====

  private async getOwnedTeam(userId: string, teamId: string): Promise<TeamDocument> {
    if (!Types.ObjectId.isValid(teamId)) {
      throw new NotFoundException(ErrorCode.TEAM_NOT_FOUND);
    }
    const team = await this.teamModel.findById(teamId).exec();
    if (!team) {
      throw new NotFoundException(ErrorCode.TEAM_NOT_FOUND);
    }
    if (team.createdBy.toString() !== userId) {
      throw new ForbiddenException(ErrorCode.TEAM_FORBIDDEN);
    }
    return team;
  }

  /**
   * Load a team the user may modify: the owner, or a user it has been shared
   * with at the 'write' level. Returns the hydrated document.
   */
  private async loadTeamForWrite(userId: string, teamId: string): Promise<TeamDocument> {
    if (!Types.ObjectId.isValid(teamId)) {
      throw new NotFoundException(ErrorCode.TEAM_NOT_FOUND);
    }
    const team = await this.teamModel.findById(teamId).exec();
    if (!team) {
      throw new NotFoundException(ErrorCode.TEAM_NOT_FOUND);
    }
    if (team.createdBy.toString() === userId) {
      return team;
    }
    const permission = await this.teamShareService.getSharePermission(userId, teamId);
    if (permission !== 'write') {
      throw new ForbiddenException(
        permission === 'read' ? ErrorCode.TEAM_SHARE_FORBIDDEN : ErrorCode.TEAM_FORBIDDEN,
      );
    }
    return team;
  }

  /** Build flat members (all roots) from an ordered list of agent IDs. */
  private agentIdsToMembers(agentIds?: string[]): TeamMember[] {
    const unique = [...new Set(agentIds || [])].filter((id) => Types.ObjectId.isValid(id));
    return unique.map((id, index) => ({
      agentId: new Types.ObjectId(id),
      parentAgentId: null,
      order: index,
      positionX: 0,
      positionY: 0,
    })) as TeamMember[];
  }

  /**
   * Reconcile an edited agent list against existing members: keep hierarchy and
   * positions for agents that remain, add new agents as roots, drop removed ones
   * and re-root any children that pointed at a removed agent.
   */
  private reconcileMembers(existing: TeamMember[], agentIds: string[]): TeamMember[] {
    const newIds = [...new Set(agentIds || [])].filter((id) => Types.ObjectId.isValid(id));
    const keep = new Set(newIds);
    const byId = new Map(existing.map((m) => [m.agentId.toString(), m]));

    return newIds.map((id, index) => {
      const prev = byId.get(id);
      const parent = prev?.parentAgentId ?? null;
      const parentKept = parent && keep.has(parent.toString()) ? parent : null;
      return {
        agentId: new Types.ObjectId(id),
        parentAgentId: parentKept,
        order: prev?.order ?? index,
        positionX: prev?.positionX ?? 0,
        positionY: prev?.positionY ?? 0,
      };
    }) as TeamMember[];
  }

  /** BFS order: roots first (by `order`), then children (by `order`). */
  private orderMembers(members: TeamMember[]): string[] {
    if (!members || members.length === 0) return [];

    const childrenMap = new Map<string, TeamMember[]>();
    const roots: TeamMember[] = [];
    for (const m of members) {
      if (!m.parentAgentId) {
        roots.push(m);
      } else {
        const key = m.parentAgentId.toString();
        if (!childrenMap.has(key)) childrenMap.set(key, []);
        childrenMap.get(key)!.push(m);
      }
    }

    roots.sort((a, b) => a.order - b.order);
    for (const children of childrenMap.values()) children.sort((a, b) => a.order - b.order);

    const result: string[] = [];
    const queue = [...roots];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const idStr = current.agentId.toString();
      result.push(idStr);
      queue.push(...(childrenMap.get(idStr) || []));
    }
    return result;
  }

  private detectCycle(members: Array<{ agentId: string; parentAgentId?: string | null }>): boolean {
    const parentMap = new Map<string, string | null>();
    for (const m of members) {
      parentMap.set(m.agentId, m.parentAgentId ?? null);
    }
    for (const m of members) {
      const visited = new Set<string>();
      let current: string | null = m.agentId;
      while (current) {
        if (visited.has(current)) return true;
        visited.add(current);
        current = parentMap.get(current) ?? null;
      }
    }
    return false;
  }

  private async validateAgentsExist(agentIds: string[], userId: string): Promise<void> {
    const agents = await this.agentService.findByIds(agentIds, userId);
    if (agents.length !== agentIds.length) {
      throw new BadRequestException(ErrorCode.TEAM_AGENT_NOT_FOUND);
    }
  }

  /**
   * Validate agents for a hierarchy update on a shared team. Agents already in
   * the team are always allowed; only newly-added agents must be owned by the
   * (write-shared) editor.
   */
  private async validateAgentsForSharedTeam(
    newAgentIds: string[],
    userId: string,
    existingAgentIds: string[],
  ): Promise<void> {
    const existing = new Set(existingAgentIds);
    const added = newAgentIds.filter((id) => !existing.has(id));
    if (added.length > 0) {
      const agents = await this.agentService.findByIds(added, userId);
      if (agents.length !== added.length) {
        throw new BadRequestException(ErrorCode.TEAM_AGENT_NOT_FOUND);
      }
    }
  }

  /** Build agent details without an ownership filter (verified team access). */
  private async buildAgentMapForTeamAccess(agentIds: string[]): Promise<Map<string, MemberAgentInfo>> {
    if (agentIds.length === 0) return new Map();
    const agents = await this.agentService.findByIdsUnrestricted(agentIds);
    const map = new Map<string, MemberAgentInfo>();
    for (const agent of agents) {
      map.set(agent.id, {
        id: agent.id,
        name: agent.name,
        agentType: agent.agentType,
        role: agent.role,
        description: agent.description,
      });
    }
    return map;
  }

  private async buildAgentMap(agentIds: string[], userId: string): Promise<Map<string, MemberAgentInfo>> {
    if (agentIds.length === 0) return new Map();
    const agents = await this.agentService.findByIds(agentIds, userId);
    const map = new Map<string, MemberAgentInfo>();
    for (const agent of agents) {
      map.set(agent.id, {
        id: agent.id,
        name: agent.name,
        agentType: agent.agentType,
        role: agent.role,
        description: agent.description,
      });
    }
    return map;
  }

  /**
   * Read a team's members, tolerating legacy documents that still use the old
   * flat `agentIds` array (pre-hierarchy). Legacy agents become flat root
   * members; the team auto-heals to `members` on its next save.
   */
  private readMembers(team: Record<string, unknown>): TeamMember[] {
    const members = team.members as TeamMember[] | undefined;
    if (members && members.length > 0) return members;
    const legacy = team.agentIds as Types.ObjectId[] | undefined;
    if (legacy && legacy.length > 0) {
      return legacy.map((agentId, index) => ({
        agentId,
        parentAgentId: null,
        order: index,
        positionX: 0,
        positionY: 0,
      })) as TeamMember[];
    }
    return members || [];
  }

  private toResponse(team: TeamDocument | Record<string, unknown>): ITeamResponse {
    const d = team as Record<string, unknown>;
    const members = this.readMembers(d);
    return {
      id: (d._id as { toString(): string }).toString(),
      name: d.name as string,
      description: (d.description as string) || '',
      members: members.map((m) => this.toMemberResponse(m as unknown as Record<string, unknown>)),
      agentCount: members.length,
      isActive: (d.isActive as boolean) ?? true,
      createdBy: d.createdBy ? (d.createdBy as { toString(): string }).toString() : '',
      createdAt: d.createdAt as Date,
      updatedAt: d.updatedAt as Date,
    };
  }

  private toResponseWithAgents(
    team: TeamDocument | Record<string, unknown>,
    agentMap: Map<string, MemberAgentInfo>,
  ): ITeamWithAgentsResponse {
    const base = this.toResponse(team);
    return {
      ...base,
      members: base.members.map((m) => ({ ...m, agent: agentMap.get(m.agentId) } as ITeamMemberWithAgentResponse)),
    };
  }

  private toMemberResponse(m: Record<string, unknown>): ITeamMemberResponse {
    return {
      agentId: m.agentId ? (m.agentId as { toString(): string }).toString() : '',
      parentAgentId: m.parentAgentId ? (m.parentAgentId as { toString(): string }).toString() : null,
      order: (m.order as number) ?? 0,
      positionX: (m.positionX as number) ?? 0,
      positionY: (m.positionY as number) ?? 0,
    };
  }

  private extractMarkdownCodeFenceContent(text: string): string | null {
    const fenceStart = text.indexOf('```');
    if (fenceStart === -1) {
      return null;
    }

    let contentStart = fenceStart + 3;
    if (text.slice(contentStart, contentStart + 4).toLowerCase() === 'json') {
      contentStart += 4;
    }
    while (contentStart < text.length && this.isAsciiWhitespace(text[contentStart])) {
      contentStart++;
    }

    const fenceEnd = text.indexOf('```', contentStart);
    if (fenceEnd === -1) {
      return null;
    }

    return text.slice(contentStart, fenceEnd);
  }

  private extractBalancedJsonObject(text: string): string | null {
    const start = text.indexOf('{');
    if (start === -1) {
      return null;
    }

    let depth = 0;
    let inString = false;
    let isEscaped = false;

    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (inString) {
        if (isEscaped) {
          isEscaped = false;
        } else if (char === '\\') {
          isEscaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          return text.slice(start, index + 1);
        }
      }
    }

    return null;
  }

  private isAsciiWhitespace(char: string): boolean {
    return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f' || char === '\v';
  }
}
