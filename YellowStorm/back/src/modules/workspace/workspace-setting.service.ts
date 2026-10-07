import { Inject, Injectable } from '@nestjs/common';
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
import type { WorkspaceSettingRecord } from './ports/workspace-records';
import { type SettingUpdatePatch } from './stores/setting-store';
import { PgSettingStore } from './stores/postgres/pg-setting-store';

@Injectable()
export class WorkspaceSettingService {
  constructor(
    private readonly settingStore: PgSettingStore,
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
    const setting = await this.settingStore.create({
      name: data.name,
      description: data.description,
      tag: data.tag,
      llmModel: data.model,
      isTemplate: data.isTemplate ?? false,
      isPredefined: data.isPredefined ?? false,
      createdBy: userId,
      instruction: data.instruction,
      chunks: data.chunks ?? 5,
      hybridSearch: data.hybridSearch ?? false,
      ragType: data.ragType ?? 'standard',
      maxToken: data.maxToken ?? 4096,
      topK: data.topK ?? 10,
    });

    this.logger.log('Workspace setting created', {
      settingId: setting.id,
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
    const setting = await this.settingStore.findById(settingId);

    if (!setting) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_SETTING_NOT_FOUND,
        'Workspace setting not found',
      );
    }

    // Allow access if it's a template or user is the owner
    if (!setting.isTemplate && userId && setting.createdBy !== userId) {
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

    const { items, total } = await this.settingStore.listByUser(userId, {
      tag,
      search,
      skip,
      limit,
      sortBy,
      sortOrder,
    });

    return {
      settings: items.map((s) => this.mapToResponse(s)),
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

    const { items, total } = await this.settingStore.listTemplates({
      tag,
      search,
      skip,
      limit,
      sortBy,
      sortOrder,
    });

    // Map to response and sort predefined templates first
    const mappedSettings = items.map((s) => this.mapToResponse(s));
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
    const setting = await this.settingStore.findById(settingId);

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
    if (setting.createdBy !== userId) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_SETTING_FORBIDDEN,
        'You do not have permission to update this setting',
      );
    }

    // Update fields
    const patch: SettingUpdatePatch = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    if (data.tag !== undefined) patch.tag = data.tag;
    if (data.model !== undefined) patch.llmModel = data.model;
    if (data.isTemplate !== undefined) patch.isTemplate = data.isTemplate;
    if (data.instruction !== undefined) patch.instruction = data.instruction;
    if (data.chunks !== undefined) patch.chunks = data.chunks;
    if (data.hybridSearch !== undefined) patch.hybridSearch = data.hybridSearch;
    if (data.ragType !== undefined) patch.ragType = data.ragType;
    if (data.maxToken !== undefined) patch.maxToken = data.maxToken;
    if (data.topK !== undefined) patch.topK = data.topK;

    await this.settingStore.updateFields(settingId, patch);

    this.logger.log('Workspace setting updated', {
      settingId,
      userId,
    });

    return this.mapToResponse({ ...setting, ...patch });
  }

  /**
   * Delete a workspace setting
   */
  async delete(settingId: string, userId: string): Promise<void> {
    const setting = await this.settingStore.findById(settingId);

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
    if (setting.createdBy !== userId) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_SETTING_FORBIDDEN,
        'You do not have permission to delete this setting',
      );
    }

    await this.settingStore.deleteById(settingId);

    this.logger.log('Workspace setting deleted', {
      settingId,
      userId,
      name: setting.name,
    });
  }

  /**
   * Map setting record to response
   */
  private mapToResponse(setting: WorkspaceSettingRecord): WorkspaceSettingResponse {
    return {
      id: setting.id,
      name: setting.name,
      description: setting.description,
      tag: setting.tag,
      model: setting.llmModel,
      isTemplate: setting.isTemplate,
      isPredefined: setting.isPredefined,
      createdBy: setting.createdBy,
      instruction: setting.instruction,
      chunks: setting.chunks,
      hybridSearch: setting.hybridSearch,
      ragType: setting.ragType as WorkspaceSettingResponse['ragType'],
      maxToken: setting.maxToken,
      topK: setting.topK,
      createdAt: setting.createdAt.toISOString(),
      updatedAt: setting.updatedAt.toISOString(),
    };
  }
}
