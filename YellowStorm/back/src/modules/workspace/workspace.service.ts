import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Workspace, WorkspaceDocument } from './schemas/workspace.schema';
import {
  Conversation,
  ConversationDocument,
} from '../conversation/schemas/conversation.schema';
import { Agent, AgentDocument } from '../agent/schemas/agent.schema';
import { Playbook, PlaybookDocument } from '../playbook/schemas/playbook.schema';
import {
  CreateWorkspaceData,
  UpdateWorkspaceData,
  WorkspaceQueryParams,
  WorkspaceResponse,
  PaginatedWorkspaces,
} from './interfaces/workspace.interface';
import { LoggerService } from '../logger';
import {
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { escapeRegex } from '../../common/utils';

@Injectable()
export class WorkspaceService {
  constructor(
    @InjectModel(Workspace.name)
    private readonly workspaceModel: Model<WorkspaceDocument>,
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    @InjectModel(Agent.name)
    private readonly agentModel: Model<AgentDocument>,
    @InjectModel(Playbook.name)
    private readonly playbookModel: Model<PlaybookDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('WorkspaceService');
  }

  /**
   * Generate URL-friendly alias from workspace name
   */
  private generateAlias(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 100);
  }

  /**
   * Ensure alias is unique for the user, appending number if needed
   */
  private async ensureUniqueAlias(
    userId: string,
    baseAlias: string,
    excludeWorkspaceId?: string,
  ): Promise<string> {
    let alias = baseAlias;
    let counter = 1;
    const maxAttempts = 100;

    while (counter <= maxAttempts) {
      const query: Record<string, unknown> = {
        createdBy: new Types.ObjectId(userId),
        alias,
      };

      if (excludeWorkspaceId) {
        query._id = { $ne: new Types.ObjectId(excludeWorkspaceId) };
      }

      const existing = await this.workspaceModel.findOne(query);
      if (!existing) {
        return alias;
      }

      alias = `${baseAlias}-${counter}`;
      counter++;
    }

    // Fallback to timestamp-based alias
    return `${baseAlias}-${Date.now()}`;
  }

  /**
   * Create a new workspace
   */
  async create(
    userId: string,
    data: CreateWorkspaceData,
    allocatedStorage: number,
    maxWorkspaces: number,
  ): Promise<WorkspaceResponse> {
    // Check workspace count limit
    if (maxWorkspaces !== -1) {
      const count = await this.workspaceModel.countDocuments({
        createdBy: new Types.ObjectId(userId),
        isSystem: { $ne: true },
      });

      if (count >= maxWorkspaces) {
        throw new ForbiddenException(
          ErrorCode.WORKSPACE_MAX_LIMIT_REACHED,
          `You have reached the maximum number of workspaces (${maxWorkspaces}) for your plan`,
        );
      }
    }

    // Check for duplicate name
    const existingName = await this.workspaceModel.findOne({
      createdBy: new Types.ObjectId(userId),
      name: data.name,
    });

    if (existingName) {
      throw new ConflictException(
        ErrorCode.WORKSPACE_NAME_EXISTS,
        'A workspace with this name already exists',
      );
    }

    // Generate unique alias
    const baseAlias = this.generateAlias(data.name);
    const alias = await this.ensureUniqueAlias(userId, baseAlias);

    // Create workspace
    const workspace = await this.workspaceModel.create({
      name: data.name,
      alias,
      description: data.description,
      createdBy: new Types.ObjectId(userId),
      settings: data.settings ? new Types.ObjectId(data.settings) : undefined,
      documentCount: 0,
      usedStorage: 0,
      allocatedStorage,
    });

    this.logger.log('Workspace created', {
      workspaceId: workspace._id,
      userId,
      name: data.name,
      alias,
    });

    return this.mapToResponse(workspace);
  }

  /**
   * Get workspace by ID
   */
  async findById(workspaceId: string): Promise<WorkspaceResponse> {
    const workspace = await this.workspaceModel.findById(workspaceId);

    if (!workspace) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_NOT_FOUND,
        'Workspace not found',
      );
    }

    return this.mapToResponse(workspace);
  }

  /**
   * Get workspace by alias
   */
  async findByAlias(userId: string, alias: string): Promise<WorkspaceResponse> {
    const workspace = await this.workspaceModel.findOne({
      createdBy: new Types.ObjectId(userId),
      alias,
    });

    if (!workspace) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_NOT_FOUND,
        'Workspace not found',
      );
    }

    return this.mapToResponse(workspace);
  }

  /**
   * Get or create personal workspace for a user
   */
  async getOrCreatePersonalWorkspace(
    userId: string,
    allocatedStorage: number,
  ): Promise<WorkspaceResponse> {
    const existing = await this.workspaceModel.findOne({
      createdBy: new Types.ObjectId(userId),
      isPersonal: true,
    });

    if (existing) {
      return this.mapToResponse(existing);
    }

    const workspace = await this.workspaceModel.create({
      name: 'Mon workspace personnel',
      alias: 'mon-workspace-personnel',
      description: 'Votre espace personnel pour organiser vos fichiers',
      createdBy: new Types.ObjectId(userId),
      documentCount: 0,
      usedStorage: 0,
      allocatedStorage,
      isSystem: false,
      isPersonal: true,
    });

    this.logger.log('Personal workspace created', {
      workspaceId: workspace._id,
      userId,
    });

    return this.mapToResponse(workspace);
  }

  /**
   * List workspaces for a user with pagination
   */
  async findAllByUser(
    userId: string,
    params: WorkspaceQueryParams,
  ): Promise<PaginatedWorkspaces> {
    const {
      page = 1,
      limit = 20,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = params;

    const skip = (page - 1) * limit;

    // Build query - exclude system workspaces from user listing but include personal
    const query: Record<string, unknown> = {
      createdBy: new Types.ObjectId(userId),
      isSystem: { $ne: true },
    };

    if (search) {
      const escapedSearch = escapeRegex(search);
      query.$or = [
        { name: { $regex: escapedSearch, $options: 'i' } },
        { description: { $regex: escapedSearch, $options: 'i' } },
      ];
    }

    // Build sort - always put personal workspace first
    const sort: Record<string, 1 | -1> = {
      isPersonal: -1, // Personal workspace first
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };

    // Execute queries
    const [workspaces, total] = await Promise.all([
      this.workspaceModel.find(query).sort(sort).skip(skip).limit(limit).exec(),
      this.workspaceModel.countDocuments(query),
    ]);
    return {
      workspaces: workspaces.map((w) => this.mapToResponse(w)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Update a workspace
   */
  async update(
    workspaceId: string,
    userId: string,
    data: UpdateWorkspaceData,
  ): Promise<WorkspaceResponse> {
    const workspace = await this.workspaceModel.findById(workspaceId);

    if (!workspace) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_NOT_FOUND,
        'Workspace not found',
      );
    }

    // Verify ownership
    if (workspace.createdBy.toString() !== userId) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_FORBIDDEN,
        'You do not have access to this workspace',
      );
    }

    // Prevent modifying personal workspace name
    if (workspace.isPersonal && data.name && data.name !== workspace.name) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_FORBIDDEN,
        'Cannot rename personal workspace',
      );
    }

    // Check for duplicate name if name is being updated
    if (data.name && data.name !== workspace.name) {
      const existingName = await this.workspaceModel.findOne({
        createdBy: new Types.ObjectId(userId),
        name: data.name,
        _id: { $ne: workspaceId },
      });

      if (existingName) {
        throw new ConflictException(
          ErrorCode.WORKSPACE_NAME_EXISTS,
          'A workspace with this name already exists',
        );
      }

      // Update alias when name changes
      const baseAlias = this.generateAlias(data.name);
      workspace.alias = await this.ensureUniqueAlias(userId, baseAlias, workspaceId);
      workspace.name = data.name;
    }

    // Update other fields
    if (data.description !== undefined) {
      workspace.description = data.description;
    }

    if (data.settings !== undefined) {
      workspace.settings = data.settings
        ? new Types.ObjectId(data.settings)
        : undefined;
    }

    await workspace.save();

    this.logger.log('Workspace updated', {
      workspaceId: workspace._id,
      userId,
    });

    return this.mapToResponse(workspace);
  }

  /**
   * Delete a workspace
   */
  async delete(workspaceId: string, userId: string): Promise<void> {
    const workspace = await this.workspaceModel.findById(workspaceId);

    if (!workspace) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_NOT_FOUND,
        'Workspace not found',
      );
    }

    // Verify ownership
    if (workspace.createdBy.toString() !== userId) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_FORBIDDEN,
        'You do not have access to this workspace',
      );
    }

    // Prevent deleting personal workspace
    if (workspace.isPersonal) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_FORBIDDEN,
        'Cannot delete personal workspace',
      );
    }

    await this.workspaceModel.deleteOne({ _id: workspaceId });

    // Remove workspace reference from all conversations
    await this.conversationModel.updateMany(
      { workspaces: new Types.ObjectId(workspaceId) },
      { $pull: { workspaces: new Types.ObjectId(workspaceId) } },
    );

    // Remove workspace reference from all agents' knowledge bases
    await this.agentModel.updateMany(
      { knowledgeBases: new Types.ObjectId(workspaceId) },
      { $pull: { knowledgeBases: new Types.ObjectId(workspaceId) } },
    );

    // Remove workspace reference from all playbooks
    await this.playbookModel.updateMany(
      { workspaces: new Types.ObjectId(workspaceId) },
      { $pull: { workspaces: new Types.ObjectId(workspaceId) } },
    );

    this.logger.log('Workspace deleted', {
      workspaceId,
      userId,
      name: workspace.name,
    });
  }

  /**
   * Update workspace storage usage
   */
  async updateStorageUsage(
    workspaceId: string,
    sizeDelta: number,
    countDelta: number,
  ): Promise<void> {
    await this.workspaceModel.findByIdAndUpdate(workspaceId, {
      $inc: {
        usedStorage: sizeDelta,
        documentCount: countDelta,
      },
    });
  }

  /**
   * Check if workspace has storage quota for a file
   */
  async checkStorageQuota(
    workspaceId: string,
    fileSize: number,
  ): Promise<{ allowed: boolean; available: number; used: number; allocated: number }> {
    const workspace = await this.workspaceModel.findById(workspaceId);

    if (!workspace) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_NOT_FOUND,
        'Workspace not found',
      );
    }

    const available = workspace.allocatedStorage - workspace.usedStorage;

    return {
      allowed: fileSize <= available,
      available,
      used: workspace.usedStorage,
      allocated: workspace.allocatedStorage,
    };
  }

  /**
   * Create a system workspace for conversation file uploads
   */
  async createSystemWorkspace(
    userId: string,
    conversationId: string,
    allocatedStorage: number,
  ): Promise<WorkspaceResponse> {
    const workspace = await this.workspaceModel.create({
      name: `system-${conversationId}`,
      alias: `system-${conversationId}`,
      description: 'System workspace for conversation file uploads',
      createdBy: new Types.ObjectId(userId),
      documentCount: 0,
      usedStorage: 0,
      allocatedStorage,
      isSystem: true,
      conversationId: new Types.ObjectId(conversationId),
    });

    this.logger.log('System workspace created', {
      workspaceId: workspace._id,
      userId,
      conversationId,
    });

    return this.mapToResponse(workspace);
  }

  /**
   * Find an existing system workspace for a conversation.
   */
  async findSystemWorkspace(
    userId: string,
    conversationId: string,
  ): Promise<WorkspaceResponse | null> {
    const workspace = await this.workspaceModel.findOne({
      name: `system-${conversationId}`,
      createdBy: new Types.ObjectId(userId),
      isSystem: true,
    });

    return workspace ? this.mapToResponse(workspace) : null;
  }

  /**
   * Delete a system workspace record without ownership check.
   * For internal cleanup use only (cascade delete, orphan cleanup).
   * Safety: only deletes workspaces with isSystem=true.
   */
  async deleteSystemWorkspace(workspaceId: string): Promise<void> {
    await this.workspaceModel.deleteOne({
      _id: new Types.ObjectId(workspaceId),
      isSystem: true,
    });
  }

  /**
   * Get workspace document (internal use)
   */
  async getWorkspaceDocument(workspaceId: string): Promise<WorkspaceDocument> {
    const workspace = await this.workspaceModel.findById(workspaceId);

    if (!workspace) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_NOT_FOUND,
        'Workspace not found',
      );
    }

    return workspace;
  }

  /**
   * Map workspace document to response
   */
  private mapToResponse(workspace: WorkspaceDocument): WorkspaceResponse {
    return {
      id: workspace._id.toString(),
      name: workspace.name,
      alias: workspace.alias,
      description: workspace.description,
      createdBy: workspace.createdBy.toString(),
      settings: workspace.settings?.toString(),
      documentCount: workspace.documentCount,
      usedStorage: workspace.usedStorage,
      allocatedStorage: workspace.allocatedStorage,
      isSystem: workspace.isSystem || false,
      isPersonal: workspace.isPersonal || false,
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
    };
  }
}
