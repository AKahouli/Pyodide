import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery, Types } from 'mongoose';
import { LoggerService } from '../logger';
import { Tool, ToolDocument, ToolAttributeType } from './schemas/tool.schema';
import { Agent, AgentDocument } from '../agent/schemas/agent.schema';
import { IToolResponse } from './interfaces/tool.interface';
import { CreateToolDto } from './dto/create-tool.dto';
import { UpdateToolDto } from './dto/update-tool.dto';
import { QueryToolDto } from './dto/query-tool.dto';
import { ToolAttributeDto } from './dto/tool-attribute.dto';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { NotFoundException, ConflictException, BadRequestException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { escapeRegex } from '../../common/utils';

@Injectable()
export class ToolService {
  constructor(
    @InjectModel(Tool.name)
    private readonly toolModel: Model<ToolDocument>,
    @InjectModel(Agent.name)
    private readonly agentModel: Model<AgentDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ToolService.name);
  }

  async create(dto: CreateToolDto): Promise<IToolResponse> {
    // Check name uniqueness
    const existing = await this.toolModel.findOne({ name: dto.name }).lean().exec();
    if (existing) {
      throw new ConflictException(ErrorCode.TOOL_ALREADY_EXISTS);
    }

    // Validate attributes
    if (dto.attributes?.length) {
      this.validateAttributes(dto.attributes);
    }

    const tool = await this.toolModel.create({
      name: dto.name,
      description: dto.description ?? '',
      icon: dto.icon ?? '',
      color: dto.color ?? '',
      iconColor: dto.iconColor ?? 'light',
      categoryId: dto.categoryId ? new Types.ObjectId(dto.categoryId) : null,
      defaultAgentTypes: dto.defaultAgentTypes ?? [],
      attributes: dto.attributes ?? [],
      requiredAppKey: dto.requiredAppKey || null,
      isActive: dto.isActive ?? true,
    });

    this.logger.log('Tool created', {
      toolId: tool._id.toString(),
      name: tool.name,
    });

    return this.toToolResponse(tool);
  }

  async findAll(query: QueryToolDto): Promise<PaginatedResponseDto<IToolResponse>> {
    const filter: FilterQuery<ToolDocument> = {};

    if (query.search) {
      const regex = { $regex: escapeRegex(query.search), $options: 'i' };
      filter.$or = [{ name: regex }, { description: regex }];
    }

    if (query.agentType) {
      filter.defaultAgentTypes = query.agentType;
    }

    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const [tools, total] = await Promise.all([
      this.toolModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.toolModel.countDocuments(filter).exec(),
    ]);

    return new PaginatedResponseDto(
      tools.map((tool) => this.toToolResponse(tool)),
      total,
      page,
      limit,
    );
  }

  async findById(id: string): Promise<IToolResponse> {
    const tool = await this.toolModel.findById(id).lean().exec();

    if (!tool) {
      throw new NotFoundException(ErrorCode.TOOL_NOT_FOUND);
    }

    return this.toToolResponse(tool);
  }

  async findByAgentType(agentType: string): Promise<IToolResponse[]> {
    const tools = await this.toolModel
      .find({ defaultAgentTypes: agentType, isActive: true })
      .sort({ name: 1 })
      .lean()
      .exec();

    return tools.map((tool) => this.toToolResponse(tool));
  }

  async findByAgentTypeName(name: string): Promise<IToolResponse[]> {
    const tools = await this.toolModel
      .find({ defaultAgentTypes: name, isActive: true })
      .sort({ name: 1 })
      .lean()
      .exec();

    return tools.map((tool) => this.toToolResponse(tool));
  }

  async findAllActive(): Promise<IToolResponse[]> {
    const tools = await this.toolModel
      .find({ isActive: true })
      .sort({ name: 1 })
      .lean()
      .exec();
    return tools.map((tool) => this.toToolResponse(tool));
  }

  async findByIds(ids: string[]): Promise<IToolResponse[]> {
    if (!ids.length) return [];
    const objectIds = ids.map((id) => new Types.ObjectId(id));
    const tools = await this.toolModel
      .find({ _id: { $in: objectIds }, isActive: true })
      .sort({ name: 1 })
      .lean()
      .exec();
    return tools.map((tool) => this.toToolResponse(tool));
  }

  async update(id: string, dto: UpdateToolDto): Promise<IToolResponse> {
    // Check existence
    const existing = await this.toolModel.findById(id).lean().exec();
    if (!existing) {
      throw new NotFoundException(ErrorCode.TOOL_NOT_FOUND);
    }

    // Check name uniqueness if changing name
    if (dto.name && dto.name !== existing.name) {
      const duplicate = await this.toolModel.findOne({ name: dto.name }).lean().exec();
      if (duplicate) {
        throw new ConflictException(ErrorCode.TOOL_ALREADY_EXISTS);
      }
    }

    // Validate attributes
    if (dto.attributes?.length) {
      this.validateAttributes(dto.attributes);
    }
    // Normalize requiredAppKey: empty string → null (clear the field)
    const updateData = { ...dto };
    if ('requiredAppKey' in updateData) {
      (updateData as Record<string, unknown>).requiredAppKey = updateData.requiredAppKey || null;
    }
    if (Object.prototype.hasOwnProperty.call(dto, 'categoryId')) {
      (updateData as Record<string, unknown>).categoryId = dto.categoryId ? new Types.ObjectId(dto.categoryId) : null;
    }

    const tool = await this.toolModel
      .findByIdAndUpdate(id, { $set: updateData }, { new: true })
      .lean()
      .exec();

    if (!tool) {
      throw new NotFoundException(ErrorCode.TOOL_NOT_FOUND);
    }

    this.logger.log('Tool updated', {
      toolId: id,
      changes: Object.keys(dto),
    });

    return this.toToolResponse(tool);
  }

  async delete(id: string): Promise<void> {
    const tool = await this.toolModel.findByIdAndDelete(id).lean().exec();

    if (!tool) {
      throw new NotFoundException(ErrorCode.TOOL_NOT_FOUND);
    }

    // Remove tool reference from all agents
    await this.agentModel.updateMany(
      { tools: new Types.ObjectId(id) },
      { $pull: { tools: new Types.ObjectId(id) } },
    );

    this.logger.log('Tool deleted', {
      toolId: id,
      name: tool.name,
    });
  }

  private validateAttributes(attributes: ToolAttributeDto[]): void {
    // Check for duplicate attribute names
    const names = attributes.map((a) => a.name);
    const uniqueNames = new Set(names);
    if (uniqueNames.size !== names.length) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Duplicate attribute names are not allowed.');
    }

    for (const attr of attributes) {
      // Validate value matches declared type
      switch (attr.type) {
        case ToolAttributeType.STRING:
          if (typeof attr.value !== 'string') {
            throw new BadRequestException(
              ErrorCode.BAD_REQUEST,
              `Attribute "${attr.name}" must have a string value.`,
            );
          }
          break;
        case ToolAttributeType.NUMBER:
          if (typeof attr.value !== 'number') {
            throw new BadRequestException(
              ErrorCode.BAD_REQUEST,
              `Attribute "${attr.name}" must have a number value.`,
            );
          }
          break;
        case ToolAttributeType.BOOLEAN:
          if (typeof attr.value !== 'boolean') {
            throw new BadRequestException(
              ErrorCode.BAD_REQUEST,
              `Attribute "${attr.name}" must have a boolean value.`,
            );
          }
          break;
        case ToolAttributeType.ENUM:
          if (!attr.options || attr.options.length === 0) {
            throw new BadRequestException(
              ErrorCode.BAD_REQUEST,
              `Attribute "${attr.name}" of type enum must have options.`,
            );
          }
          if (typeof attr.value !== 'string' || !attr.options.includes(attr.value)) {
            throw new BadRequestException(
              ErrorCode.BAD_REQUEST,
              `Attribute "${attr.name}" value must be one of the provided options.`,
            );
          }
          break;
      }
    }
  }

  private toToolResponse(tool: ToolDocument | Record<string, unknown>): IToolResponse {
    const doc = tool as Record<string, unknown>;

    return {
      id: (doc._id as { toString(): string }).toString(),
      name: doc.name as string,
      description: (doc.description as string) || '',
      icon: (doc.icon as string) || '',
      color: (doc.color as string) || '',
      iconColor: ((doc.iconColor as 'light' | 'dark') || 'light'),
      categoryId: doc.categoryId ? (doc.categoryId as { toString(): string }).toString() : null,
      defaultAgentTypes: (doc.defaultAgentTypes as string[]) || [],
      attributes: ((doc.attributes as Record<string, unknown>[]) || []).map((attr) => ({
        id: attr._id ? (attr._id as { toString(): string }).toString() : undefined,
        name: attr.name as string,
        type: attr.type as ToolAttributeType,
        value: attr.value as string | number | boolean,
        options: attr.options as string[] | undefined,
      })),
      requiredAppKey: (doc.requiredAppKey as string) || undefined,
      isActive: doc.isActive as boolean,
      createdAt: doc.createdAt as Date,
      updatedAt: doc.updatedAt as Date,
    };
  }
}
