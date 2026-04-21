import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Workspace, WorkspaceDocument } from './schemas/workspace.schema';
import { WorkspaceResponse } from './interfaces/workspace.interface';
import { LoggerService } from '../logger';
import { ForbiddenException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';

const PERSONAL_WORKSPACE_NAME = 'Mon workspace personnel';
const PERSONAL_WORKSPACE_ALIAS = 'mon-workspace-personnel';
const PERSONAL_WORKSPACE_DESCRIPTION = 'Votre espace personnel pour organiser vos fichiers';

@Injectable()
export class WorkspaceInitializerService {
  constructor(
    @InjectModel(Workspace.name)
    private readonly workspaceModel: Model<WorkspaceDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('WorkspaceInitializerService');
  }

  /**
   * Get or create personal workspace for a user
   * Personal workspaces cannot be renamed or deleted
   */
  async getOrCreatePersonalWorkspace(
    userId: string,
    allocatedStorage: number,
  ): Promise<WorkspaceResponse> {
    // First, try to find existing personal workspace
    const existing = await this.workspaceModel.findOne({
      createdBy: new Types.ObjectId(userId),
      isPersonal: true,
    });

    if (existing) {
      return this.mapToResponse(existing);
    }

    // Create new personal workspace
    const workspace = await this.workspaceModel.create({
      name: PERSONAL_WORKSPACE_NAME,
      alias: this.generatePersonalAlias(userId),
      description: PERSONAL_WORKSPACE_DESCRIPTION,
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
   * Generate unique alias for personal workspace
   * Uses user ID to ensure uniqueness while keeping it consistent
   */
  private generatePersonalAlias(userId: string): string {
    const hash = this.hashCode(userId);
    return `${PERSONAL_WORKSPACE_ALIAS}-${hash}`;
  }

  /**
   * Simple hash function for user ID
   */
  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Check if a workspace is a personal workspace
   */
  isPersonalWorkspace(workspace: WorkspaceDocument): boolean {
    return workspace.isPersonal === true;
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
