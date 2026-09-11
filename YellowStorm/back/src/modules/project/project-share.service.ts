import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Project, ProjectDocument } from './schemas/project.schema';
import { ProjectShare, ProjectShareDocument } from './schemas/project-share.schema';
import {
  IPaginatedProjectShares,
  IPaginatedSharedProjects,
  IProjectShareResponse,
  IShareProjectResult,
  ProjectPermission,
  ISharedProjectResponse,
} from './interfaces/project.interface';
import { ShareProjectDto } from './dto/share-project.dto';
import { ShareQueryDto } from './dto/share-query.dto';
import { LoggerService } from '../logger';
import { ForbiddenException, NotFoundException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import {
  CONVERSATION_STORE,
  type ConversationStore,
} from '../conversation/persistence/conversation-store';
import { UserService } from '../user/user.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { UserDocument } from '../user/schemas/user.schema';

type ShareEventType = 'project_shared' | 'project_share_revoked' | 'project_share_updated';

@Injectable()
export class ProjectShareService {
  constructor(
    @InjectModel(Project.name)
    private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(ProjectShare.name)
    private readonly shareModel: Model<ProjectShareDocument>,
    @Inject(CONVERSATION_STORE)
    private readonly conversationStore: ConversationStore,
    private readonly logger: LoggerService,
    private readonly userService: UserService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
  ) {
    this.logger.setContext('ProjectShareService');
  }

  /**
   * Whether the user can see the project at all: ownership, an active share,
   * or a public project. Mirrors WorkspaceShareService.hasAccess.
   */
  async hasAccess(userId: string, projectId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(projectId)) {
      return false;
    }
    const projectObjectId = new Types.ObjectId(projectId);
    const userObjectId = new Types.ObjectId(userId);
    const [owned, shared, isPublic] = await Promise.all([
      this.projectModel.exists({ _id: projectObjectId, createdBy: userObjectId }).exec(),
      this.shareModel
        .exists({ projectId: projectObjectId, sharedWithUserId: userObjectId })
        .exec(),
      this.projectModel.exists({ _id: projectObjectId, isPublic: true }).exec(),
    ]);
    return Boolean(owned || shared || isPublic);
  }

  /**
   * Write access on a project = ownership or a `readwrite` share. Guards
   * collaborator actions that create/move conversations into the project.
   */
  async assertProjectWriteAccess(userId: string, projectId: string): Promise<void> {
    if (!Types.ObjectId.isValid(projectId)) {
      throw new NotFoundException(ErrorCode.PROJECT_NOT_FOUND, 'Invalid project ID format');
    }
    const project = await this.projectModel.findById(projectId).lean().exec();
    if (!project) {
      throw new NotFoundException(ErrorCode.PROJECT_NOT_FOUND, 'Project not found');
    }
    if (project.createdBy.toString() === userId) return;

    if (project.isPublic) {
      throw new ForbiddenException(ErrorCode.PROJECT_SHARE_READ_ONLY, 'You have read-only access to this project');
    }

    const share = await this.shareModel
      .findOne({
        projectId: new Types.ObjectId(projectId),
        sharedWithUserId: new Types.ObjectId(userId),
      })
      .lean()
      .exec();
    if (!share) {
      throw new ForbiddenException(ErrorCode.PROJECT_FORBIDDEN, 'You do not have access to this project');
    }
    if (share.permission !== 'readwrite') {
      throw new ForbiddenException(ErrorCode.PROJECT_SHARE_READ_ONLY, 'You have read-only access to this project');
    }
  }

  /** Share a project with one or more users by email (owner-only, caller-checked). */
  async share(projectId: string, ownerId: string, data: ShareProjectDto): Promise<IShareProjectResult> {
    const project = await this.projectModel.findById(projectId).exec();
    if (!project) {
      throw new NotFoundException(ErrorCode.PROJECT_NOT_FOUND, 'Project not found');
    }
    if (project.createdBy.toString() !== ownerId) {
      throw new ForbiddenException(ErrorCode.PROJECT_FORBIDDEN, 'You do not have access to this project');
    }
    if (project.isPublic) {
      throw new ForbiddenException(ErrorCode.PROJECT_SHARE_PUBLIC, 'This project is public and cannot be shared');
    }

    const owner = await this.userService.findById(ownerId);
    if (!owner) {
      throw new NotFoundException(ErrorCode.PROJECT_NOT_FOUND, 'Project owner not found');
    }
    const ownerEmail = owner.email.toLowerCase();

    const shared: IProjectShareResponse[] = [];
    const notFound: string[] = [];
    const invalid: string[] = [];
    const createdEvents: Array<{ userId: string; shareId: string; permission: ProjectPermission }> = [];
    const updatedEvents: Array<{ userId: string; shareId: string; permission: ProjectPermission }> = [];

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
          projectId: new Types.ObjectId(projectId),
          sharedWithUserId: user._id,
        })
        .exec();

      if (existingShare) {
        if (existingShare.permission !== entry.permission) {
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
        projectId: new Types.ObjectId(projectId),
        ownerId: project.createdBy,
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
      await this.projectModel.updateOne({ _id: projectId }, { $inc: { shareCount: createdEvents.length } });
    }

    for (const event of createdEvents) {
      await this.pushShareNotification('project_shared', event.userId, project, owner, {
        shareId: event.shareId,
        permission: event.permission,
      });
    }
    for (const event of updatedEvents) {
      await this.pushShareNotification('project_share_updated', event.userId, project, owner, {
        shareId: event.shareId,
        permission: event.permission,
      });
    }

    this.logger.log('Project shared', {
      projectId,
      ownerId,
      sharedCount: shared.length,
      notFoundCount: notFound.length,
      invalidCount: invalid.length,
    });

    return { shared, notFound, invalid };
  }

  /** List all shares for a project (owner view). */
  async findByProject(projectId: string, params: ShareQueryDto): Promise<IPaginatedProjectShares> {
    const { page = 1, limit = 20 } = params;
    const skip = (page - 1) * limit;

    const [shares, total] = await Promise.all([
      this.shareModel
        .find({ projectId: new Types.ObjectId(projectId) })
        .populate('sharedWithUserId', 'email profile.firstName profile.lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.shareModel.countDocuments({ projectId: new Types.ObjectId(projectId) }),
    ]);

    return {
      shares: shares.map((share) => this.mapToResponse(share)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Update permission on an existing share. Caller has verified project ownership. */
  async updatePermission(
    projectId: string,
    shareId: string,
    permission: ProjectPermission,
  ): Promise<IProjectShareResponse> {
    const share = await this.shareModel.findById(shareId).exec();
    if (!share || share.projectId.toString() !== projectId) {
      throw new NotFoundException(ErrorCode.PROJECT_SHARE_NOT_FOUND, 'Share not found');
    }

    const changed = share.permission !== permission;
    if (changed) {
      await this.shareModel.updateOne({ _id: shareId }, { $set: { permission } }).exec();
      share.permission = permission;
    }

    this.logger.log('Project share permission updated', { shareId, permission });

    if (changed) {
      try {
        const [project, owner] = await Promise.all([
          this.projectModel.findById(share.projectId).exec(),
          this.userService.findById(share.ownerId.toString()),
        ]);
        if (project && owner) {
          await this.pushShareNotification('project_share_updated', share.sharedWithUserId.toString(), project, owner, {
            shareId: share._id.toString(),
            permission,
          });
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

  /** Revoke a share. Caller has verified project ownership. */
  async revoke(projectId: string, shareId: string): Promise<void> {
    const share = await this.shareModel.findById(shareId).exec();
    if (!share || share.projectId.toString() !== projectId) {
      throw new NotFoundException(ErrorCode.PROJECT_SHARE_NOT_FOUND, 'Share not found');
    }

    const recipientId = share.sharedWithUserId.toString();

    await this.shareModel.deleteOne({ _id: shareId });
    await this.projectModel.updateOne({ _id: projectId }, { $inc: { shareCount: -1 } });

    this.logger.log('Project share revoked', { shareId, projectId });

    try {
      const [project, owner] = await Promise.all([
        this.projectModel.findById(share.projectId).exec(),
        this.userService.findById(share.ownerId.toString()),
      ]);
      if (project && owner) {
        await this.pushShareNotification('project_share_revoked', recipientId, project, owner, {
          shareId,
        });
      }
    } catch (err) {
      this.logger.warn('Failed to push revoke notification', {
        shareId,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  /** List projects shared with a user (their own projects excluded). */
  async findSharedWithUser(userId: string, params: ShareQueryDto): Promise<IPaginatedSharedProjects> {
    const { page = 1, limit = 20 } = params;
    const skip = (page - 1) * limit;

    const query = { sharedWithUserId: new Types.ObjectId(userId) };

    const [shares, total] = await Promise.all([
      this.shareModel
        .find(query)
        .populate([
          { path: 'projectId', select: 'name createdAt updatedAt' },
          { path: 'sharedBy', select: 'email profile.firstName profile.lastName' },
        ])
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.shareModel.countDocuments(query),
    ]);

    const countMap = await this.conversationStore.countByProjects(
      shares
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((share) => (share as any).projectId?._id?.toString())
        .filter((id): id is string => Boolean(id)),
    );

    const projects: ISharedProjectResponse[] = shares.map((share) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const project = (share as any).projectId;
      const owner = (share as any).sharedBy;
      /* eslint-enable @typescript-eslint/no-explicit-any */

      return {
        id: project._id.toString(),
        name: project.name,
        owner: {
          id: owner._id.toString(),
          email: owner.email,
          firstName: owner.profile?.firstName,
          lastName: owner.profile?.lastName,
        },
        permission: share.permission,
        shareId: share._id.toString(),
        conversationCount: countMap.get(project._id.toString()) ?? 0,
        sharedAt: share.createdAt.toISOString(),
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      };
    });

    return {
      projects,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Remove all shares for a project (cascade on project delete). */
  async removeAllByProject(projectId: string): Promise<void> {
    const result = await this.shareModel.deleteMany({ projectId: new Types.ObjectId(projectId) }).exec();
    this.logger.log('All shares removed for project', {
      projectId,
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
    project: ProjectDocument,
    owner: UserDocument,
    extra: { shareId: string; permission?: ProjectPermission },
  ): Promise<void> {
    try {
      const ownerName =
        owner.profile?.firstName && owner.profile?.lastName
          ? `${owner.profile.firstName} ${owner.profile.lastName}`
          : owner.email;

      let title: string;
      let message: string;
      if (eventType === 'project_shared') {
        title = 'Project shared';
        message = `${ownerName} shared "${project.name}" with you.`;
      } else if (eventType === 'project_share_revoked') {
        title = 'Access revoked';
        message = `Your access to "${project.name}" was revoked.`;
      } else {
        title = 'Access updated';
        const permLabel = extra.permission === 'read' ? 'read-only' : 'read & write';
        message = `Your access to "${project.name}" changed to ${permLabel}.`;
      }

      await this.notificationsService.sendToUser(recipientId, {
        type: NotificationType.INFO,
        title,
        message,
        data: {
          eventType,
          projectId: project._id.toString(),
          projectName: project.name,
          shareId: extra.shareId,
          permission: extra.permission,
          owner: {
            id: owner._id.toString(),
            email: owner.email,
            firstName: owner.profile?.firstName,
            lastName: owner.profile?.lastName,
          },
        },
        metadata: { sourceModule: 'project-share' },
      });
    } catch (err) {
      this.logger.warn('Failed to send share notification', {
        eventType,
        recipientId,
        projectId: project._id.toString(),
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  /**
   * Map share document to response. When `sharedWithUserId` is populated it's a user
   * document; otherwise it's an ObjectId. Callers that just created/updated a share
   * (no populate) can pass `userOverride` so the response still carries email/name.
   */
  private mapToResponse(share: ProjectShareDocument, userOverride?: UserDocument): IProjectShareResponse {
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
      projectId: share.projectId.toString(),
      user: userInfo,
      permission: share.permission,
      sharedBy: share.sharedBy.toString(),
      createdAt: share.createdAt.toISOString(),
      updatedAt: share.updatedAt.toISOString(),
    };
  }
}
