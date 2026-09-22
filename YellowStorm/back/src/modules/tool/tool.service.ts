import { Inject, Injectable } from '@nestjs/common';
import { LoggerService } from '../logger';
import { TOOL_STORE, type ToolRow, type ToolStore } from './persistence/tool.store';
import { ToolAttributeType } from './tool.types';
import { IToolResponse } from './interfaces/tool.interface';
import { CreateToolDto } from './dto/create-tool.dto';
import { UpdateToolDto } from './dto/update-tool.dto';
import { QueryToolDto } from './dto/query-tool.dto';
import { ToolAttributeDto } from './dto/tool-attribute.dto';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { NotFoundException, ConflictException, BadRequestException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';

@Injectable()
export class ToolService {
  constructor(
    @Inject(TOOL_STORE)
    private readonly toolStore: ToolStore,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ToolService.name);
  }

  async create(dto: CreateToolDto): Promise<IToolResponse> {
    // Check name uniqueness
    const existing = await this.toolStore.findByName(dto.name);
    if (existing) {
      throw new ConflictException(ErrorCode.TOOL_ALREADY_EXISTS);
    }

    // Validate attributes
    if (dto.attributes?.length) {
      this.validateAttributes(dto.attributes);
    }

    const tool = await this.toolStore.insert({
      name: dto.name,
      description: dto.description ?? '',
      icon: dto.icon ?? '',
      color: dto.color ?? '',
      iconColor: dto.iconColor ?? 'light',
      categoryId: dto.categoryId ?? null,
      defaultAgentTypes: dto.defaultAgentTypes ?? [],
      attributes: dto.attributes ?? [],
      requiredAppKey: dto.requiredAppKey || null,
      isActive: dto.isActive ?? true,
    });

    this.logger.log('Tool created', {
      toolId: tool.id,
      name: tool.name,
    });

    return this.toToolResponse(tool);
  }

  async findAll(query: QueryToolDto): Promise<PaginatedResponseDto<IToolResponse>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const { rows, total } = await this.toolStore.list({
      search: query.search,
      agentType: query.agentType,
      isActive: query.isActive,
      page,
      limit,
    });

    return new PaginatedResponseDto(
      rows.map((tool) => this.toToolResponse(tool)),
      total,
      page,
      limit,
    );
  }

  async findById(id: string): Promise<IToolResponse> {
    const tool = await this.toolStore.findById(id);
    if (!tool) {
      throw new NotFoundException(ErrorCode.TOOL_NOT_FOUND);
    }
    return this.toToolResponse(tool);
  }

  async findByAgentType(agentType: string): Promise<IToolResponse[]> {
    const tools = await this.toolStore.findByAgentType(agentType);
    return tools.map((tool) => this.toToolResponse(tool));
  }

  async findByAgentTypeName(name: string): Promise<IToolResponse[]> {
    return this.findByAgentType(name);
  }

  async findAllActive(): Promise<IToolResponse[]> {
    const tools = await this.toolStore.findAllActive();
    return tools.map((tool) => this.toToolResponse(tool));
  }

  async findByIds(ids: string[]): Promise<IToolResponse[]> {
    const tools = await this.toolStore.findByIds(ids);
    return tools.map((tool) => this.toToolResponse(tool));
  }

  async update(id: string, dto: UpdateToolDto): Promise<IToolResponse> {
    const existing = await this.toolStore.findById(id);
    if (!existing) {
      throw new NotFoundException(ErrorCode.TOOL_NOT_FOUND);
    }

    // Check name uniqueness if changing name
    if (dto.name && dto.name !== existing.name) {
      const duplicate = await this.toolStore.findByName(dto.name);
      if (duplicate) {
        throw new ConflictException(ErrorCode.TOOL_ALREADY_EXISTS);
      }
    }

    // Validate attributes
    if (dto.attributes?.length) {
      this.validateAttributes(dto.attributes);
    }
    // Normalize requiredAppKey: empty string → null (clear the field)
    const updateData: Record<string, unknown> = { ...dto };
    if ('requiredAppKey' in updateData) {
      updateData.requiredAppKey = (updateData.requiredAppKey as string) || null;
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'categoryId')) {
      updateData.categoryId = (updateData.categoryId as string) || null;
    }

    const tool = await this.toolStore.update(id, updateData);

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
    // agent_tools junction rows cascade via the validated FK; no manual pull needed.
    const tool = await this.toolStore.delete(id);

    if (!tool) {
      throw new NotFoundException(ErrorCode.TOOL_NOT_FOUND);
    }

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

  private toToolResponse(tool: ToolRow | Record<string, unknown>): IToolResponse {
    return {
      id: tool.id as string,
      name: tool.name as string,
      description: (tool.description as string) || '',
      icon: (tool.icon as string) || '',
      color: (tool.color as string) || '',
      iconColor: ((tool.iconColor as 'light' | 'dark') || 'light'),
      categoryId: (tool.categoryId as string) || null,
      defaultAgentTypes: (tool.defaultAgentTypes as string[]) || [],
      attributes: ((tool.attributes as Record<string, unknown>[]) || []).map((attr) => ({
        id: attr.id as string | undefined,
        name: attr.name as string,
        type: attr.type as ToolAttributeType,
        value: attr.value as string | number | boolean,
        options: attr.options as string[] | undefined,
      })),
      requiredAppKey: (tool.requiredAppKey as string) || undefined,
      isActive: tool.isActive as boolean,
      createdAt: tool.createdAt as Date,
      updatedAt: tool.updatedAt as Date,
    };
  }
}
