import { Injectable,  OnModuleInit } from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { ConflictException, ForbiddenException, NotFoundException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { type ConnectorCategoryRow} from './persistence/connector.store';
import { CreateConnectorCategoryDto } from './dto/create-connector-category.dto';
import { UpdateConnectorCategoryDto } from './dto/update-connector-category.dto';
import { IConnectorCategoryResponse } from './interfaces/connector.interface';
import { PgConnectorCategoryStore } from './persistence/pg-connector.store';

/** Reserved built-in category. Connectors assigned to it are hidden from end users. */
export const SYSTEM_CATEGORY_NAME = 'System';
export const WEB_SEARCH_CATEGORY_NAME = 'Web Search';
const SYSTEM_OWNER_ID = '000000000000000000000000';

@Injectable()
export class ConnectorCategoryService implements OnModuleInit {
  constructor(
    private readonly categoryStore: PgConnectorCategoryStore,
  ) {}

  /** Ensure the reserved "System" category exists and is flagged, on every boot. */
  async onModuleInit(): Promise<void> {
    await this.categoryStore.ensureSystem(
      SYSTEM_CATEGORY_NAME,
      SYSTEM_OWNER_ID,
      'Built-in connectors hidden from users.',
    );
  }

  async create(createdBy: string, dto: CreateConnectorCategoryDto): Promise<IConnectorCategoryResponse> {
    if (dto.name.trim().toLowerCase() === SYSTEM_CATEGORY_NAME.toLowerCase()) {
      throw new ConflictException(
        ErrorCode.CONNECTOR_CATEGORY_ALREADY_EXISTS,
        `"${SYSTEM_CATEGORY_NAME}" is a reserved category name.`,
      );
    }

    const existing = await this.categoryStore.findByOwnerName(createdBy, dto.name);

    if (existing) {
      throw new ConflictException(ErrorCode.CONNECTOR_CATEGORY_ALREADY_EXISTS);
    }

    const category = await this.categoryStore.insert({
      name: dto.name,
      description: dto.description ?? '',
      createdBy,
    });

    return this.toResponse(category);
  }

  async findAll(): Promise<IConnectorCategoryResponse[]> {
    const categories = await this.categoryStore.findAll();
    return categories.map((c) => this.toResponse(c));
  }

  async findById(id: string): Promise<IConnectorCategoryResponse> {
    if (!isObjectId(id)) {
      throw new NotFoundException(ErrorCode.CONNECTOR_CATEGORY_NOT_FOUND);
    }

    const category = await this.categoryStore.findById(id);
    if (!category) {
      throw new NotFoundException(ErrorCode.CONNECTOR_CATEGORY_NOT_FOUND);
    }

    return this.toResponse(category);
  }

  async update(id: string, dto: UpdateConnectorCategoryDto): Promise<IConnectorCategoryResponse> {
    if (!isObjectId(id)) {
      throw new NotFoundException(ErrorCode.CONNECTOR_CATEGORY_NOT_FOUND);
    }

    const current = await this.categoryStore.findById(id);
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
      const conflict = await this.categoryStore.findByOwnerName(current.createdBy, dto.name);
      if (conflict && conflict.id !== current.id) {
        throw new ConflictException(ErrorCode.CONNECTOR_CATEGORY_ALREADY_EXISTS);
      }
    }

    const updated = await this.categoryStore.update(id, dto);
    if (!updated) {
      throw new NotFoundException(ErrorCode.CONNECTOR_CATEGORY_NOT_FOUND);
    }
    return this.toResponse(updated);
  }

  async delete(id: string): Promise<void> {
    if (!isObjectId(id)) {
      throw new NotFoundException(ErrorCode.CONNECTOR_CATEGORY_NOT_FOUND);
    }

    const current = await this.categoryStore.findById(id);
    if (!current) {
      throw new NotFoundException(ErrorCode.CONNECTOR_CATEGORY_NOT_FOUND);
    }

    if (current.isSystem) {
      throw new ForbiddenException(
        ErrorCode.FORBIDDEN,
        `The "${SYSTEM_CATEGORY_NAME}" category cannot be deleted.`,
      );
    }

    await this.categoryStore.delete(id);
  }

   
  private toResponse(doc: ConnectorCategoryRow): IConnectorCategoryResponse {
    return {
      id: doc.id,
      name: doc.name,
      description: doc.description ?? '',
      isSystem: doc.isSystem ?? false,
      createdBy: doc.createdBy?.toString() ?? '',
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
