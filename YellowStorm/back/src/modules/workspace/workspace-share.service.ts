import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Workspace, WorkspaceDocument } from './schemas/workspace.schema';
import { WorkspaceShare, WorkspaceShareDocument } from './schemas/workspace-share.schema';
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
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { UserDocument } from '../user/schemas/user.schema';

type ShareEventType = 'workspace_shared' | 'workspace_share_revoked' | 'workspace_share_updated';

@Injectable()
export class WorkspaceShareService {
  constructor(
    @InjectModel(Workspace.name)
    private readonly workspaceModel: Model<WorkspaceDocument>,
    @InjectModel(WorkspaceShare.name)
    private readonly shareModel: Model<WorkspaceShareDocument>,
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

    const objectIds = workspaceIds.map((id) => new Types.ObjectId(id));
    const userObjectId = new Types.ObjectId(userId);

    const [owned, shared, publicWs] = await Promise.all([
      this.workspaceModel
        .find({ _id: { $in: objectIds }, createdBy: userObjectId })
        .select('_id')
        .lean()
        .exec(),
      this.shareModel
        .find({ workspaceId: { $in: objectIds }, sharedWithUserId: userObjectId })
        .select('workspaceId')
        .lean()
        .exec(),
      this.workspaceModel
        .find({ _id: { $in: objectIds }, isPublic: true })
        .select('_id')
        .lean()
        .exec(),
    ]);

    const accessibleIds = new Set<string>([
      ...owned.map((w) => w._id.toString()),
      ...shared.map((s) => s.workspaceId.toString()),
      ...publicWs.map((w) => w._id.toString()),
    ]);

    const missing = workspaceIds.filter((id) => !accessibleIds.has(id));
    if (missing.length > 0) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_FORBIDDEN,
        `You do not have access to workspace(s): ${missing.join(', ')}`,
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

    const workspaceObjectId = new Types.ObjectId(workspaceId);
    const userObjectId = new Types.ObjectId(userId);

    const [owned, shared, isPublic] = await Promise.all([
      this.workspaceModel
        .exists({ _id: workspaceObjectId, createdBy: userObjectId })
        .exec(),
      this.shareModel
        .exists({ workspaceId: workspaceObjectId, sharedWithUserId: userObjectId })
        .exec(),
      this.workspaceModel
        .exists({ _id: workspaceObjectId, isPublic: true })
        .exec(),
    ]);

    return Boolean(owned || shared || isPublic);
  }

