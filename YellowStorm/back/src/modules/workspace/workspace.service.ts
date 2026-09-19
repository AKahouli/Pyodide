import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { withTransaction } from '@common/postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import type * as schema from '@modules/postgres/schema';
import { USER_LOOKUP_PORT, type UserLookupPort } from '@common/ports/user-lookup.port';
import {
  CONVERSATION_STORE,
  type ConversationStore,
} from '../conversation/persistence/conversation-store';
import { AgentRepository } from '../agent/repositories/agent.repository';
import { FLOW_READ_PORT, type FlowReadPort } from '../playbook-flow/ports/flow-read.port';
import {
  CreateWorkspaceData,
  UpdateWorkspaceData,
  WorkspaceQueryParams,
  WorkspaceResponse,
  PaginatedWorkspaces,
  PublicWorkspaceResponse,
  PaginatedPublicWorkspaces,
} from './interfaces/workspace.interface';
import { LoggerService } from '../logger';
import { stripLeadingTrailingChar, collapseRepeatedChar } from '@common/utils';
import {
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import type { RunCodeWorkspaceMetadata } from './interfaces/run-code-source.interface';
import type { WorkspaceRecord } from './ports/workspace-records';
import { WORKSPACE_STORE, type WorkspaceStore } from './stores/workspace-store';
import { SHARE_STORE, type ShareStore } from './stores/share-store';

@Injectable()
export class WorkspaceService implements OnModuleInit {
  constructor(
    @Inject(USER_LOOKUP_PORT) private readonly userLookup: UserLookupPort,
    @Inject(WORKSPACE_STORE) private readonly workspaceStore: WorkspaceStore,
    @Inject(SHARE_STORE) private readonly shareStore: ShareStore,
    @Inject(CONVERSATION_STORE)
    private readonly conversationStore: ConversationStore,
    private readonly agentRepository: AgentRepository,
    @Inject(FLOW_READ_PORT)
    private readonly flowReadPort: FlowReadPort,
    private readonly logger: LoggerService,
    @Optional() @Inject(DRIZZLE_DB) private readonly db?: NodePgDatabase<typeof schema>,
  ) {
    this.logger.setContext('WorkspaceService');
  }

  /**
   * Idempotent backfill: copy alias → storagePrefix for legacy workspace
   * records that predate the immutable storagePrefix field. Safe to leave in
   * place forever; the first run is the only one that does work, every
   * subsequent boot matches zero documents.
   */
  async onModuleInit(): Promise<void> {
    try {
      const modified = await this.workspaceStore.backfillStoragePrefixFromAlias();
      if (modified > 0) {
        this.logger.log('Backfilled storagePrefix from alias', {
          modified,
        });
      }
    } catch (error) {
      this.logger.error('storagePrefix backfill failed', {
        message: (error as Error).message,
      });
    }
  }

  /**
   * Generate URL-friendly alias from workspace name
   */
  private generateAlias(name: string): string {
    return stripLeadingTrailingChar(
      collapseRepeatedChar(
        name
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, '-'),
        '-',
      ),
      '-',
    ).substring(0, 100);
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
      const existing = await this.workspaceStore.findByOwnerAndAlias(userId, alias, excludeWorkspaceId);
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
      const count = await this.workspaceStore.countNonSystemByOwner(userId);

      if (count >= maxWorkspaces) {
        throw new ForbiddenException(
          ErrorCode.WORKSPACE_MAX_LIMIT_REACHED,
          `You have reached the maximum number of workspaces (${maxWorkspaces}) for your plan`,
        );
      }
    }

    // Check for duplicate name
    const existingName = await this.workspaceStore.findByName(userId, data.name);

    if (existingName) {
      throw new ConflictException(
        ErrorCode.WORKSPACE_NAME_EXISTS,
        'A workspace with this name already exists',
      );
    }

    // Generate unique alias
    const baseAlias = this.generateAlias(data.name);
    const alias = await this.ensureUniqueAlias(userId, baseAlias);

    // Create workspace. storagePrefix is locked here from the initial alias —
    // future renames update name/alias but never this field, so the Ceph path
    // remains stable across the workspace's lifetime.
    const workspace = await this.workspaceStore.create({
      name: data.name,
      alias,
      storagePrefix: alias,
      description: data.description,
      createdBy: userId,
      settingsId: data.settings,
      allocatedStorage,
    });

    this.logger.log('Workspace created', {
      workspaceId: workspace.id,
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
    const workspace = await this.workspaceStore.findById(workspaceId);

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
    const workspace = await this.workspaceStore.findByOwnerAndAlias(userId, alias);

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
    const existing = await this.workspaceStore.findByOwnerPersonal(userId);

    if (existing) {
      return this.mapToResponse(existing);
    }

    const workspace = await this.workspaceStore.create({
      name: 'Mon workspace personnel',
      alias: 'mon-workspace-personnel',
      storagePrefix: 'mon-workspace-personnel',
      description: 'Votre espace personnel pour organiser vos fichiers',
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
   * Return every non-system workspace ID owned by `userId`. Bypasses
   * pagination — intended for short flat lists (e.g. expanding an empty
   * workspace selection at session-creation time). Does not include
   * workspaces only *shared* with the user; callers that need the full
   * accessible set should compose this with WorkspaceShareService.
   */
  async findIdsByOwner(userId: string): Promise<string[]> {
    return this.workspaceStore.findIdsByOwner(userId);
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

    const { items, total } = await this.workspaceStore.listByUser(userId, {
      search,
      skip,
      limit,
      sortBy,
      sortOrder,
    });

    return {
      workspaces: items.map((w) => this.mapToResponse(w)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * List public workspaces visible to any logged-in user, excluding the
   * requester's own (those show under "my workspaces") and system workspaces.
   */
  async findPublic(
    userId: string,
    params: WorkspaceQueryParams,
  ): Promise<PaginatedPublicWorkspaces> {
    const { page = 1, limit = 20, search } = params;
    const skip = (page - 1) * limit;

    const { items: workspaces, total } = await this.workspaceStore.listPublic(userId, {
      search,
      skip,
      limit,
    });

    const owners = await this.userLookup.byIds(workspaces.map((ws) => ws.createdBy));

    const mapped: PublicWorkspaceResponse[] = workspaces
      .map((ws): PublicWorkspaceResponse | null => {
        // The owner user may have been deleted; a public workspace with no
        // existing owner shouldn't be listed — drop it rather than crash.
        const owner = owners.get(ws.createdBy);
        if (!owner) {
          return null;
        }
        return {
          id: ws.id,
          name: ws.name,
          alias: ws.alias,
          storagePrefix: ws.storagePrefix,
          description: ws.description,
          owner: {
            id: owner.id,
            email: owner.email,
            firstName: owner.firstName || undefined,
            lastName: owner.lastName || undefined,
          },
          documentCount: ws.documentCount,
          usedStorage: ws.usedStorage,
          allocatedStorage: ws.allocatedStorage,
          createdAt: ws.createdAt.toISOString(),
          updatedAt: ws.updatedAt.toISOString(),
        };
      })
      .filter((ws): ws is PublicWorkspaceResponse => ws !== null);

    return {
      workspaces: mapped,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
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
    const workspace = await this.workspaceStore.findById(workspaceId);

    if (!workspace) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_NOT_FOUND,
        'Workspace not found',
      );
    }

    // Verify ownership
    if (workspace.createdBy !== userId) {
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

    const patch: { name?: string; alias?: string; description?: string; settingsId?: string | null } = {};

    // Check for duplicate name if name is being updated
    if (data.name && data.name !== workspace.name) {
      const existingName = await this.workspaceStore.findByName(userId, data.name, workspaceId);

      if (existingName) {
        throw new ConflictException(
          ErrorCode.WORKSPACE_NAME_EXISTS,
          'A workspace with this name already exists',
        );
      }

      // Update alias when name changes
      const baseAlias = this.generateAlias(data.name);
      patch.alias = await this.ensureUniqueAlias(userId, baseAlias, workspaceId);
      patch.name = data.name;
    }

    // Update other fields
    if (data.description !== undefined) {
      patch.description = data.description;
    }

    if (data.settings !== undefined) {
      patch.settingsId = data.settings || null;
    }

    await this.workspaceStore.updateFields(workspaceId, patch);

    this.logger.log('Workspace updated', {
      workspaceId,
      userId,
    });

    const merged: WorkspaceRecord = { ...workspace, ...patch, settingsId: patch.settingsId === undefined ? workspace.settingsId : (patch.settingsId ?? undefined) };
    return this.mapToResponse(merged);
  }

  /**
   * Toggle a workspace's public visibility. Owner-only (the controller's
   * WorkspaceOwnerGuard enforces this; we re-check defensively). System
   * workspaces cannot be made public. Shares are left untouched — while public
   * they are dormant (see WorkspaceAccessGuard), and reactivate when private.
   */
  async setVisibility(
    workspaceId: string,
    ownerId: string,
    isPublic: boolean,
  ): Promise<WorkspaceResponse> {
    const workspace = await this.workspaceStore.findById(workspaceId);
    if (!workspace) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_NOT_FOUND,
        'Workspace not found',
      );
    }
    if (workspace.createdBy !== ownerId) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_FORBIDDEN,
        'You do not have access to this workspace',
      );
    }
    if (isPublic && workspace.isSystem) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_PUBLIC_FORBIDDEN_SYSTEM,
        'System workspaces cannot be made public',
      );
    }

    await this.workspaceStore.updateFields(workspaceId, { isPublic });
    this.logger.log('Workspace visibility updated', { workspaceId, ownerId, isPublic });
    return this.mapToResponse({ ...workspace, isPublic });
  }

  /**
   * Delete a workspace
   */
  async delete(workspaceId: string, userId: string): Promise<void> {
    const workspace = await this.workspaceStore.findById(workspaceId);

    if (!workspace) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_NOT_FOUND,
        'Workspace not found',
      );
    }

    // Verify ownership
    if (workspace.createdBy !== userId) {
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

    // Remove every reference BEFORE the workspace row: conversations first
    // (the conversation store runs on its own connection), then shares and
    // the workspace itself atomically.
    await this.conversationStore.removeWorkspaceFromAll(workspaceId);

    const deleteSharesAndWorkspace = async (): Promise<void> => {
      await this.shareStore.deleteManyByWorkspace(workspaceId);
      await this.workspaceStore.deleteById(workspaceId);
    };
    if (this.db) {
      await withTransaction(this.db, deleteSharesAndWorkspace);
    } else {
      await deleteSharesAndWorkspace();
    }

    // Remove workspace reference from all agents' knowledge bases
    await this.agentRepository.pullKnowledgeBaseFromAll(workspaceId);

    // Remove workspace reference from all playbooks
    await this.flowReadPort.removeWorkspaceReference(workspaceId);

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
    await this.workspaceStore.incrementCounters(workspaceId, {
      usedStorage: sizeDelta,
      documentCount: countDelta,
    });
  }

  /**
   * Check if workspace has storage quota for a file
   */
  async checkStorageQuota(
    workspaceId: string,
    fileSize: number,
  ): Promise<{ allowed: boolean; available: number; used: number; allocated: number }> {
    const workspace = await this.workspaceStore.findById(workspaceId);

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
    const workspace = await this.workspaceStore.create({
      name: `system-${conversationId}`,
      alias: `system-${conversationId}`,
      storagePrefix: `system-${conversationId}`,
      description: 'System workspace for conversation file uploads',
      createdBy: userId,
      allocatedStorage,
      isSystem: true,
      conversationId,
    });

    this.logger.log('System workspace created', {
      workspaceId: workspace.id,
      userId,
      conversationId,
    });

    return this.mapToResponse(workspace);
  }

  /**
   * Resolve a list of workspaceIds to their Ceph object-key prefixes in the
   * form `{ownerUserId}/{storagePrefix}`. Used by the conversation-v2 gRPC
   * client to translate user-supplied workspace selections into the path
   * format the AI service expects.
   *
   * - Preserves input order so the frontend selection order is meaningful.
   * - Silently drops IDs that fail to resolve (caller is expected to have
   *   already verified access via WorkspaceShareService.assertUserHasAccess,
   *   so a missing ID here is a benign race or a stale frontend selection).
   * - Single query regardless of input length.
   */
  async getStoragePathsByIds(workspaceIds: string[]): Promise<string[]> {
    if (workspaceIds.length === 0) return [];

    const validIds = workspaceIds.filter((id) => /^[0-9a-f]{24}$/.test(id));
    if (validIds.length === 0) return [];

    const byId = await this.workspaceStore.findByIds(validIds);

    const paths: string[] = [];
    for (const id of workspaceIds) {
      const entry = byId.get(id);
      if (entry) paths.push(`${entry.createdBy}/${entry.storagePrefix}`);
    }
    return paths;
  }

  /**
   * Resolve workspaceIds to a `{ workspaceId: storagePath }` map, where each
   * path is `{ownerUserId}/{storagePrefix}` (rooted under the workspace OWNER,
   * see getStoragePathsByIds). Unlike getStoragePathsByIds, this preserves the
   * id→path association so callers can attach a path to a specific workspace.
   * IDs that fail to resolve are omitted from the map.
   */
  async getStoragePathMapByIds(workspaceIds: string[]): Promise<Record<string, string>> {
    if (workspaceIds.length === 0) return {};

    const validIds = workspaceIds.filter((id) => /^[0-9a-f]{24}$/.test(id));
    if (validIds.length === 0) return {};

    const byId = await this.workspaceStore.findByIds(validIds);

    const pathById: Record<string, string> = {};
    for (const [id, doc] of byId) {
      pathById[id] = `${doc.createdBy}/${doc.storagePrefix}`;
    }
    return pathById;
  }

  async getRunCodeSourceMetadataByIds(
    workspaceIds: string[],
  ): Promise<Record<string, RunCodeWorkspaceMetadata>> {
    if (workspaceIds.length === 0) return {};
    const validIds = workspaceIds.filter((id) => /^[0-9a-f]{24}$/.test(id));
    if (validIds.length === 0) return {};
    const byId = await this.workspaceStore.findByIds(validIds);
    const metadata: Record<string, RunCodeWorkspaceMetadata> = {};
    for (const [workspaceId, doc] of byId) {
      metadata[workspaceId] = {
        workspaceId,
        name: doc.name,
        alias: doc.alias,
        cephPrefix: `${doc.createdBy}/${doc.storagePrefix}`,
      };
    }
    return metadata;
  }

  /**
   * Resolve a single workspaceId to its `{ownerUserId, storagePrefix}` pair.
   * Used by the upload services to build object keys rooted under the
   * workspace owner — collaborator uploads land under the owner's prefix so
   * a workspace's files stay grouped in Ceph regardless of uploader.
   */
  async getStorageContext(
    workspaceId: string,
  ): Promise<{ ownerUserId: string; storagePrefix: string }> {
    const doc = await this.workspaceStore.findById(workspaceId);
    if (!doc) {
      throw new NotFoundException(ErrorCode.WORKSPACE_NOT_FOUND, 'Workspace not found');
    }
    return {
      ownerUserId: doc.createdBy,
      storagePrefix: doc.storagePrefix,
    };
  }

  /**
   * Find an existing system workspace for a conversation.
   */
  async findSystemWorkspace(
    userId: string,
    conversationId: string,
  ): Promise<WorkspaceResponse | null> {
    const workspace = await this.workspaceStore.findSystemWorkspace(userId, conversationId);
    return workspace ? this.mapToResponse(workspace) : null;
  }

  /**
   * Delete a system workspace record without ownership check.
   * For internal cleanup use only (cascade delete, orphan cleanup).
   * Safety: only deletes workspaces with isSystem=true.
   */
  async deleteSystemWorkspace(workspaceId: string): Promise<void> {
    await this.workspaceStore.deleteSystemWorkspace(workspaceId);
  }

  /**
   * Get workspace record (internal use)
   */
  async getWorkspaceDocument(workspaceId: string): Promise<WorkspaceRecord> {
    const workspace = await this.workspaceStore.findById(workspaceId);

    if (!workspace) {
      throw new NotFoundException(ErrorCode.WORKSPACE_NOT_FOUND, 'Workspace not found');
    }

    return workspace;
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
