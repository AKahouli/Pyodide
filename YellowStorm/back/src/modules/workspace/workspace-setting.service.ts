import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WorkspaceSetting,
  WorkspaceSettingDocument,
} from './schemas/workspace-setting.schema';
import {
  CreateWorkspaceSettingData,
  UpdateWorkspaceSettingData,
  WorkspaceSettingQueryParams,
  WorkspaceSettingResponse,
  PaginatedWorkspaceSettings,
} from './interfaces/workspace-setting.interface';
import { LoggerService } from '../logger';
import { NotFoundException, ForbiddenException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { escapeRegex } from '../../common/utils';

@Injectable()
export class WorkspaceSettingService {
  constructor(
    @InjectModel(WorkspaceSetting.name)
    private readonly settingModel: Model<WorkspaceSettingDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('WorkspaceSettingService');
  }

  /**
   * Create a new workspace setting
   */
  async create(
    userId: string,
    data: CreateWorkspaceSettingData,
  ): Promise<WorkspaceSettingResponse> {
    const setting = await this.settingModel.create({
      name: data.name,
      description: data.description,
      tag: data.tag,
      llmModel: data.model,
      isTemplate: data.isTemplate ?? false,
      isPredefined: data.isPredefined ?? false,
      createdBy: new Types.ObjectId(userId),
      instruction: data.instruction,
      chunks: data.chunks ?? 5,
      hybridSearch: data.hybridSearch ?? false,
      ragType: data.ragType ?? 'standard',
      maxToken: data.maxToken ?? 4096,
      topK: data.topK ?? 10,
    });

    this.logger.log('Workspace setting created', {
      settingId: setting._id,
      userId,
      name: data.name,
      isTemplate: setting.isTemplate,
    });

    return this.mapToResponse(setting);
  }

  /**
   * Get setting by ID
   */
  async findById(settingId: string, userId?: string): Promise<WorkspaceSettingResponse> {
    const setting = await this.settingModel.findById(settingId);

    if (!setting) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_SETTING_NOT_FOUND,
        'Workspace setting not found',
      );
    }

    // Allow access if it's a template or user is the owner
    if (!setting.isTemplate && userId && setting.createdBy.toString() !== userId) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_SETTING_FORBIDDEN,
        'You do not have access to this setting',
      );
    }

    return this.mapToResponse(setting);
  }

  /**
   * List settings for a user with pagination
   */
  async findAllByUser(
    userId: string,
    params: WorkspaceSettingQueryParams,
  ): Promise<PaginatedWorkspaceSettings> {
    const {
      page = 1,
      limit = 20,
      tag,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = params;

    const skip = (page - 1) * limit;

    // Build query - user's own settings
    const query: Record<string, unknown> = {
      createdBy: new Types.ObjectId(userId),
    };

    if (tag) {
      query.tag = tag;
    }

    if (search) {
      const escapedSearch = escapeRegex(search);
      query.$or = [
        { name: { $regex: escapedSearch, $options: 'i' } },
        { description: { $regex: escapedSearch, $options: 'i' } },
      ];
    }

    // Build sort
    const sort: Record<string, 1 | -1> = {
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };

    // Execute queries
    const [settings, total] = await Promise.all([
      this.settingModel.find(query).sort(sort).skip(skip).limit(limit).exec(),
      this.settingModel.countDocuments(query),
    ]);

    return {
      settings: settings.map((s) => this.mapToResponse(s)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * List public templates with pagination
   */
  async findTemplates(
    params: WorkspaceSettingQueryParams,
  ): Promise<PaginatedWorkspaceSettings> {
    const {
      page = 1,
      limit = 20,
      tag,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = params;

    const skip = (page - 1) * limit;

    // Build query - only templates
    const query: Record<string, unknown> = {
      isTemplate: true,
    };

    if (tag) {
      query.tag = tag;
    }

    if (search) {
      const escapedSearch = escapeRegex(search);
      query.$or = [
        { name: { $regex: escapedSearch, $options: 'i' } },
        { description: { $regex: escapedSearch, $options: 'i' } },
      ];
    }

    // Build sort
    const sort: Record<string, 1 | -1> = {
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };

    // Execute queries
    const [settings, total] = await Promise.all([
      this.settingModel.find(query).sort(sort).skip(skip).limit(limit).exec(),
      this.settingModel.countDocuments(query),
    ]);

    // Map to response and sort predefined templates first
    const mappedSettings = settings.map((s) => this.mapToResponse(s));
    const sortedSettings = mappedSettings.sort((a, b) => {
      if (a.isPredefined && !b.isPredefined) return -1;
      if (!a.isPredefined && b.isPredefined) return 1;
      return 0; // Keep existing sort within groups
    });

    return {
      settings: sortedSettings,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Update a workspace setting
   */
  async update(
    settingId: string,
    userId: string,
    data: UpdateWorkspaceSettingData,
  ): Promise<WorkspaceSettingResponse> {
    const setting = await this.settingModel.findById(settingId);

    if (!setting) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_SETTING_NOT_FOUND,
        'Workspace setting not found',
      );
    }

    // Predefined templates are read-only
    if (setting.isPredefined) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_SETTING_FORBIDDEN,
        'Predefined templates cannot be modified',
      );
    }

    // Verify ownership - only owner can update
    if (setting.createdBy.toString() !== userId) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_SETTING_FORBIDDEN,
        'You do not have permission to update this setting',
      );
    }

    // Update fields
    if (data.name !== undefined) setting.name = data.name;
    if (data.description !== undefined) setting.description = data.description;
    if (data.tag !== undefined) setting.tag = data.tag;
    if (data.model !== undefined) setting.llmModel = data.model;
    if (data.isTemplate !== undefined) setting.isTemplate = data.isTemplate;
    if (data.instruction !== undefined) setting.instruction = data.instruction;
    if (data.chunks !== undefined) setting.chunks = data.chunks;
    if (data.hybridSearch !== undefined) setting.hybridSearch = data.hybridSearch;
    if (data.ragType !== undefined) setting.ragType = data.ragType;
    if (data.maxToken !== undefined) setting.maxToken = data.maxToken;
    if (data.topK !== undefined) setting.topK = data.topK;

    await setting.save();

    this.logger.log('Workspace setting updated', {
      settingId: setting._id,
      userId,
    });

    return this.mapToResponse(setting);
  }

  /**
   * Delete a workspace setting
   */
  async delete(settingId: string, userId: string): Promise<void> {
    const setting = await this.settingModel.findById(settingId);

    if (!setting) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_SETTING_NOT_FOUND,
        'Workspace setting not found',
      );
    }

    // Predefined templates cannot be deleted
    if (setting.isPredefined) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_SETTING_FORBIDDEN,
        'Predefined templates cannot be deleted',
      );
    }

    // Verify ownership - only owner can delete
    if (setting.createdBy.toString() !== userId) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_SETTING_FORBIDDEN,
        'You do not have permission to delete this setting',
      );
    }

    await this.settingModel.deleteOne({ _id: settingId });

    this.logger.log('Workspace setting deleted', {
      settingId,
      userId,
      name: setting.name,
    });
  }

  /**
   * Map setting document to response
   */
  private mapToResponse(setting: WorkspaceSettingDocument): WorkspaceSettingResponse {
    return {
      id: setting._id.toString(),
      name: setting.name,
      description: setting.description,
      tag: setting.tag,
      model: setting.llmModel,
      isTemplate: setting.isTemplate,
      isPredefined: setting.isPredefined,
      createdBy: setting.createdBy.toString(),
      instruction: setting.instruction,
      chunks: setting.chunks,
      hybridSearch: setting.hybridSearch,
      ragType: setting.ragType,
      maxToken: setting.maxToken,
      topK: setting.topK,
      createdAt: setting.createdAt.toISOString(),
      updatedAt: setting.updatedAt.toISOString(),
    };
  }
}
