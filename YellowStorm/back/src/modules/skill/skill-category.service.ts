import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConflictException, NotFoundException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { SkillCategory, SkillCategoryDocument } from './schemas/skill-category.schema';
import { CreateSkillCategoryDto } from './dto/create-skill-category.dto';
import { UpdateSkillCategoryDto } from './dto/update-skill-category.dto';
import { ISkillCategoryResponse } from './interfaces/skill.interface';

@Injectable()
export class SkillCategoryService {
  constructor(
    @InjectModel(SkillCategory.name)
    private readonly categoryModel: Model<SkillCategoryDocument>,
  ) {}

  async create(dto: CreateSkillCategoryDto): Promise<ISkillCategoryResponse> {
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

    const result = await this.categoryModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(ErrorCode.SKILL_CATEGORY_NOT_FOUND);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toResponse(doc: any): ISkillCategoryResponse {
    return {
      id: doc._id?.toString() ?? doc.id,
      name: doc.name,
      description: doc.description ?? '',
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
