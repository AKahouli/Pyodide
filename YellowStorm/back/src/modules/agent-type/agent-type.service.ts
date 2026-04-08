import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery, Types } from 'mongoose';
import { LoggerService } from '../logger';
import { AgentType, AgentTypeDocument } from './schemas/agent-type.schema';
import { AgentTypePrompt, AgentTypePromptDocument } from './schemas/agent-type-prompt.schema';
import { IAgentTypeResponse } from './interfaces/agent-type.interface';
import { IAgentTypePromptResponse } from './interfaces/agent-type-prompt.interface';
import { CreateAgentTypeDto } from './dto/create-agent-type.dto';
import { UpdateAgentTypeDto } from './dto/update-agent-type.dto';
import { QueryAgentTypeDto } from './dto/query-agent-type.dto';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { NotFoundException, ConflictException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { escapeRegex } from '../../common/utils';
import { SkillService } from '../skill/skill.service';

@Injectable()
export class AgentTypeService {
  constructor(
    @InjectModel(AgentType.name)
    private readonly agentTypeModel: Model<AgentTypeDocument>,
    @InjectModel(AgentTypePrompt.name)
    private readonly agentTypePromptModel: Model<AgentTypePromptDocument>,
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

    const existing = await this.agentTypeModel
      .findOne({ $or: [{ name: dto.name }, { slug }] })
      .lean()
      .exec();
    if (existing) {
      throw new ConflictException(ErrorCode.AGENT_TYPE_ALREADY_EXISTS);
    }

    const agentType = await this.agentTypeModel.create({
      name: dto.name,
      slug,
      defaultPrompt: dto.defaultPrompt ?? '',
      skills: (dto.skills ?? []).map((id) => new Types.ObjectId(id)),
      isActive: dto.isActive ?? true,
    });

    this.logger.log('Agent type created', {
      agentTypeId: agentType._id.toString(),
      name: agentType.name,
    });

    return this.toResponse(agentType, 0);
  }

  async findAll(query: QueryAgentTypeDto): Promise<PaginatedResponseDto<IAgentTypeResponse>> {
    const filter: FilterQuery<AgentTypeDocument> = {};

    if (query.search) {
      const regex = { $regex: escapeRegex(query.search), $options: 'i' };
      filter.name = regex;
    }

    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const [agentTypes, total] = await Promise.all([
      this.agentTypeModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.agentTypeModel.countDocuments(filter).exec(),
    ]);

    // Batch-query prompt counts
    const agentTypeIds = agentTypes.map((at) => at._id);
    const promptCounts = await this.getPromptCountsForIds(agentTypeIds);

    return new PaginatedResponseDto(
      agentTypes.map((at) => {
        const count = promptCounts.get(at._id.toString()) ?? 0;
        return this.toResponse(at, count);
      }),
      total,
      page,
      limit,
    );
  }

  async findById(id: string): Promise<IAgentTypeResponse> {
    const agentType = await this.agentTypeModel.findById(id).lean().exec();

    if (!agentType) {
      throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND);
    }

    const promptCount = await this.agentTypePromptModel
      .countDocuments({ agentType: new Types.ObjectId(id) })
      .exec();

    return this.toResponse(agentType, promptCount);
  }

  async findAllActive(): Promise<IAgentTypeResponse[]> {
    const agentTypes = await this.agentTypeModel
      .find({ isActive: true })
      .sort({ name: 1 })
      .lean()
      .exec();

    const agentTypeIds = agentTypes.map((at) => at._id);
    const promptCounts = await this.getPromptCountsForIds(agentTypeIds);

    return agentTypes.map((at) => {
      const count = promptCounts.get(at._id.toString()) ?? 0;
      return this.toResponse(at, count);
    });
  }

  async update(id: string, dto: UpdateAgentTypeDto): Promise<IAgentTypeResponse> {
    const existing = await this.agentTypeModel.findById(id).lean().exec();
    if (!existing) {
      throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND);
    }

    if ((dto.skills ?? []).length > 0) {
      const resolvedSkills = await this.skillService.findByIds(dto.skills ?? []);
      if ((dto.skills ?? []).length !== resolvedSkills.length) {
        throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND, 'One or more skills were not found.');
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updatePayload: Record<string, any> = { ...dto };

    if (dto.name && dto.name !== existing.name) {
      const slug = this.generateSlug(dto.name);
      updatePayload.slug = slug;

      const duplicate = await this.agentTypeModel
        .findOne({ _id: { $ne: id }, $or: [{ name: dto.name }, { slug }] })
        .lean()
        .exec();
      if (duplicate) {
        throw new ConflictException(ErrorCode.AGENT_TYPE_ALREADY_EXISTS);
      }
    }

    if (dto.skills) {
      updatePayload.skills = dto.skills.map((id) => new Types.ObjectId(id));
    }

    const agentType = await this.agentTypeModel
      .findByIdAndUpdate(id, { $set: updatePayload }, { new: true })
      .lean()
      .exec();

    if (!agentType) {
      throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND);
    }

    this.logger.log('Agent type updated', {
      agentTypeId: id,
      changes: Object.keys(dto),
    });

    const promptCount = await this.agentTypePromptModel
      .countDocuments({ agentType: new Types.ObjectId(id) })
      .exec();

    return this.toResponse(agentType, promptCount);
  }

  async delete(id: string): Promise<void> {
    const agentType = await this.agentTypeModel.findById(id).lean().exec();
    if (!agentType) {
      throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND);
    }

    // Check if any agents reference this type - done by AgentService via injection in controller
    // The controller will call agentService to check before calling delete

    await Promise.all([
      this.agentTypeModel.findByIdAndDelete(id).exec(),
      this.agentTypePromptModel.deleteMany({ agentType: new Types.ObjectId(id) }).exec(),
    ]);

    this.logger.log('Agent type deleted', {
      agentTypeId: id,
      name: agentType.name,
    });
  }

  // ==========================================
  // Prompt CRUD
  // ==========================================

  async getPromptsForAgentType(agentTypeId: string): Promise<IAgentTypePromptResponse[]> {
    const agentType = await this.agentTypeModel.findById(agentTypeId).lean().exec();
    if (!agentType) {
      throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND);
    }

    const prompts = await this.agentTypePromptModel
      .find({ agentType: new Types.ObjectId(agentTypeId) })
      .sort({ modelId: 1 })
      .lean()
      .exec();

    return prompts.map((p) => this.toPromptResponse(p));
  }

  async upsertPrompt(
    agentTypeId: string,
    modelId: string,
    prompt: string,
  ): Promise<IAgentTypePromptResponse> {
    const agentType = await this.agentTypeModel.findById(agentTypeId).lean().exec();
    if (!agentType) {
      throw new NotFoundException(ErrorCode.AGENT_TYPE_NOT_FOUND);
    }

    const result = await this.agentTypePromptModel
      .findOneAndUpdate(
        {
          agentType: new Types.ObjectId(agentTypeId),
          modelId,
        },
        {
          $set: { prompt },
          $setOnInsert: {
            agentType: new Types.ObjectId(agentTypeId),
            modelId,
          },
        },
        { upsert: true, new: true },
      )
      .lean()
      .exec();

    this.logger.log('Agent type prompt upserted', {
      agentTypeId,
      modelId,
    });

    return this.toPromptResponse(result!);
  }

  async deletePrompt(agentTypeId: string, modelId: string): Promise<void> {
    const result = await this.agentTypePromptModel
      .findOneAndDelete({
        agentType: new Types.ObjectId(agentTypeId),
        modelId,
      })
      .exec();

    if (!result) {
      throw new NotFoundException(ErrorCode.AGENT_TYPE_PROMPT_NOT_FOUND);
    }

    this.logger.log('Agent type prompt deleted', {
      agentTypeId,
      modelId,
    });
  }

  async resolvePrompt(agentTypeId: string, modelId: string): Promise<string> {
    const prompt = await this.agentTypePromptModel
      .findOne({
        agentType: new Types.ObjectId(agentTypeId),
        modelId,
      })
      .lean()
      .exec();

    if (prompt) {
      return prompt.prompt;
    }

    const agentType = await this.agentTypeModel.findById(agentTypeId).lean().exec();
    return (agentType?.defaultPrompt as string) || '';
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
    const orConditions = Array.from(uniquePairs.values()).map((p) => ({
      agentType: new Types.ObjectId(p.agentTypeId),
      modelId: p.modelId,
    }));

    const modelPrompts = await this.agentTypePromptModel
      .find({ $or: orConditions })
      .lean()
      .exec();

    // Fill found prompts
    const foundKeys = new Set<string>();
    for (const mp of modelPrompts) {
      const key = `${mp.agentType.toString()}:${mp.modelId}`;
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
      const agentTypes = await this.agentTypeModel
        .find({
          _id: { $in: Array.from(missingAgentTypeIds).map((id) => new Types.ObjectId(id)) },
        })
        .select('defaultPrompt')
        .lean()
        .exec();

      const defaultPromptMap = new Map<string, string>();
      for (const at of agentTypes) {
        defaultPromptMap.set(at._id.toString(), (at.defaultPrompt as string) || '');
      }

      // Fill missing pairs with defaultPrompt
      for (const [key, pair] of uniquePairs) {
        if (!foundKeys.has(key)) {
          result.set(key, defaultPromptMap.get(pair.agentTypeId) || '');
        }
      }
    }

    return result;
  }

  // ==========================================
  // Private helpers
  // ==========================================

  private generateSlug(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '_');
  }

  private async getPromptCountsForIds(
    agentTypeIds: Types.ObjectId[],
  ): Promise<Map<string, number>> {
    const countMap = new Map<string, number>();

    if (agentTypeIds.length === 0) {
      return countMap;
    }

    const counts = await this.agentTypePromptModel.aggregate<{
      _id: Types.ObjectId;
      count: number;
    }>([
      { $match: { agentType: { $in: agentTypeIds } } },
      { $group: { _id: '$agentType', count: { $sum: 1 } } },
    ]);

    for (const c of counts) {
      countMap.set(c._id.toString(), c.count);
    }

    return countMap;
  }

  private toResponse(
    doc: AgentTypeDocument | Record<string, unknown>,
    promptCount: number,
  ): IAgentTypeResponse {
    const d = doc as Record<string, unknown>;
    return {
      id: (d._id as { toString(): string }).toString(),
      name: d.name as string,
      slug: d.slug as string,
      defaultPrompt: (d.defaultPrompt as string) || '',
      skills: ((d.skills as Array<{ toString(): string }>) || []).map((id) => id.toString()),
      promptCount,
      isActive: d.isActive as boolean,
      createdAt: d.createdAt as Date,
      updatedAt: d.updatedAt as Date,
    };
  }

  private toPromptResponse(
    doc: AgentTypePromptDocument | Record<string, unknown>,
  ): IAgentTypePromptResponse {
    const d = doc as Record<string, unknown>;
    return {
      id: (d._id as { toString(): string }).toString(),
      agentTypeId: (d.agentType as { toString(): string }).toString(),
      modelId: d.modelId as string,
      prompt: d.prompt as string,
      createdAt: d.createdAt as Date,
      updatedAt: d.updatedAt as Date,
    };
  }
}