  /**
   * Share workspace with one or more users by email
   */
  async share(
    workspaceId: string,
    ownerId: string,
    data: ShareWorkspaceDto,
  ): Promise<ShareWorkspaceResult> {
    const workspace = await this.workspaceModel.findById(workspaceId).exec();
    if (!workspace) {
      throw new NotFoundException(ErrorCode.WORKSPACE_NOT_FOUND, 'Workspace not found');
    }

    if (workspace.createdBy.toString() !== ownerId) {
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

      const existingShare = await this.shareModel
        .findOne({
          workspaceId: new Types.ObjectId(workspaceId),
          sharedWithUserId: user._id,
        })
        .exec();

      if (existingShare) {
        const permissionChanged = existingShare.permission !== entry.permission;
        if (permissionChanged) {
          await this.shareModel
            .updateOne({ _id: existingShare._id }, { $set: { permission: entry.permission } })
            .exec();
          existingShare.permission = entry.permission;
          updatedEvents.push({
            userId: user._id.toString(),
            shareId: existingShare._id.toString(),
            permission: entry.permission,
          });
        }
        shared.push(this.mapToResponse(existingShare, user));
        continue;
      }

      const share = await this.shareModel.create({
        workspaceId: new Types.ObjectId(workspaceId),
        ownerId: workspace.createdBy,
        sharedWithUserId: user._id,
        permission: entry.permission,
        sharedBy: new Types.ObjectId(ownerId),
      });

      shared.push(this.mapToResponse(share, user));
      createdEvents.push({
        userId: user._id.toString(),
        shareId: share._id.toString(),
        permission: entry.permission,
      });
    }

    if (createdEvents.length > 0) {
      await this.workspaceModel.updateOne(
        { _id: workspaceId },
        { $inc: { shareCount: createdEvents.length } },
      );
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

    const [shares, total] = await Promise.all([
      this.shareModel
        .find({ workspaceId: new Types.ObjectId(workspaceId) })
        .populate('sharedWithUserId', 'email profile.firstName profile.lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.shareModel.countDocuments({
        workspaceId: new Types.ObjectId(workspaceId),
      }),
    ]);

    return {
      shares: shares.map((share) => this.mapToResponse(share)),
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
    const share = await this.shareModel.findById(shareId).exec();

    if (!share || share.workspaceId.toString() !== workspaceId) {
      throw new NotFoundException(ErrorCode.WORKSPACE_SHARE_NOT_FOUND, 'Share not found');
    }

    const changed = share.permission !== permission;
    if (changed) {
      await this.shareModel
        .updateOne({ _id: shareId }, { $set: { permission } })
        .exec();
      share.permission = permission;
    }

    this.logger.log('Share permission updated', { shareId, permission });

    if (changed) {
      try {
        const [workspace, owner] = await Promise.all([
          this.workspaceModel.findById(share.workspaceId).exec(),
          this.userService.findById(share.ownerId.toString()),
        ]);
        if (workspace && owner) {
          await this.pushShareNotification(
            'workspace_share_updated',
            share.sharedWithUserId.toString(),
            workspace,
            owner,
            { shareId: share._id.toString(), permission },
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
    const share = await this.shareModel.findById(shareId).exec();

    if (!share || share.workspaceId.toString() !== workspaceId) {
      throw new NotFoundException(ErrorCode.WORKSPACE_SHARE_NOT_FOUND, 'Share not found');
    }

    const recipientId = share.sharedWithUserId.toString();

    await this.shareModel.deleteOne({ _id: shareId });
    await this.workspaceModel.updateOne({ _id: workspaceId }, { $inc: { shareCount: -1 } });

    this.logger.log('Share revoked', { shareId, workspaceId });

    try {
      const [workspace, owner] = await Promise.all([
        this.workspaceModel.findById(share.workspaceId).exec(),
        this.userService.findById(share.ownerId.toString()),
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

    const query = { sharedWithUserId: new Types.ObjectId(userId) };

    const [shares, total] = await Promise.all([
      this.shareModel
        .find(query)
        .populate([
          {
            path: 'workspaceId',
            select:
              'name alias storagePrefix description documentCount usedStorage allocatedStorage createdAt updatedAt',
          },
          {
            path: 'sharedBy',
            select: 'email profile.firstName profile.lastName',
          },
        ])
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.shareModel.countDocuments(query),
    ]);

    const workspaces: SharedWorkspaceResponse[] = shares.map((share) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws = (share as any).workspaceId;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const owner = (share as any).sharedBy;

      return {
        id: ws._id.toString(),
        name: ws.name,
        alias: ws.alias,
        storagePrefix: ws.storagePrefix,
        description: ws.description,
        owner: {
          id: owner._id.toString(),
          email: owner.email,
          firstName: owner.profile?.firstName,
          lastName: owner.profile?.lastName,
        },
        permission: share.permission,
        shareId: share._id.toString(),
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
    const result = await this.shareModel
      .deleteMany({ workspaceId: new Types.ObjectId(workspaceId) })
      .exec();

    this.logger.log('All shares removed for workspace', {
      workspaceId,
      deletedCount: result.deletedCount,
    });
  }

  /**
   * Send an SSE share notification to a user. Failures are logged but swallowed —
   * a stale notification should never block the share operation itself.
   */
  private async pushShareNotification(
    eventType: ShareEventType,
    recipientId: string,
    workspace: WorkspaceDocument,
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
          workspaceId: workspace._id.toString(),
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
        workspaceId: workspace._id.toString(),
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  /**
   * Map share document to response. When `sharedWithUserId` is populated it's a user
   * document; otherwise it's an ObjectId. Callers that just created/updated a share
   * (no populate) can pass `userOverride` so the response still carries email/name.
   */
  private mapToResponse(
    share: WorkspaceShareDocument,
    userOverride?: UserDocument,
  ): WorkspaceShareResponse {
    const ref = share.sharedWithUserId as unknown;
    const populated =
      typeof ref === 'object' && ref !== null && 'email' in (ref as Record<string, unknown>)
        ? (ref as {
            _id: Types.ObjectId;
            email: string;
            profile?: { firstName?: string; lastName?: string };
          })
        : null;

    const userInfo = userOverride
      ? {
          id: userOverride._id.toString(),
          email: userOverride.email,
          firstName: userOverride.profile?.firstName,
          lastName: userOverride.profile?.lastName,
        }
      : {
          id: populated ? populated._id.toString() : share.sharedWithUserId.toString(),
          email: populated?.email ?? '',
          firstName: populated?.profile?.firstName,
          lastName: populated?.profile?.lastName,
        };

    return {
      id: share._id.toString(),
      workspaceId: share.workspaceId.toString(),
      user: userInfo,
      permission: share.permission,
      sharedBy: share.sharedBy.toString(),
      createdAt: share.createdAt.toISOString(),
      updatedAt: share.updatedAt.toISOString(),
    };
  }
}
