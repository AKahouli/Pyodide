import { Injectable } from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { ConflictException, NotFoundException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { type ToolCategoryRow } from './persistence/tool.store';
import { PgToolCategoryStore } from './persistence/pg-tool.store';
import { CreateToolCategoryDto } from './dto/create-tool-category.dto';
import { UpdateToolCategoryDto } from './dto/update-tool-category.dto';
import { IToolCategoryResponse } from './interfaces/tool.interface';

@Injectable()
export class ToolCategoryService {
  constructor(
    private readonly categoryStore: PgToolCategoryStore,
  ) {}

  async create(dto: CreateToolCategoryDto): Promise<IToolCategoryResponse> {
    const existing = await this.categoryStore.findByName(dto.name);
    if (existing) {
      throw new ConflictException(ErrorCode.TOOL_CATEGORY_ALREADY_EXISTS);
    }

    const category = await this.categoryStore.insert({
      name: dto.name,
      description: dto.description ?? '',
    });

    return this.toResponse(category);
  }

  async findAll(): Promise<IToolCategoryResponse[]> {
    const categories = await this.categoryStore.findAll();
    return categories.map((c) => this.toResponse(c));
  }

  async findById(id: string): Promise<IToolCategoryResponse> {
    if (!isObjectId(id)) {
      throw new NotFoundException(ErrorCode.TOOL_CATEGORY_NOT_FOUND);
    }

    const category = await this.categoryStore.findById(id);
    if (!category) {
      throw new NotFoundException(ErrorCode.TOOL_CATEGORY_NOT_FOUND);
    }

    return this.toResponse(category);
  }

  async update(id: string, dto: UpdateToolCategoryDto): Promise<IToolCategoryResponse> {
    if (!isObjectId(id)) {
      throw new NotFoundException(ErrorCode.TOOL_CATEGORY_NOT_FOUND);
    }

    const current = await this.categoryStore.findById(id);
    if (!current) {
      throw new NotFoundException(ErrorCode.TOOL_CATEGORY_NOT_FOUND);
    }

    if (dto.name && dto.name !== current.name) {
      const conflict = await this.categoryStore.findByName(dto.name);
      if (conflict && conflict.id !== current.id) {
        throw new ConflictException(ErrorCode.TOOL_CATEGORY_ALREADY_EXISTS);
      }
    }

    const updated = await this.categoryStore.update(id, dto);
    if (!updated) {
      throw new NotFoundException(ErrorCode.TOOL_CATEGORY_NOT_FOUND);
    }
    return this.toResponse(updated);
  }

  async delete(id: string): Promise<void> {
    if (!isObjectId(id)) {
      throw new NotFoundException(ErrorCode.TOOL_CATEGORY_NOT_FOUND);
    }

    const deleted = await this.categoryStore.delete(id);
    if (!deleted) {
      throw new NotFoundException(ErrorCode.TOOL_CATEGORY_NOT_FOUND);
    }
  }

  private toResponse(row: ToolCategoryRow): IToolCategoryResponse {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
