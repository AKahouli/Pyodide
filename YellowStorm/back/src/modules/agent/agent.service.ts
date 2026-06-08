import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, FilterQuery, Types } from 'mongoose';
import { LoggerService } from '../logger';
import { Agent, AgentDocument } from './schemas/agent.schema';
import { IAgentResponse, IAgentForStream, IGrpcAgent } from './interfaces/agent.interface';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { QueryAgentDto } from './dto/query-agent.dto';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { NotFoundException, ConflictException, ForbiddenException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { escapeRegex } from '../../common/utils';
import { ToolService } from '../tool/tool.service';
import { IToolResponse } from '../tool/interfaces/tool.interface';
import { AgentTypeService } from '../agent-type/agent-type.service';
import { ModelsService } from '../models/models.service';
import { SkillService } from '../skill/skill.service';
import { ISkillResponse } from '../skill/interfaces/skill.interface';
import { ConnectorService } from '../connector/connector.service';
import { ConnectorAuthService } from '../connector/interfaces/connector-auth.interface';
import { ConnectedAppTokenService } from '../connected-app/services/connected-app-token.service';

@Injectable()
export class AgentService {
  constructor(
    @InjectModel(Agent.name)
    private readonly agentModel: Model<AgentDocument>,
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
    const existing = await this.agentModel
      .findOne({ name: dto.name, createdBy: new Types.ObjectId(userId) })
      .lean()
      .exec();
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

    const agent = await this.agentModel.create({
      name: dto.name,
      slug: normalizedSlug,
      agentType: new Types.ObjectId(dto.agentType),
      role: dto.role,
      description: dto.description ?? '',
      temperature: dto.temperature ?? 0,
      llmModel: dto.model,
      instruction: dto.instruction ?? '',
      ignorePrePrompt: dto.ignorePrePrompt ?? false,
      knowledgeBases: (dto.knowledgeBases ?? []).map((id) => new Types.ObjectId(id)),
      tools: (dto.tools ?? []).map((id) => new Types.ObjectId(id)),
      skills: (dto.skills ?? []).map((id) => new Types.ObjectId(id)),
      disabledSkills: (dto.disabledSkills ?? []).map((id) => new Types.ObjectId(id)),
      connectors: (dto.connectors ?? []).map((id) => new Types.ObjectId(id)),
      isDefault: false,
      isDefaultForType: dto.isDefaultForType ?? false,
      isActive: dto.isActive ?? true,
      createdBy: new Types.ObjectId(userId),
    });

    this.logger.log('Personal agent created', {
      agentId: agent._id.toString(),
      name: agent.name,
      userId,
    });

    return this.toResponse(agent, { id: agentType.id, name: agentType.name });
  }

  async findUserAgents(userId: string, query: QueryAgentDto): Promise<PaginatedResponseDto<IAgentResponse>> {
    const filter: FilterQuery<AgentDocument> = {
      createdBy: new Types.ObjectId(userId),
      isDefault: false,
    };

    if (query.search) {
      filter.name = { $regex: escapeRegex(query.search), $options: 'i' };
    }

    if (query.agentType) {
      filter.agentType = new Types.ObjectId(query.agentType);
    }

    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const [agents, total] = await Promise.all([
      this.agentModel
        .find(filter)
        .populate('agentType', 'name skills')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.agentModel.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponseDto(
      agents.map((a) => this.toResponse(a)),
      total,
      page,
      limit,
    );
  }

  async findUserAgentById(userId: string, agentId: string): Promise<IAgentResponse> {
    const agent = await this.agentModel
      .findById(agentId)
      .populate('agentType', 'name skills')
      .lean()
      .exec();

    if (!agent) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }

    if (agent.isDefault) {
      throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_DEFAULT_READONLY);
    }

    if (agent.createdBy.toString() !== userId) {
      throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_FORBIDDEN);
    }

    return this.toResponse(agent);
  }

  async updatePersonal(userId: string, agentId: string, dto: UpdateAgentDto): Promise<IAgentResponse> {
    const agent = await this.agentModel.findById(agentId).lean().exec();

    if (!agent) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }

    if (agent.isDefault) {
      throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_DEFAULT_READONLY);
    }

    if (agent.createdBy.toString() !== userId) {
      throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_FORBIDDEN);
    }

    // Validate agent type if changing
    if (dto.agentType) {
      const agentType = await this.agentTypeService.findById(dto.agentType);
      if (!agentType || !agentType.isActive) {
        throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND);
      }
    }

    // Check name uniqueness if changing
    if (dto.name && dto.name !== agent.name) {
      const duplicate = await this.agentModel
        .findOne({ name: dto.name, createdBy: new Types.ObjectId(userId) })
        .lean()
        .exec();
      if (duplicate) {
        throw new ConflictException(ErrorCode.CUSTOM_AGENT_ALREADY_EXISTS);
      }
    }

    const normalizedSlug = dto.slug ? this.normalizeSlug(dto.slug) : undefined;

    if (normalizedSlug && normalizedSlug !== agent.slug) {
      await this.ensureSlugUniqueness(normalizedSlug, false, userId, agentId);
    }

    // Ensure only one default-for-type per user per agent type
    if (dto.isDefaultForType === true) {
      const effectiveAgentTypeId = dto.agentType || agent.agentType.toString();
      await this.ensureDefaultForTypeUniqueness(effectiveAgentTypeId, true, userId, agentId);
    }

    await this.skillService.findByIds([...(dto.skills ?? []), ...(dto.disabledSkills ?? [])]);

    // Build update object
    const updateData: Record<string, unknown> = { ...dto };
    if (normalizedSlug) {
      updateData.slug = normalizedSlug;
    }
    if (dto.agentType) {
      updateData.agentType = new Types.ObjectId(dto.agentType);
    }
    // Remap DTO field 'model' to schema field 'llmModel'
    if ('model' in dto) {
      updateData.llmModel = dto.model || '';
      delete updateData.model;
    }
    if (dto.knowledgeBases) {
      updateData.knowledgeBases = dto.knowledgeBases.map((id) => new Types.ObjectId(id));
    }
    if (dto.tools) {
      updateData.tools = dto.tools.map((id) => new Types.ObjectId(id));
    }
    if (dto.skills) {
      updateData.skills = dto.skills.map((id) => new Types.ObjectId(id));
    }
    if (dto.disabledSkills) {
      updateData.disabledSkills = dto.disabledSkills.map((id) => new Types.ObjectId(id));
    }
    if (dto.connectors) {
      updateData.connectors = dto.connectors.map((id) => new Types.ObjectId(id));
    }

    const updated = await this.agentModel
      .findByIdAndUpdate(agentId, { $set: updateData }, { new: true })
      .populate('agentType', 'name skills')
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }

    this.logger.log('Personal agent updated', {
      agentId,
      userId,
      changes: Object.keys(dto),
    });

    return this.toResponse(updated);
  }

  async deletePersonal(userId: string, agentId: string): Promise<void> {
    const agent = await this.agentModel.findById(agentId).lean().exec();

    if (!agent) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }

    if (agent.isDefault) {
      throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_DEFAULT_READONLY);
    }

    if (agent.createdBy.toString() !== userId) {
      throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_FORBIDDEN);
    }

    await this.agentModel.findByIdAndDelete(agentId).exec();

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
    const existing = await this.agentModel
      .findOne({ name: dto.name, isDefault: true })
      .lean()
      .exec();
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

    const agent = await this.agentModel.create({
      name: dto.name,
      slug: normalizedSlug,
      agentType: new Types.ObjectId(dto.agentType),
      role: dto.role,
      description: dto.description ?? '',
      temperature: dto.temperature ?? 0,
      llmModel: dto.model,
      instruction: dto.instruction ?? '',
      ignorePrePrompt: dto.ignorePrePrompt ?? false,
      knowledgeBases: [],
      tools: (dto.tools ?? []).map((id) => new Types.ObjectId(id)),
      skills: (dto.skills ?? []).map((id) => new Types.ObjectId(id)),
      disabledSkills: (dto.disabledSkills ?? []).map((id) => new Types.ObjectId(id)),
      connectors: (dto.connectors ?? []).map((id) => new Types.ObjectId(id)),
      isDefault: true,
      isDefaultForType: dto.isDefaultForType ?? false,
      isActive: dto.isActive ?? true,
      createdBy: new Types.ObjectId(adminUserId),
    });

    this.logger.log('Default agent created', {
      agentId: agent._id.toString(),
      name: agent.name,
    });

    return this.toResponse(agent, { id: agentType.id, name: agentType.name });
  }

  async findDefaultAgents(query: QueryAgentDto): Promise<PaginatedResponseDto<IAgentResponse>> {
    const filter: FilterQuery<AgentDocument> = { isDefault: true };

    if (query.search) {
      filter.name = { $regex: escapeRegex(query.search), $options: 'i' };
    }

    if (query.agentType) {
      filter.agentType = new Types.ObjectId(query.agentType);
    }

    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const [agents, total] = await Promise.all([
      this.agentModel
        .find(filter)
        .populate('agentType', 'name skills')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.agentModel.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponseDto(
      agents.map((a) => this.toResponse(a)),
      total,
      page,
      limit,
    );
  }

  async findDefaultAgentById(agentId: string): Promise<IAgentResponse> {
    const agent = await this.agentModel
      .findOne({ _id: agentId, isDefault: true })
      .populate('agentType', 'name skills')
      .lean()
      .exec();

    if (!agent) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }

    return this.toResponse(agent);
  }

  async findDefaultByAgentType(agentTypeId: string): Promise<IAgentResponse | null> {
    const agent = await this.agentModel
      .findOne({
        agentType: new Types.ObjectId(agentTypeId),
        isDefault: true,
        isActive: true,
      })
      .populate('agentType', 'name skills')
      .lean()
      .exec();
    if (!agent) return null;
    // After
    const populatedType = agent.agentType as unknown as { _id: { toString(): string }; name: string };
    return this.toResponse(agent, { id: populatedType._id.toString(), name: populatedType.name });
  }

  async findDefaultAgentByName(name: string): Promise<IAgentResponse | null> {
    const agent = await this.agentModel
      .findOne({
        name: { $regex: `^${name}$`, $options: 'i' },
        isDefault: true,
        isActive: true,
      })
      .populate('agentType', 'name skills')
      .lean()
      .exec();
    if (!agent) return null;
    const populatedType = agent.agentType as unknown as { _id: { toString(): string }; name: string };
    return this.toResponse(agent, { id: populatedType._id.toString(), name: populatedType.name });
  }

  async updateDefault(agentId: string, dto: UpdateAgentDto): Promise<IAgentResponse> {
    const agent = await this.agentModel.findOne({ _id: agentId, isDefault: true }).lean().exec();
    if (!agent) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }

    if (dto.agentType) {
      const agentType = await this.agentTypeService.findById(dto.agentType);
      if (!agentType || !agentType.isActive) {
        throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND);
      }
    }

    if (dto.name && dto.name !== agent.name) {
      const duplicate = await this.agentModel
        .findOne({ name: dto.name, isDefault: true })
        .lean()
        .exec();
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

    const updateData: Record<string, unknown> = { ...dto };
    if (normalizedSlug) {
      updateData.slug = normalizedSlug;
    }
    if (dto.agentType) {
      updateData.agentType = new Types.ObjectId(dto.agentType);
    }
    // Remap DTO field 'model' to schema field 'llmModel'
    if ('model' in dto) {
      updateData.llmModel = dto.model || '';
      delete updateData.model;
    }
    // Strip knowledgeBases for default agents
    delete updateData.knowledgeBases;
    if (dto.tools) {
      updateData.tools = dto.tools.map((id) => new Types.ObjectId(id));
    }
    if (dto.skills) {
      updateData.skills = dto.skills.map((id) => new Types.ObjectId(id));
    }
    if (dto.disabledSkills) {
      updateData.disabledSkills = dto.disabledSkills.map((id) => new Types.ObjectId(id));
    }
    if (dto.connectors) {
      updateData.connectors = dto.connectors.map((id) => new Types.ObjectId(id));
    }

    const updated = await this.agentModel
      .findByIdAndUpdate(agentId, { $set: updateData }, { new: true })
      .populate('agentType', 'name skills')
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }

    this.logger.log('Default agent updated', {
      agentId,
      changes: Object.keys(dto),
    });

    return this.toResponse(updated);
  }

  async deleteDefault(agentId: string): Promise<void> {
    const agent = await this.agentModel.findOne({ _id: agentId, isDefault: true }).lean().exec();
    if (!agent) {
      throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
    }

    await this.agentModel.findByIdAndDelete(agentId).exec();

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
    const agents = await this.agentModel
      .find({
        isActive: true,
        $or: [
          { createdBy: new Types.ObjectId(userId), isDefault: false },
          { isDefault: true },
        ],
      })
      .populate('agentType', 'name slug skills')
      .lean()
      .exec();

    return agents.map((agent) => this.toStreamAgent(agent));
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
  ): Promise<IGrpcAgent[]> {
    this.logger.log('Building agents for stream', {
      userId,
      fallbackModelId,
      agentIds,
      sharedAgentIds,
      selectedConnectorId,
    });

    // Fetch personal + default agents
    const userAgents = await this.getAgentsForUser(userId);

    // Fetch shared agents if any
    let finalUserAgents = [...userAgents];
    if (sharedAgentIds && sharedAgentIds.length > 0) {
      const existingIds = new Set(userAgents.map((a) => a.id));
      const missingSharedIds = sharedAgentIds.filter((id) => !existingIds.has(id));

      if (missingSharedIds.length > 0) {
        const sharedAgents = await this.agentModel
          .find({
            _id: { $in: missingSharedIds.map((id) => new Types.ObjectId(id)) },
            isActive: true,
          })
          .populate('agentType', 'name slug skills')
          .lean()
          .exec();

        const streamSharedAgents = sharedAgents.map((agent) => this.toStreamAgent(agent));
        finalUserAgents = [...finalUserAgents, ...streamSharedAgents];

        this.logger.log('Shared agents fetched for stream', {
          userId,
          sharedCount: streamSharedAgents.length,
        });
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

    // Resolve exactly one manager (priority: pinged > personal default > first personal > admin default > first admin)
    const isManager = (a: IAgentForStream) => a.agentTypeSlug === 'manager';
    const manager = this.resolveManager(finalUserAgents, pingedAgents);

    const hasGroupMembers = groupMembers && groupMembers.length > 0;
    let filteredAgents: IAgentForStream[];

    if (pingedAgents.length > 0) {
      // User tagged specific agents: send pinged non-managers + the resolved manager
      filteredAgents = pingedAgents.filter((a) => !isManager(a));
      if (manager) {
        filteredAgents.push(manager);
      }
    } else {
      // No agents tagged: send all admin default agents + the resolved manager
      const adminAgents = finalUserAgents.filter((a) => a.isDefault && !isManager(a));
      filteredAgents = [...adminAgents];
      if (manager) {
        filteredAgents.push(manager);
      }
    }

    // Safety net: if still empty (no admin agents and no manager found), send all
    if (filteredAgents.length === 0) {
      filteredAgents = finalUserAgents;
    }

    this.logger.log('Agents filtered for stream', {
      userId,
      filteredCount: filteredAgents.length,
      mentionedIds: agentIds,
      managerId: manager?.id,
      managerName: manager?.name,
    });

    // Batch-resolve prompts: collect all (agentTypeId, modelId) pairs
    const promptPairs = filteredAgents
      .filter((a) => !a.ignorePrePrompt && a.agentTypeId)
      .map((a) => ({
        agentTypeId: a.agentTypeId,
        modelId: a.model || fallbackModelId || '',
      }));

    // Single batch query to AgentTypeService
    const promptMap = await this.agentTypeService.resolvePromptsInBatch(promptPairs);

    // Collect ALL unique tool IDs across filtered agents and batch-fetch
    const allToolIds = [...new Set(filteredAgents.flatMap((a) => a.toolIds))];
    const toolsMap = new Map<string, IToolResponse>();
    if (allToolIds.length > 0) {
      const fetched = await this.toolService.findByIds(allToolIds);
      for (const t of fetched) toolsMap.set(t.id, t);
    }

    const allSkillIds = [
      ...new Set(filteredAgents.flatMap((a) => [...(a.agentTypeSkillIds ?? []), ...(a.skillIds ?? [])])),
    ];
    const skillsMap = new Map<string, ISkillResponse>();
    if (allSkillIds.length > 0) {
      const fetchedSkills = await this.skillService.findByIds(allSkillIds);
      for (const skill of fetchedSkills) skillsMap.set(skill.id, skill);
    }

    // Batch-fetch all unique model IDs to resolve full LiteLLM model identifiers
    const allModelIds = [...new Set(
      filteredAgents
        .map((a) => a.model || fallbackModelId)
        .filter(Boolean) as string[],
    )];
    const modelMap = new Map<string, string>(); // modelId → proxy alias (e.g., "gpt-4.1")
    if (allModelIds.length > 0) {
      const modelResults = await Promise.all(
        allModelIds.map((id) => this.modelsService.findById(id)),
      );
      for (const m of modelResults) {
        if (m) {
          modelMap.set(m.id, m.id);
        }
      }
    }

    const allConnectorIds = [
      ...new Set(
        filteredAgents
          .flatMap((agent) => agent.connectorIds || [])
          .concat(selectedConnectorId ? [selectedConnectorId] : [])
          .filter(Boolean) as string[],
      ),
    ];
    const connectorsMap = await this.buildConnectorsMap(allConnectorIds);

    const grpcAgents = await Promise.all(filteredAgents.map(async (agent) => {
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

      const effectiveModelId = agent.model || fallbackModelId || '';
      const proxyModel = modelMap.get(effectiveModelId) || effectiveModelId;
      const effectiveSkills = this.resolveEffectiveSkills(agent, skillsMap);
      const effectiveConnectorIds = [
        ...new Set([...(agent.connectorIds || []), ...(selectedConnectorId ? [selectedConnectorId] : [])]),
      ];
      const connectorBindings = await this.buildConnectorBindings(connectorsMap, effectiveConnectorIds, userId);
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
        },
        agent_params: {
          params: {
            user_id: userId,
            connector_bindings_json: JSON.stringify(connectorBindings),
            platform_api_url: this.configService.get<string>('PLATFORM_API_URL', 'http://localhost:3000/api'),
            platform_api_token: this.configService.get<string>('INTERNAL_SERVICE_SECRET', ''),
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
  ): Promise<IGrpcAgent[]> {
    if (agentIds.length === 0) return [];

    this.logger.log('Building gRPC agents for playbook', { userId, agentIds, fallbackModelId });

    // Fetch agents by exact IDs (with agentType populated including slug)
    const agents = await this.agentModel
      .find({
        _id: { $in: agentIds.map((id) => new Types.ObjectId(id)) },
        isActive: true,
      })
      .populate('agentType', 'name slug skills')
      .lean()
      .exec();

    const streamAgents = agents.map((agent) => this.toStreamAgent(agent));

    // Batch-resolve prompts
    const promptPairs = streamAgents
      .filter((a) => !a.ignorePrePrompt && a.agentTypeId)
      .map((a) => ({
        agentTypeId: a.agentTypeId,
        modelId: a.model || fallbackModelId || '',
      }));
    const promptMap = await this.agentTypeService.resolvePromptsInBatch(promptPairs);

    // Batch-fetch tools
    const allToolIds = [...new Set(streamAgents.flatMap((a) => a.toolIds))];
    const toolsMap = new Map<string, IToolResponse>();
    if (allToolIds.length > 0) {
      const fetched = await this.toolService.findByIds(allToolIds);
      for (const t of fetched) toolsMap.set(t.id, t);
    }

    const allSkillIds = [
      ...new Set(streamAgents.flatMap((a) => [...(a.agentTypeSkillIds ?? []), ...(a.skillIds ?? [])])),
    ];
    const skillsMap = new Map<string, ISkillResponse>();
    if (allSkillIds.length > 0) {
      const fetchedSkills = await this.skillService.findByIds(allSkillIds);
      for (const skill of fetchedSkills) skillsMap.set(skill.id, skill);
    }

    // Batch-resolve models
    const allModelIds = [...new Set(
      streamAgents
        .map((a) => a.model || fallbackModelId)
        .filter(Boolean) as string[],
    )];
    const modelMap = new Map<string, string>();
    if (allModelIds.length > 0) {
      const modelResults = await Promise.all(
        allModelIds.map((id) => this.modelsService.findById(id)),
      );
      for (const m of modelResults) {
        if (m) modelMap.set(m.id, m.id);
      }
    }

    const allConnectorIds = [
      ...new Set(streamAgents.flatMap((agent) => agent.connectorIds || []).filter(Boolean) as string[]),
    ];
    const connectorsMap = await this.buildConnectorsMap(allConnectorIds);

    const grpcAgents = await Promise.all(
      streamAgents.map(async (agent) => {
        const agentTools = agent.toolIds
          .map((id) => toolsMap.get(id))
          .filter(Boolean) as IToolResponse[];
        const connectorBindings = await this.buildConnectorBindings(connectorsMap, agent.connectorIds || [], userId);
        const connectorToolDefs = this.buildConnectorToolDefs(connectorBindings);

        const effectiveModelId = agent.model || fallbackModelId || '';
        const proxyModel = modelMap.get(effectiveModelId) || effectiveModelId;
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
          },
          agent_params: {
            params: {
              user_id: userId,
              connector_bindings_json: JSON.stringify(connectorBindings),
              ...(sessionId ? { session_id: sessionId } : {}),
              platform_api_url: this.configService.get<string>('PLATFORM_API_URL', 'http://localhost:3000/api'),
              platform_api_token: this.configService.get<string>('INTERNAL_SERVICE_SECRET', ''),
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

  async getAllForUserResponse(userId: string): Promise<IAgentResponse[]> {
    const agents = await this.agentModel
      .find({
        isActive: true,
        $or: [
          { createdBy: new Types.ObjectId(userId), isDefault: false },
          { isDefault: true },
        ],
      })
      .populate('agentType', 'name skills')
      .sort({ isDefault: -1, createdAt: -1 })
      .lean()
      .exec();

    return agents.map((a) => this.toResponse(a));
  }

  async findByIds(ids: string[], userId: string): Promise<IAgentResponse[]> {
    const agents = await this.agentModel
      .find({
        _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
        isActive: true,
        $or: [
          { createdBy: new Types.ObjectId(userId), isDefault: false },
          { isDefault: true },
        ],
      })
      .populate('agentType', 'name skills')
      .lean()
      .exec();

    return agents.map((a) => this.toResponse(a));
  }

  // ==========================================
  // Helper: check if agent type is in use
  // ==========================================

  async countByAgentType(agentTypeId: string): Promise<number> {
    return this.agentModel.countDocuments({ agentType: new Types.ObjectId(agentTypeId) }).exec();
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
    const filter: FilterQuery<AgentDocument> = {
      agentType: new Types.ObjectId(agentTypeId),
      isDefaultForType: true,
    };
    if (isPersonal) {
      filter.isDefault = false;
      filter.createdBy = new Types.ObjectId(userId);
    } else {
      filter.isDefault = true;
    }
    if (excludeAgentId) {
      filter._id = { $ne: new Types.ObjectId(excludeAgentId) };
    }
    await this.agentModel.updateMany(filter, { $set: { isDefaultForType: false } }).exec();
  }

  private normalizeSlug(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private async ensureSlugUniqueness(
    slug: string,
    isDefault: boolean,
    userId?: string,
    excludeAgentId?: string,
  ): Promise<void> {
    const filter: FilterQuery<AgentDocument> = {
      slug,
      isDefault,
    };

    if (!isDefault) {
      filter.createdBy = new Types.ObjectId(userId);
    }

    if (excludeAgentId) {
      filter._id = { $ne: new Types.ObjectId(excludeAgentId) };
    }

    const existing = await this.agentModel.findOne(filter).lean().exec();
    if (existing) {
      throw new ConflictException(ErrorCode.CUSTOM_AGENT_ALREADY_EXISTS);
    }
  }

  /**
   * Resolve exactly ONE manager agent to include in the stream.
   * Priority (highest → lowest):
   *   1. A manager explicitly pinged by the user (from mentionedAgentIds)
   *   2. User's personal default-for-type manager
   *   3. First personal manager in the list
   *   4. Admin default-for-type manager
   *   5. First admin manager in the list
   */
  private resolveManager(
    allAgents: IAgentForStream[],
    pingedAgents: IAgentForStream[],
  ): IAgentForStream | undefined {
    const isManager = (a: IAgentForStream) => a.agentTypeSlug === 'manager';

    // 1. If the user pinged a manager, use it (first one if multiple)
    const pingedManager = pingedAgents.find(isManager);
    if (pingedManager) return pingedManager;

    // Separate all managers into personal vs admin
    const personalManagers = allAgents.filter((a) => isManager(a) && !a.isDefault);
    const adminManagers = allAgents.filter((a) => isManager(a) && a.isDefault);

    // 2. User's personal default-for-type manager
    const personalDefault = personalManagers.find((a) => a.isDefaultForType);
    if (personalDefault) return personalDefault;

    // 3. First personal manager
    if (personalManagers.length > 0) return personalManagers[0];

    // 4. Admin default-for-type manager
    const adminDefault = adminManagers.find((a) => a.isDefaultForType);
    if (adminDefault) return adminDefault;

    // 5. First admin manager
    if (adminManagers.length > 0) return adminManagers[0];

    return undefined;
  }

  // ==========================================
  // Private mapping helpers
  // ==========================================

  private toResponse(
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

  private toStreamAgent(doc: AgentDocument | Record<string, unknown>): IAgentForStream {
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
      agentTypeSkillIds,
      isDefault: (d.isDefault as boolean) || false,
      isDefaultForType: (d.isDefaultForType as boolean) || false,
    };
  }

  private resolveEffectiveSkills(
    agent: IAgentForStream,
    skillsMap: Map<string, ISkillResponse>,
  ): ISkillResponse[] {
    const disabled = new Set(agent.disabledSkillIds ?? []);
    const skillIds = [...new Set([...(agent.agentTypeSkillIds ?? []), ...(agent.skillIds ?? [])])];

    return skillIds
      .filter((id) => !disabled.has(id))
      .map((id) => skillsMap.get(id))
      .filter(Boolean) as ISkillResponse[];
  }

  private toGrpcSkill(skill: ISkillResponse): Record<string, unknown> {
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

  private async buildConnectorsMap(connectorIds: string[]): Promise<Map<string, any>> {
    const connectorsMap = new Map<string, any>();
    if (connectorIds.length === 0) {
      return connectorsMap;
    }

    const fetchedConnectors = await this.connectorService.findByIds(connectorIds);
    for (const connector of fetchedConnectors) {
      connectorsMap.set(connector.id, connector);
    }

    return connectorsMap;
  }

  private async buildConnectorBindings(
    connectorsMap: Map<string, any>,
    connectorIds: string[] = [],
    userId?: string,
  ): Promise<Record<string, unknown>[]> {
    const bindings = connectorIds
      .map((connectorId) => connectorsMap.get(connectorId))
      .filter(Boolean)
      .map((connector: any) => ({
        connector_id: connector.id,
        connector_name: connector.name,
        actions: (connector.actions || [])
          .filter((action: any) => action.isEnabled !== false)
          .map((action: any) => ({
            action_key: action.key,
            label: action.label || action.key,
            description: action.description || '',
            parameter_schema: action.parameterSchema || {},
          })),
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
        if (connector?.authSourceType === 'connected_app' && connector?.connectedAppKey) {
          try {
            const auth = await this.connectorAuthService.resolveRuntimeAuth(userId, {
              authSourceType: connector.authSourceType,
              connectedAppKey: connector.connectedAppKey,
              runtimeAuthConfig: connector.runtimeAuthConfig || {},
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

    return bindings;
  }

  private buildConnectorToolDefs(bindings: Record<string, unknown>[]): Record<string, unknown>[] {
    return bindings.flatMap((binding) => {
      const connectorId = String(binding.connector_id || '');
      const connectorName = String(binding.connector_name || 'connector');
      const actions = Array.isArray(binding.actions) ? binding.actions : [];

      return actions.map((action) => {
        const normalizedAction = action as Record<string, unknown>;
        const actionKey = String(normalizedAction.action_key || '');
        const label = String(normalizedAction.label || actionKey);
        const description = String(normalizedAction.description || '');

        return {
          name: `connector_${connectorId}_${actionKey}`,
          description: description || `${connectorName} connector action ${label}`,
          prompt: '',
          top_k: 0,
        };
      });
    });
  }
}
