import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { ConflictException, ForbiddenException, NotFoundException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { SKILL_CATEGORY_STORE, type SkillCategoryRow, type SkillCategoryStore } from './persistence/skill.store';
import { CreateSkillCategoryDto } from './dto/create-skill-category.dto';
import { UpdateSkillCategoryDto } from './dto/update-skill-category.dto';
import { ISkillCategoryResponse } from './interfaces/skill.interface';

/** Reserved built-in category. Skills assigned to it are hidden from end users. */
export const SYSTEM_CATEGORY_NAME = 'System';

@Injectable()
export class SkillCategoryService implements OnModuleInit {
  constructor(
    @Inject(SKILL_CATEGORY_STORE)
    private readonly categoryStore: SkillCategoryStore,
  ) {}

  /** Ensure the reserved "System" category exists and is flagged, on every boot. */
  async onModuleInit(): Promise<void> {
    await this.categoryStore.ensureSystem({
      name: SYSTEM_CATEGORY_NAME,
      description: 'Built-in skills hidden from users.',
    });
  }

  async create(dto: CreateSkillCategoryDto): Promise<ISkillCategoryResponse> {
    if (dto.name.trim().toLowerCase() === SYSTEM_CATEGORY_NAME.toLowerCase()) {
      throw new ConflictException(
        ErrorCode.SKILL_CATEGORY_ALREADY_EXISTS,
        `"${SYSTEM_CATEGORY_NAME}" is a reserved category name.`,
      );
    }

    const existing = await this.categoryStore.findByNameInsensitive(dto.name);
    if (existing) {
      throw new ConflictException(ErrorCode.SKILL_CATEGORY_ALREADY_EXISTS);
    }

    const category = await this.categoryStore.insert({
      name: dto.name,
      description: dto.description ?? '',
    });

    return this.toResponse(category);
  }

  async findAll(): Promise<ISkillCategoryResponse[]> {
    const categories = await this.categoryStore.findAll();
    return categories.map((c) => this.toResponse(c));
  }

  async findById(id: string): Promise<ISkillCategoryResponse> {
    if (!isObjectId(id)) {
      throw new NotFoundException(ErrorCode.SKILL_CATEGORY_NOT_FOUND);
    }

    const category = await this.categoryStore.findById(id);
    if (!category) {
      throw new NotFoundException(ErrorCode.SKILL_CATEGORY_NOT_FOUND);
    }

    return this.toResponse(category);
  }

  async update(id: string, dto: UpdateSkillCategoryDto): Promise<ISkillCategoryResponse> {
    if (!isObjectId(id)) {
      throw new NotFoundException(ErrorCode.SKILL_CATEGORY_NOT_FOUND);
    }

    const current = await this.categoryStore.findById(id);
    if (!current) {
      throw new NotFoundException(ErrorCode.SKILL_CATEGORY_NOT_FOUND);
    }

    if (current.isSystem) {
      throw new ForbiddenException(
        ErrorCode.FORBIDDEN,
        `The "${SYSTEM_CATEGORY_NAME}" category cannot be modified.`,
      );
    }

    if (dto.name && dto.name.trim().toLowerCase() === SYSTEM_CATEGORY_NAME.toLowerCase()) {
      throw new ConflictException(
        ErrorCode.SKILL_CATEGORY_ALREADY_EXISTS,
        `"${SYSTEM_CATEGORY_NAME}" is a reserved category name.`,
      );
    }

    if (dto.name && dto.name !== current.name) {
      const conflict = await this.categoryStore.findByNameInsensitive(dto.name);
      if (conflict && conflict.id !== current.id) {
        throw new ConflictException(ErrorCode.SKILL_CATEGORY_ALREADY_EXISTS);
      }
    }

    const updated = await this.categoryStore.update(id, dto);
    if (!updated) {
      throw new NotFoundException(ErrorCode.SKILL_CATEGORY_NOT_FOUND);
    }
    return this.toResponse(updated);
  }

  async delete(id: string): Promise<void> {
    if (!isObjectId(id)) {
      throw new NotFoundException(ErrorCode.SKILL_CATEGORY_NOT_FOUND);
    }

    const current = await this.categoryStore.findById(id);
    if (!current) {
      throw new NotFoundException(ErrorCode.SKILL_CATEGORY_NOT_FOUND);
    }

    if (current.isSystem) {
      throw new ForbiddenException(
        ErrorCode.FORBIDDEN,
        `The "${SYSTEM_CATEGORY_NAME}" category cannot be deleted.`,
      );
    }

    await this.categoryStore.delete(id);
  }

  private toResponse(row: SkillCategoryRow): ISkillCategoryResponse {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      isSystem: row.isSystem,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
