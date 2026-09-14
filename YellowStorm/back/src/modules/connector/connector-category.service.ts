import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConflictException, ForbiddenException, NotFoundException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { ConnectorCategory, ConnectorCategoryDocument } from './schemas/connector-category.schema';
import { CreateConnectorCategoryDto } from './dto/create-connector-category.dto';
import { UpdateConnectorCategoryDto } from './dto/update-connector-category.dto';
import { IConnectorCategoryResponse } from './interfaces/connector.interface';

/** Reserved built-in category. Connectors assigned to it are hidden from end users. */
export const SYSTEM_CATEGORY_NAME = 'System';
export const WEB_SEARCH_CATEGORY_NAME = 'Web Search';
const SYSTEM_OWNER_ID = new Types.ObjectId('000000000000000000000000');

@Injectable()
export class ConnectorCategoryService implements OnModuleInit {
  constructor(
    @InjectModel(ConnectorCategory.name)
    private readonly categoryModel: Model<ConnectorCategoryDocument>,
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
      description: 'Built-in connectors hidden from users.',
      isSystem: true,
      createdBy: SYSTEM_OWNER_ID,
    });
  }

  async create(createdBy: string, dto: CreateConnectorCategoryDto): Promise<IConnectorCategoryResponse> {
    if (dto.name.trim().toLowerCase() === SYSTEM_CATEGORY_NAME.toLowerCase()) {
      throw new ConflictException(
        ErrorCode.CONNECTOR_CATEGORY_ALREADY_EXISTS,
        `"${SYSTEM_CATEGORY_NAME}" is a reserved category name.`,
      );
    }

    const existing = await this.categoryModel
      .findOne({ name: dto.name, createdBy: new Types.ObjectId(createdBy) })
      .lean()
      .exec();

    if (existing) {
      throw new ConflictException(ErrorCode.CONNECTOR_CATEGORY_ALREADY_EXISTS);
    }

    const category = await this.categoryModel.create({
      name: dto.name,
      description: dto.description ?? '',
      createdBy: new Types.ObjectId(createdBy),
    });

    return this.toResponse(category);
  }

  async findAll(): Promise<IConnectorCategoryResponse[]> {
    const categories = await this.categoryModel.find().sort({ name: 1 }).lean().exec();
    return categories.map((c) => this.toResponse(c));
  }

  async findById(id: string): Promise<IConnectorCategoryResponse> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(ErrorCode.CONNECTOR_CATEGORY_NOT_FOUND);
    }

    const category = await this.categoryModel.findById(id).lean().exec();
    if (!category) {
      throw new NotFoundException(ErrorCode.CONNECTOR_CATEGORY_NOT_FOUND);
    }

    return this.toResponse(category);
  }

  async update(id: string, dto: UpdateConnectorCategoryDto): Promise<IConnectorCategoryResponse> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(ErrorCode.CONNECTOR_CATEGORY_NOT_FOUND);
    }

    const current = await this.categoryModel.findById(id).exec();
    if (!current) {
      throw new NotFoundException(ErrorCode.CONNECTOR_CATEGORY_NOT_FOUND);
    }

    if (current.isSystem) {
      throw new ForbiddenException(
        ErrorCode.FORBIDDEN,
        `The "${SYSTEM_CATEGORY_NAME}" category cannot be modified.`,
      );
    }

    if (dto.name && dto.name.trim().toLowerCase() === SYSTEM_CATEGORY_NAME.toLowerCase()) {
      throw new ConflictException(
        ErrorCode.CONNECTOR_CATEGORY_ALREADY_EXISTS,
        `"${SYSTEM_CATEGORY_NAME}" is a reserved category name.`,
      );
    }

    if (dto.name && dto.name !== current.name) {
      const conflict = await this.categoryModel
        .findOne({ name: dto.name, createdBy: current.createdBy, _id: { $ne: current._id } })
        .lean()
        .exec();
      if (conflict) {
        throw new ConflictException(ErrorCode.CONNECTOR_CATEGORY_ALREADY_EXISTS);
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
      throw new NotFoundException(ErrorCode.CONNECTOR_CATEGORY_NOT_FOUND);
    }

    const current = await this.categoryModel.findById(id).exec();
    if (!current) {
      throw new NotFoundException(ErrorCode.CONNECTOR_CATEGORY_NOT_FOUND);
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
  private toResponse(doc: any): IConnectorCategoryResponse {
    return {
      id: doc._id?.toString() ?? doc.id,
      name: doc.name,
      description: doc.description ?? '',
      isSystem: doc.isSystem ?? false,
      createdBy: doc.createdBy?.toString() ?? '',
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
