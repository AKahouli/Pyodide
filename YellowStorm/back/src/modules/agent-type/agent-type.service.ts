import { Inject, Injectable } from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { LoggerService } from '../logger';
import { AGENT_TYPE_STORE, type AgentTypePromptRow, type AgentTypeRow, type AgentTypeStore } from './persistence/agent-type.store';
import { IAgentTypeResponse } from './interfaces/agent-type.interface';
import { IAgentTypePromptResponse } from './interfaces/agent-type-prompt.interface';
import { CreateAgentTypeDto } from './dto/create-agent-type.dto';
import { UpdateAgentTypeDto } from './dto/update-agent-type.dto';
import { QueryAgentTypeDto } from './dto/query-agent-type.dto';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { NotFoundException, ConflictException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { SkillService } from '../skill/skill.service';

@Injectable()
export class AgentTypeService {
  constructor(
    @Inject(AGENT_TYPE_STORE)
    private readonly agentTypeStore: AgentTypeStore,
    private readonly skillService: SkillService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(AgentTypeService.name);
  }

  async create(dto: CreateAgentTypeDto): Promise<IAgentTypeResponse> {
    const slug = this.generateSlug(dto.name);

    if ((dto.skills ?? []).length > 0) {
      const resolvedSkills = await this.skillService.findByIds(dto.skills ?? []);
      if ((dto.skills ?? []).length !== resolvedSkills.length) {
        throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND, 'One or more skills were not found.');
      }
    }

    const existing = await this.agentTypeStore.findByNameOrSlug(dto.name, slug);
    if (existing) {
      throw new ConflictException(ErrorCode.AGENT_TYPE_ALREADY_EXISTS);
    }

    const agentType = await this.agentTypeStore.insert({
      name: dto.name,
      slug,
      defaultPrompt: dto.defaultPrompt ?? '',
      skills: dto.skills ?? [],
      isActive: dto.isActive ?? true,
    });

    this.logger.log('Agent type created', {
      agentTypeId: agentType.id,
      name: agentType.name,
    });

    return this.toResponse(agentType, 0);
  }

  async findAll(query: QueryAgentTypeDto): Promise<PaginatedResponseDto<IAgentTypeResponse>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const { rows, total } = await this.agentTypeStore.list({
      search: query.search,
      isActive: query.isActive,
      page,
      limit,
    });

    const promptCounts = await this.agentTypeStore.promptCountsFor(rows.map((at) => at.id));

    return new PaginatedResponseDto(
      rows.map((at) => this.toResponse(at, promptCounts.get(at.id) ?? 0)),
      total,
      page,
      limit,
    );
  }

  async findById(id: string): Promise<IAgentTypeResponse> {
    if (!isObjectId(id)) {
      throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND);
    }
    const agentType = await this.agentTypeStore.findById(id);
    if (!agentType) {
      throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND);
    }

    const promptCount = await this.agentTypeStore.promptCount(id);
    return this.toResponse(agentType, promptCount);
  }

  async findBySlug(slug: string): Promise<IAgentTypeResponse | null> {
    const agentType = await this.agentTypeStore.findBySlug(slug, true);
    if (!agentType) return null;

    const promptCount = await this.agentTypeStore.promptCount(agentType.id);
    return this.toResponse(agentType, promptCount);
  }

  /**
   * Idempotent lookup-or-create used by the Worky `onModuleInit` seed to make
   * sure the `manager` agent type exists before any stream is created. Does not
   * touch prompts — those are populated by the agent-type admin module.
   */
  async findOrCreateBySlug(
    slug: string,
    data: { name: string; defaultPrompt?: string; isActive?: boolean },
  ): Promise<IAgentTypeResponse> {
    const agentType = await this.agentTypeStore.findOrCreateBySlug(slug, {
      name: data.name,
      defaultPrompt: data.defaultPrompt ?? '',
      isActive: data.isActive ?? true,
    });
    const promptCount = await this.agentTypeStore.promptCount(agentType.id);
    return this.toResponse(agentType, promptCount);
  }

  async findAllActive(): Promise<IAgentTypeResponse[]> {
    const agentTypes = await this.agentTypeStore.findAllActive();
    const promptCounts = await this.agentTypeStore.promptCountsFor(agentTypes.map((at) => at.id));

    return agentTypes.map((at) => this.toResponse(at, promptCounts.get(at.id) ?? 0));
  }

  async update(id: string, dto: UpdateAgentTypeDto): Promise<IAgentTypeResponse> {
    if (!isObjectId(id)) {
      throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND);
    }
    const existing = await this.agentTypeStore.findById(id);
    if (!existing) {
      throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND);
    }

    if ((dto.skills ?? []).length > 0) {
      const resolvedSkills = await this.skillService.findByIds(dto.skills ?? []);
      if ((dto.skills ?? []).length !== resolvedSkills.length) {
        throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND, 'One or more skills were not found.');
      }
    }

    const updatePayload: Record<string, unknown> = { ...dto };

    if (dto.name && dto.name !== existing.name) {
      const slug = this.generateSlug(dto.name);
      updatePayload.slug = slug;

      const duplicate = await this.agentTypeStore.findByNameOrSlugExcluding(id, dto.name, slug);
      if (duplicate) {
        throw new ConflictException(ErrorCode.AGENT_TYPE_ALREADY_EXISTS);
      }
    }

    const agentType = await this.agentTypeStore.update(id, updatePayload);
    if (!agentType) {
      throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND);
    }

    this.logger.log('Agent type updated', {
      agentTypeId: id,
      changes: Object.keys(dto),
    });

    const promptCount = await this.agentTypeStore.promptCount(id);
    return this.toResponse(agentType, promptCount);
  }

  async delete(id: string): Promise<void> {
    // Type, junction rows and prompts cascade in one statement.
    const agentType = await this.agentTypeStore.delete(id);
    if (!agentType) {
      throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND);
    }

    this.logger.log('Agent type deleted', {
      agentTypeId: id,
      name: agentType.name,
    });
  }

  // ==========================================
  // Prompt CRUD
  // ==========================================

  async getPromptsForAgentType(agentTypeId: string): Promise<IAgentTypePromptResponse[]> {
    if (!isObjectId(agentTypeId)) {
      throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND);
    }
    const agentType = await this.agentTypeStore.findById(agentTypeId);
    if (!agentType) {
      throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND);
    }

    const prompts = await this.agentTypeStore.promptsFor(agentTypeId);
    return prompts.map((p) => this.toPromptResponse(p));
  }

  async upsertPrompt(
    agentTypeId: string,
    modelId: string,
    prompt: string,
  ): Promise<IAgentTypePromptResponse> {
    const agentType = await this.agentTypeStore.findById(agentTypeId);
    if (!agentType) {
      throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND);
    }

    const result = await this.agentTypeStore.upsertPrompt(agentTypeId, modelId, prompt);

    this.logger.log('Agent type prompt upserted', {
      agentTypeId,
      modelId,
    });

    return this.toPromptResponse(result);
  }

  async deletePrompt(agentTypeId: string, modelId: string): Promise<void> {
    const result = await this.agentTypeStore.deletePrompt(agentTypeId, modelId);
    if (!result) {
      throw new NotFoundException(ErrorCode.AGENT_TYPE_PROMPT_NOT_FOUND);
    }

    this.logger.log('Agent type prompt deleted', {
      agentTypeId,
      modelId,
    });
  }

  async resolvePrompt(agentTypeId: string, modelId: string): Promise<string> {
    const prompt = await this.agentTypeStore.findPrompt(agentTypeId, modelId);
    if (prompt) {
      return prompt.prompt;
    }
    const agentType = await this.agentTypeStore.findById(agentTypeId);
    return agentType?.defaultPrompt || '';
  }

  async resolvePromptsInBatch(
    pairs: { agentTypeId: string; modelId: string }[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    if (pairs.length === 0) {
      return result;
    }

    // Deduplicate pairs
    const uniquePairs = new Map<string, { agentTypeId: string; modelId: string }>();
    for (const pair of pairs) {
      const key = `${pair.agentTypeId}:${pair.modelId}`;
      uniquePairs.set(key, pair);
    }

    // Query 1: Find all model-specific prompts in batch
    const modelPrompts = await this.agentTypeStore.findPromptsForPairs(Array.from(uniquePairs.values()));

    const foundKeys = new Set<string>();
    for (const mp of modelPrompts) {
      const key = `${mp.agentTypeId}:${mp.modelId}`;
      result.set(key, mp.prompt);
      foundKeys.add(key);
    }

    // Find which agent types need fallback to defaultPrompt
    const missingAgentTypeIds = new Set<string>();
    for (const [key, pair] of uniquePairs) {
      if (!foundKeys.has(key)) {
        missingAgentTypeIds.add(pair.agentTypeId);
      }
    }

    // Query 2: Get defaultPrompt for missing agent types
    if (missingAgentTypeIds.size > 0) {
      const agentTypes = await this.agentTypeStore.findByIds(Array.from(missingAgentTypeIds));

      const defaultPromptMap = new Map<string, string>();
      for (const at of agentTypes) {
        defaultPromptMap.set(at.id, at.defaultPrompt || '');
      }

      for (const [key, pair] of uniquePairs) {
        if (!foundKeys.has(key)) {
          result.set(key, defaultPromptMap.get(pair.agentTypeId) || '');
        }
      }
    }

    return result;
  }

  /**
   * Batch lookup used by AgentService to hydrate agents (which live in Postgres)
   * with their agent-type name/slug/skills.
   */
  async getManyForHydration(
    ids: string[],
  ): Promise<Map<string, { id: string; name: string; slug: string; skills: string[] }>> {
    const map = new Map<string, { id: string; name: string; slug: string; skills: string[] }>();
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return map;

    const docs = await this.agentTypeStore.findByIds(unique);

    for (const d of docs) {
      map.set(d.id, { id: d.id, name: d.name, slug: d.slug, skills: d.skills });
    }
    return map;
  }

  // ==========================================
  // Private helpers
  // ==========================================

  private generateSlug(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '_');
  }

  private toResponse(doc: AgentTypeRow | Record<string, unknown>, promptCount: number): IAgentTypeResponse {
    const d = doc as Record<string, unknown>;
    return {
      id: d.id as string,
      name: d.name as string,
      slug: d.slug as string,
      defaultPrompt: (d.defaultPrompt as string) || '',
      skills: (d.skills as string[]) || [],
      promptCount,
      isActive: d.isActive as boolean,
      createdAt: d.createdAt as Date,
      updatedAt: d.updatedAt as Date,
    };
  }

  private toPromptResponse(doc: AgentTypePromptRow | Record<string, unknown>): IAgentTypePromptResponse {
    return {
      id: doc.id as string,
      agentTypeId: doc.agentTypeId as string,
      modelId: doc.modelId as string,
      prompt: doc.prompt as string,
      createdAt: doc.createdAt as Date,
      updatedAt: doc.updatedAt as Date,
    };
  }
}
