import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConflictException, NotFoundException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { ToolCategory, ToolCategoryDocument } from './schemas/tool-category.schema';
import { CreateToolCategoryDto } from './dto/create-tool-category.dto';
import { UpdateToolCategoryDto } from './dto/update-tool-category.dto';
import { IToolCategoryResponse } from './interfaces/tool.interface';

@Injectable()
export class ToolCategoryService {
  constructor(
    @InjectModel(ToolCategory.name)
    private readonly categoryModel: Model<ToolCategoryDocument>,
  ) {}

  async create(dto: CreateToolCategoryDto): Promise<IToolCategoryResponse> {
    const existing = await this.categoryModel.findOne({ name: dto.name }).lean().exec();
    if (existing) {
      throw new ConflictException(ErrorCode.TOOL_CATEGORY_ALREADY_EXISTS);
    }

    const category = await this.categoryModel.create({
      name: dto.name,
      description: dto.description ?? '',
    });

    return this.toResponse(category);
  }

  async findAll(): Promise<IToolCategoryResponse[]> {
    const categories = await this.categoryModel.find().sort({ name: 1 }).lean().exec();
    return categories.map((c) => this.toResponse(c));
  }

  async findById(id: string): Promise<IToolCategoryResponse> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(ErrorCode.TOOL_CATEGORY_NOT_FOUND);
    }

    const category = await this.categoryModel.findById(id).lean().exec();
    if (!category) {
      throw new NotFoundException(ErrorCode.TOOL_CATEGORY_NOT_FOUND);
    }

    return this.toResponse(category);
  }

  async update(id: string, dto: UpdateToolCategoryDto): Promise<IToolCategoryResponse> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(ErrorCode.TOOL_CATEGORY_NOT_FOUND);
    }

    const current = await this.categoryModel.findById(id).exec();
    if (!current) {
      throw new NotFoundException(ErrorCode.TOOL_CATEGORY_NOT_FOUND);
    }

    if (dto.name && dto.name !== current.name) {
      const conflict = await this.categoryModel
        .findOne({ name: dto.name, _id: { $ne: current._id } })
        .lean()
        .exec();
      if (conflict) {
        throw new ConflictException(ErrorCode.TOOL_CATEGORY_ALREADY_EXISTS);
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
      throw new NotFoundException(ErrorCode.TOOL_CATEGORY_NOT_FOUND);
    }

    const result = await this.categoryModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(ErrorCode.TOOL_CATEGORY_NOT_FOUND);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toResponse(doc: any): IToolCategoryResponse {
    return {
      id: doc._id?.toString() ?? doc.id,
      name: doc.name,
      description: doc.description ?? '',
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
