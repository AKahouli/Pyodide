import { Inject, Injectable, forwardRef } from '@nestjs/common';
import type { UserSummary } from '@common/ports/user-lookup.port';
import { Types } from 'mongoose';
import {
  WorkspaceShareResponse,
  ShareWorkspaceResult,
  PaginatedShares,
  SharedWorkspaceResponse,
  PaginatedSharedWorkspaces,
  WorkspacePermission,
} from './interfaces/workspace-share.interface';
import { ShareWorkspaceDto } from './dto/share-workspace.dto';
import { ShareQueryDto } from './dto/share-query.dto';
import { WorkspaceQueryDto } from './dto/workspace-query.dto';
import { LoggerService } from '../logger';
import { ForbiddenException, NotFoundException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { UserService } from '../user';
import { USER_LOOKUP_PORT, type UserLookupPort } from '@common/ports/user-lookup.port';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { UserDocument } from '../user/schemas/user.schema';
import type { WorkspaceRecord, WorkspaceShareRecord } from './ports/workspace-records';
import { WORKSPACE_STORE, type WorkspaceStore } from './stores/workspace-store';
import { SHARE_STORE, type ShareStore } from './stores/share-store';

type ShareEventType = 'workspace_shared' | 'workspace_share_revoked' | 'workspace_share_updated';

@Injectable()
export class WorkspaceShareService {
  constructor(
    @Inject(WORKSPACE_STORE) private readonly workspaceStore: WorkspaceStore,
    @Inject(SHARE_STORE) private readonly shareStore: ShareStore,
    @Inject(USER_LOOKUP_PORT) private readonly userLookup: UserLookupPort,
    private readonly logger: LoggerService,
    private readonly userService: UserService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
  ) {
    this.logger.setContext('WorkspaceShareService');
  }

  /**
   * Throw if the user lacks access to any of the provided workspaceIds.
   * Access = ownership OR an active share OR a public workspace. Used by callers
   * that accept a list of workspaceIds from the client (e.g. v2 session creation)
   * and need to guard against IDs the user doesn't actually have access to.
   */
  async assertUserHasAccess(userId: string, workspaceIds: string[]): Promise<void> {
    if (workspaceIds.length === 0) return;

    const invalid = workspaceIds.filter((id) => !Types.ObjectId.isValid(id));
    if (invalid.length > 0) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_NOT_FOUND,
        `Invalid workspace ID format: ${invalid.join(', ')}`,
      );
    }

    const [owned, shared, publicWs] = await Promise.all([
      this.workspaceStore.filterOwned(workspaceIds, userId),
      this.shareStore.filterSharedWithUser(userId, workspaceIds),
      this.workspaceStore.filterPublic(workspaceIds),
    ]);

    const accessibleIds = new Set<string>([...owned, ...shared, ...publicWs]);

    const missing = workspaceIds.filter((id) => !accessibleIds.has(id));
    if (missing.length > 0) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_FORBIDDEN,
        `You do not have access to workspace(s): ${missing.join(', ')}`,
      );
    }
  }

  async assertUserHasWriteAccess(userId: string, workspaceId: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(workspaceId)) {
      throw new NotFoundException(
        ErrorCode.WORKSPACE_NOT_FOUND,
        'Invalid workspace or user ID format',
      );
    }

    const workspace = await this.workspaceStore.findById(workspaceId);
    if (!workspace) {
      throw new NotFoundException(ErrorCode.WORKSPACE_NOT_FOUND, 'Workspace not found');
    }

    if (workspace.createdBy === userId) return;

    if (workspace.isPublic) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_READ_ONLY,
        'You have read-only access to this workspace',
      );
    }

    const share = await this.shareStore.findOneByWorkspaceAndUser(workspaceId, userId);

    if (!share) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_FORBIDDEN,
        'You do not have access to this workspace',
      );
    }

    if (share.permission !== 'readwrite') {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_READ_ONLY,
        'You have read-only access to this workspace',
      );
    }
  }

  /**
   * Return whether a user has any kind of access (owner OR active share,
   * read or readwrite, OR the workspace is public) to a single workspace.
   * Used by external services (indexing) that need a simple yes/no access
   * check. Returns false for malformed ids rather than throwing.
   */
  async hasAccess(userId: string, workspaceId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(workspaceId)) {
      return false;
    }

    const workspace = await this.workspaceStore.findById(workspaceId);
    const owned = Boolean(workspace && workspace.createdBy === userId);
    const shared = workspace ? Boolean(await this.shareStore.findOneByWorkspaceAndUser(workspaceId, userId)) : false;

    return Boolean(owned || shared || workspace?.isPublic);
  }

  /**
   * Share workspace with one or more users by email
   */
  async share(
    workspaceId: string,
    ownerId: string,
    data: ShareWorkspaceDto,
  ): Promise<ShareWorkspaceResult> {
    const workspace = await this.workspaceStore.findById(workspaceId);
    if (!workspace) {
      throw new NotFoundException(ErrorCode.WORKSPACE_NOT_FOUND, 'Workspace not found');
    }

    if (workspace.createdBy !== ownerId) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_FORBIDDEN,
        'You do not have access to this workspace',
      );
    }

    if (workspace.isSystem) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_SHARE_SYSTEM,
        'System workspaces cannot be shared',
      );
    }

    if (workspace.isPublic) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_PUBLIC_NO_SHARE,
        'This workspace is public and cannot be shared',
      );
    }

    const owner = await this.userService.findById(ownerId);
    if (!owner) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND, 'Workspace owner not found');
    }
    const ownerEmail = owner.email.toLowerCase();

    const shared: WorkspaceShareResponse[] = [];
    const notFound: string[] = [];
    const invalid: string[] = [];
    const createdEvents: Array<{ userId: string; shareId: string; permission: WorkspacePermission }> = [];
    const updatedEvents: Array<{ userId: string; shareId: string; permission: WorkspacePermission }> = [];

    for (const entry of data.shares) {
      const email = entry.email.toLowerCase().trim();

      if (email === ownerEmail) {
        invalid.push(email);
        continue;
      }

      const user = await this.userService.findByEmail(email);
      if (!user) {
        notFound.push(email);
        continue;
      }

      const existingShare = await this.shareStore.findOneByWorkspaceAndUser(workspaceId, user._id.toString());

      if (existingShare) {
        const permissionChanged = existingShare.permission !== entry.permission;
        if (permissionChanged) {
          await this.shareStore.updatePermission(existingShare.id, entry.permission);
          existingShare.permission = entry.permission;
          updatedEvents.push({
            userId: user._id.toString(),
            shareId: existingShare.id,
            permission: entry.permission,
          });
        }
        shared.push(this.mapToResponse(existingShare, user));
        continue;
      }

      const share = await this.shareStore.create({
        workspaceId,
        ownerId: workspace.createdBy,
        sharedWithUserId: user._id.toString(),
        permission: entry.permission,
        sharedBy: ownerId,
      });

      shared.push(this.mapToResponse(share, user));
      createdEvents.push({
        userId: user._id.toString(),
        shareId: share.id,
        permission: entry.permission,
      });
    }

    if (createdEvents.length > 0) {
      await this.workspaceStore.incrementCounters(workspaceId, { shareCount: createdEvents.length });
    }

    for (const event of createdEvents) {
      await this.pushShareNotification('workspace_shared', event.userId, workspace, owner, {
        shareId: event.shareId,
        permission: event.permission,
      });
    }
    for (const event of updatedEvents) {
      await this.pushShareNotification(
        'workspace_share_updated',
        event.userId,
        workspace,
        owner,
        { shareId: event.shareId, permission: event.permission },
      );
    }

    this.logger.log('Workspace shared', {
      workspaceId,
      ownerId,
      sharedCount: shared.length,
      notFoundCount: notFound.length,
      invalidCount: invalid.length,
    });

    return { shared, notFound, invalid };
  }

  /**
   * List all shares for a workspace (owner view)
   */
  async findByWorkspace(workspaceId: string, params: ShareQueryDto): Promise<PaginatedShares> {
    const { page = 1, limit = 20 } = params;
    const skip = (page - 1) * limit;

    const { items: shares, total } = await this.shareStore.findForWorkspace(workspaceId, skip, limit);

    const users = await this.userLookup.byIds(shares.map((share) => share.sharedWithUserId));

    return {
      shares: shares.map((share) => this.mapToResponse(share, undefined, users.get(share.sharedWithUserId))),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Update permission on an existing share
   * Caller (controller) is guarded by WorkspaceOwnerGuard, so the workspace ID in URL
   * has already been verified. We additionally check share.workspaceId matches.
   */
  async updatePermission(
    workspaceId: string,
    shareId: string,
    permission: WorkspacePermission,
  ): Promise<WorkspaceShareResponse> {
    const share = await this.shareStore.findById(shareId);

    if (!share || share.workspaceId !== workspaceId) {
      throw new NotFoundException(ErrorCode.WORKSPACE_SHARE_NOT_FOUND, 'Share not found');
    }

    const changed = share.permission !== permission;
    if (changed) {
      await this.shareStore.updatePermission(shareId, permission);
      share.permission = permission;
    }

    this.logger.log('Share permission updated', { shareId, permission });

    if (changed) {
      try {
        const [workspace, owner] = await Promise.all([
          this.workspaceStore.findById(share.workspaceId),
          this.userService.findById(share.ownerId),
        ]);
        if (workspace && owner) {
          await this.pushShareNotification(
            'workspace_share_updated',
            share.sharedWithUserId,
            workspace,
            owner,
            { shareId: share.id, permission },
          );
        }
      } catch (err) {
        this.logger.warn('Failed to push permission-update notification', {
          shareId,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return this.mapToResponse(share);
  }

  /**
   * Revoke a share. Same workspaceId mismatch guard as updatePermission.
   */
  async revoke(workspaceId: string, shareId: string): Promise<void> {
    const share = await this.shareStore.findById(shareId);

    if (!share || share.workspaceId !== workspaceId) {
      throw new NotFoundException(ErrorCode.WORKSPACE_SHARE_NOT_FOUND, 'Share not found');
    }

    const recipientId = share.sharedWithUserId;

    await this.shareStore.deleteById(shareId);
    await this.workspaceStore.incrementCounters(workspaceId, { shareCount: -1 });

    this.logger.log('Share revoked', { shareId, workspaceId });

    try {
      const [workspace, owner] = await Promise.all([
        this.workspaceStore.findById(share.workspaceId),
        this.userService.findById(share.ownerId),
      ]);
      if (workspace && owner) {
        await this.pushShareNotification(
          'workspace_share_revoked',
          recipientId,
          workspace,
          owner,
          { shareId },
        );
      }
    } catch (err) {
      this.logger.warn('Failed to push revoke notification', {
        shareId,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  /**
   * List workspaces shared with a user
   */
  async findSharedWithUser(
    userId: string,
    params: WorkspaceQueryDto,
  ): Promise<PaginatedSharedWorkspaces> {
    const { page = 1, limit = 20 } = params;
    const skip = (page - 1) * limit;

    const { items: shares, total } = await this.shareStore.findSharedWithUser(userId, skip, limit);

    // Join the shared workspaces through the store (replaces the Mongo
    // `populate('workspaceId')` — plan D.6) and resolve share owners.
    const workspacesById = await this.workspaceStore.findByIds(shares.map((share) => share.workspaceId));
    const owners = await this.userLookup.byIds(shares.map((share) => share.sharedBy));

    const workspaces: SharedWorkspaceResponse[] = shares.map((share) => {
      const ws = workspacesById.get(share.workspaceId)!;
      const ownerUser = owners.get(share.sharedBy);

      return {
        id: ws.id,
        name: ws.name,
        alias: ws.alias,
        storagePrefix: ws.storagePrefix,
        description: ws.description,
        owner: {
          id: ownerUser?.id ?? share.sharedBy,
          email: ownerUser?.email ?? '',
          firstName: ownerUser?.firstName || undefined,
          lastName: ownerUser?.lastName || undefined,
        },
        permission: share.permission,
        shareId: share.id,
        documentCount: ws.documentCount,
        usedStorage: ws.usedStorage,
        allocatedStorage: ws.allocatedStorage,
        sharedAt: share.createdAt.toISOString(),
        createdAt: ws.createdAt.toISOString(),
        updatedAt: ws.updatedAt.toISOString(),
      };
    });

    return {
      workspaces,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Remove all shares for a workspace (cascade on workspace delete)
   */
  async removeAllByWorkspace(workspaceId: string): Promise<void> {
    const deletedCount = await this.shareStore.deleteManyByWorkspace(workspaceId);

    this.logger.log('All shares removed for workspace', {
      workspaceId,
      deletedCount,
    });
  }

  /**
   * Send an SSE share notification to a user. Failures are logged but swallowed —
   * a stale notification should never block the share operation itself.
   */
  private async pushShareNotification(
    eventType: ShareEventType,
    recipientId: string,
    workspace: WorkspaceRecord,
    owner: UserDocument,
    extra: { shareId: string; permission?: WorkspacePermission },
  ): Promise<void> {
    try {
      const ownerName =
        owner.profile?.firstName && owner.profile?.lastName
          ? `${owner.profile.firstName} ${owner.profile.lastName}`
          : owner.email;

      let title: string;
      let message: string;
      if (eventType === 'workspace_shared') {
        title = 'Workspace shared';
        message = `${ownerName} shared "${workspace.name}" with you.`;
      } else if (eventType === 'workspace_share_revoked') {
        title = 'Access revoked';
        message = `Your access to "${workspace.name}" was revoked.`;
      } else {
        title = 'Access updated';
        const permLabel = extra.permission === 'read' ? 'read-only' : 'read & write';
        message = `Your access to "${workspace.name}" changed to ${permLabel}.`;
      }

      await this.notificationsService.sendToUser(recipientId, {
        type: NotificationType.INFO,
        title,
        message,
        data: {
          eventType,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          shareId: extra.shareId,
          permission: extra.permission,
          owner: {
            id: owner._id.toString(),
            email: owner.email,
            firstName: owner.profile?.firstName,
            lastName: owner.profile?.lastName,
          },
        },
        metadata: { sourceModule: 'workspace-share' },
      });
    } catch (err) {
      this.logger.warn('Failed to send share notification', {
        eventType,
        recipientId,
        workspaceId: workspace.id,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  /**
   * Map share record to response. Callers that just created/updated a share
   * (no user lookup) can pass `userOverride` so the response still carries
   * email/name.
   */
  private mapToResponse(
    share: WorkspaceShareRecord,
    userOverride?: UserDocument,
    resolvedUser?: UserSummary,
  ): WorkspaceShareResponse {
    const userInfo = userOverride
      ? {
          id: userOverride._id.toString(),
          email: userOverride.email,
          firstName: userOverride.profile?.firstName,
          lastName: userOverride.profile?.lastName,
        }
      : {
          id: resolvedUser?.id ?? share.sharedWithUserId,
          email: resolvedUser?.email ?? '',
          firstName: resolvedUser?.firstName || undefined,
          lastName: resolvedUser?.lastName || undefined,
        };

    return {
      id: share.id,
      workspaceId: share.workspaceId,
      user: userInfo,
      permission: share.permission,
      sharedBy: share.sharedBy,
      createdAt: share.createdAt.toISOString(),
      updatedAt: share.updatedAt.toISOString(),
    };
  }
}
