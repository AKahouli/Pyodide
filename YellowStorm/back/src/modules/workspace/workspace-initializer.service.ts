import { Injectable } from '@nestjs/common';
import { WorkspaceResponse } from './interfaces/workspace.interface';
import { LoggerService } from '../logger';
import type { WorkspaceRecord } from './ports/workspace-records';
import { PgWorkspaceStore } from './stores/postgres/pg-workspace-store';

const PERSONAL_WORKSPACE_NAME = 'Mon workspace personnel';
const PERSONAL_WORKSPACE_ALIAS = 'mon-workspace-personnel';
const PERSONAL_WORKSPACE_DESCRIPTION = 'Votre espace personnel pour organiser vos fichiers';

@Injectable()
export class WorkspaceInitializerService {
  constructor(
    private readonly workspaceStore: PgWorkspaceStore,
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
    const existing = await this.workspaceStore.findByOwnerPersonal(userId);

    if (existing) {
      return this.mapToResponse(existing);
    }

    // Create new personal workspace
    const personalAlias = this.generatePersonalAlias(userId);
    const workspace = await this.workspaceStore.create({
      name: PERSONAL_WORKSPACE_NAME,
      alias: personalAlias,
      storagePrefix: personalAlias,
      description: PERSONAL_WORKSPACE_DESCRIPTION,
      createdBy: userId,
      allocatedStorage,
      isSystem: false,
      isPersonal: true,
    });

    this.logger.log('Personal workspace created', {
      workspaceId: workspace.id,
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
      const code = str.codePointAt(i) ?? 0;
      hash = ((hash << 5) - hash) + code;
      hash = hash & hash; // Convert to 32bit integer
      if (code > 0xffff) {
        i++;
      }
    }
    return Math.abs(hash);
  }

  /**
   * Check if a workspace is a personal workspace
   */
  isPersonalWorkspace(workspace: WorkspaceRecord): boolean {
    return workspace.isPersonal;
  }

  /**
   * Map workspace record to response
   */
  private mapToResponse(workspace: WorkspaceRecord): WorkspaceResponse {
    return {
      id: workspace.id,
      name: workspace.name,
      alias: workspace.alias,
      storagePrefix: workspace.storagePrefix,
      description: workspace.description,
      createdBy: workspace.createdBy,
      settings: workspace.settingsId,
      documentCount: workspace.documentCount,
      usedStorage: workspace.usedStorage,
      allocatedStorage: workspace.allocatedStorage,
      isSystem: workspace.isSystem,
      isPersonal: workspace.isPersonal,
      shareCount: workspace.shareCount,
      isPublic: workspace.isPublic,
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
    };
  }
}
