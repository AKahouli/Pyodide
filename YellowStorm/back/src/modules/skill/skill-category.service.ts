import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConflictException, ForbiddenException, NotFoundException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { SkillCategory, SkillCategoryDocument } from './schemas/skill-category.schema';
import { CreateSkillCategoryDto } from './dto/create-skill-category.dto';
import { UpdateSkillCategoryDto } from './dto/update-skill-category.dto';
import { ISkillCategoryResponse } from './interfaces/skill.interface';

/** Reserved built-in category. Skills assigned to it are hidden from end users. */
export const SYSTEM_CATEGORY_NAME = 'System';

@Injectable()
export class SkillCategoryService implements OnModuleInit {
  constructor(
    @InjectModel(SkillCategory.name)
    private readonly categoryModel: Model<SkillCategoryDocument>,
  ) {}

  /** Ensure the reserved "System" category exists and is flagged, on every boot. */
  async onModuleInit(): Promise<void> {
    const existing = await this.categoryModel
      .findOne({ name: { $regex: `^${SYSTEM_CATEGORY_NAME}$`, $options: 'i' } })
      .exec();

    if (existing) {
      if (!existing.isSystem) {
        existing.isSystem = true;
        await existing.save();
      }
      return;
    }

    await this.categoryModel.create({
      name: SYSTEM_CATEGORY_NAME,
      description: 'Built-in skills hidden from users.',
      isSystem: true,
    });
  }

  async create(dto: CreateSkillCategoryDto): Promise<ISkillCategoryResponse> {
    if (dto.name.trim().toLowerCase() === SYSTEM_CATEGORY_NAME.toLowerCase()) {
      throw new ConflictException(
        ErrorCode.SKILL_CATEGORY_ALREADY_EXISTS,
        `"${SYSTEM_CATEGORY_NAME}" is a reserved category name.`,
      );
    }

    const existing = await this.categoryModel.findOne({ name: dto.name }).lean().exec();
    if (existing) {
      throw new ConflictException(ErrorCode.SKILL_CATEGORY_ALREADY_EXISTS);
    }

    const category = await this.categoryModel.create({
      name: dto.name,
      description: dto.description ?? '',
    });

    return this.toResponse(category);
  }

  async findAll(): Promise<ISkillCategoryResponse[]> {
    const categories = await this.categoryModel.find().sort({ name: 1 }).lean().exec();
    return categories.map((c) => this.toResponse(c));
  }

  async findById(id: string): Promise<ISkillCategoryResponse> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(ErrorCode.SKILL_CATEGORY_NOT_FOUND);
    }

    const category = await this.categoryModel.findById(id).lean().exec();
    if (!category) {
      throw new NotFoundException(ErrorCode.SKILL_CATEGORY_NOT_FOUND);
    }

    return this.toResponse(category);
  }

  async update(id: string, dto: UpdateSkillCategoryDto): Promise<ISkillCategoryResponse> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(ErrorCode.SKILL_CATEGORY_NOT_FOUND);
    }

    const current = await this.categoryModel.findById(id).exec();
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
      const conflict = await this.categoryModel
        .findOne({ name: dto.name, _id: { $ne: current._id } })
        .lean()
        .exec();
      if (conflict) {
        throw new ConflictException(ErrorCode.SKILL_CATEGORY_ALREADY_EXISTS);
      }
      current.name = dto.name;
    }

    if (dto.description !== undefined) {
      current.description = dto.description;
    }

    await current.save();
    return this.toResponse(current);
  }

  async delete(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(ErrorCode.SKILL_CATEGORY_NOT_FOUND);
    }

    const current = await this.categoryModel.findById(id).exec();
    if (!current) {
      throw new NotFoundException(ErrorCode.SKILL_CATEGORY_NOT_FOUND);
    }

    if (current.isSystem) {
      throw new ForbiddenException(
        ErrorCode.FORBIDDEN,
        `The "${SYSTEM_CATEGORY_NAME}" category cannot be deleted.`,
      );
    }

    await current.deleteOne();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toResponse(doc: any): ISkillCategoryResponse {
    return {
      id: doc._id?.toString() ?? doc.id,
      name: doc.name,
      description: doc.description ?? '',
      isSystem: doc.isSystem ?? false,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
