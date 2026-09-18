import { Inject, Injectable, forwardRef } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { isObjectId } from '@common/postgres/object-id';
import { withTransaction } from '@common/postgres/transaction';
import { USER_LOOKUP_PORT, type UserLookupPort, type UserSummary } from '@common/ports/user-lookup.port';
import { PROJECT_STORE, type ProjectRecord, type ProjectStore } from './persistence/project-store';
import {
  PROJECT_SHARE_STORE,
  type ProjectShareRecord,
  type ProjectShareStore,
} from './persistence/project-share-store';
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
import type { UserDocument } from '../user/schemas/user.schema';

type ShareEventType = 'project_shared' | 'project_share_revoked' | 'project_share_updated';

interface ShareIntent {
  user: UserSummary;
  permission: ProjectPermission;
  existingShareId?: string;
}

@Injectable()
export class ProjectShareService {
  constructor(
    @Inject(PROJECT_STORE)
    private readonly projectStore: ProjectStore,
    @Inject(PROJECT_SHARE_STORE)
    private readonly shareStore: ProjectShareStore,
    @Inject(CONVERSATION_STORE)
    private readonly conversationStore: ConversationStore,
    @Inject(USER_LOOKUP_PORT)
    private readonly userLookup: UserLookupPort,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
    private readonly userService: UserService,
    private readonly logger: LoggerService,
    // Opened here so share writes + the stored shareCount counter commit atomically.
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
  ) {
    this.logger.setContext('ProjectShareService');
  }

  /**
   * Whether the user can see the project at all: ownership, an active share,
   * or a public project. Mirrors WorkspaceShareService.hasAccess.
   */
  async hasAccess(userId: string, projectId: string): Promise<boolean> {
    if (!isObjectId(userId) || !isObjectId(projectId)) {
      return false;
    }
    const [owned, shared, isPublic] = await Promise.all([
      this.projectStore.existsOwnedBy(projectId, userId),
      this.shareStore.existsForUser(projectId, userId),
      this.projectStore.existsPublic(projectId),
    ]);
    return owned || shared || isPublic;
  }

  /**
   * Write access on a project = ownership or a `readwrite` share. Guards
   * collaborator actions that create/move conversations into the project.
   */
  async assertProjectWriteAccess(userId: string, projectId: string): Promise<void> {
    if (!isObjectId(projectId)) {
      throw new NotFoundException(ErrorCode.PROJECT_NOT_FOUND, 'Invalid project ID format');
    }
    const project = await this.projectStore.findById(projectId);
    if (!project) {
      throw new NotFoundException(ErrorCode.PROJECT_NOT_FOUND, 'Project not found');
    }
    if (project.createdBy === userId) return;

    if (project.isPublic) {
      throw new ForbiddenException(ErrorCode.PROJECT_SHARE_READ_ONLY, 'You have read-only access to this project');
    }

    const share = await this.shareStore.findOneByProjectAndUser(projectId, userId);
    if (!share) {
      throw new ForbiddenException(ErrorCode.PROJECT_FORBIDDEN, 'You do not have access to this project');
    }
    if (share.permission !== 'readwrite') {
      throw new ForbiddenException(ErrorCode.PROJECT_SHARE_READ_ONLY, 'You have read-only access to this project');
    }
  }

  /** Share a project with one or more users by email (owner-only, caller-checked). */
  async share(projectId: string, ownerId: string, data: ShareProjectDto): Promise<IShareProjectResult> {
    const project = await this.projectStore.findById(projectId);
    if (!project) {
      throw new NotFoundException(ErrorCode.PROJECT_NOT_FOUND, 'Project not found');
    }
    if (project.createdBy !== ownerId) {
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

    const notFound: string[] = [];
    const invalid: string[] = [];
    // Resolve users first (Mongo reads); the writes + counter commit together below.
    const intents: ShareIntent[] = [];

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
      const summary = toSummary(user._id.toString(), user.email, user.profile);
      const existingShare = await this.shareStore.findOneByProjectAndUser(projectId, summary.id);
      intents.push({ user: summary, permission: entry.permission, existingShareId: existingShare?.id });
    }

    const shared: Array<{ record: ProjectShareRecord; user: UserSummary }> = [];
    const createdEvents: Array<{ userId: string; shareId: string; permission: ProjectPermission }> = [];
    const updatedEvents: Array<{ userId: string; shareId: string; permission: ProjectPermission }> = [];

    if (intents.length > 0) {
      await withTransaction(this.db, async () => {
        for (const intent of intents) {
          if (intent.existingShareId) {
            const record = await this.shareStore.updatePermission(intent.existingShareId, intent.permission);
            if (!record) continue;
            shared.push({ record, user: intent.user });
            updatedEvents.push({ userId: intent.user.id, shareId: record.id, permission: intent.permission });
          } else {
            const record = await this.shareStore.create({
              projectId,
              ownerId: project.createdBy,
              sharedWithUserId: intent.user.id,
              permission: intent.permission,
              sharedBy: ownerId,
            });
            shared.push({ record, user: intent.user });
            createdEvents.push({ userId: intent.user.id, shareId: record.id, permission: intent.permission });
          }
        }
        if (createdEvents.length > 0) {
          await this.projectStore.incrementShareCount(projectId, createdEvents.length);
        }
      });
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

    return {
      shared: shared.map(({ record, user }) => this.mapToResponse(record, user)),
      notFound,
      invalid,
    };
  }

  /** List all shares for a project (owner view). */
  async findByProject(projectId: string, params: ShareQueryDto): Promise<IPaginatedProjectShares> {
    const { page = 1, limit = 20 } = params;

    const { rows, total } = await this.shareStore.findByProject(projectId, { limit, offset: (page - 1) * limit });

    const users = await this.userLookup.byIds(rows.map((share) => share.sharedWithUserId));

    return {
      shares: rows.map((share) => this.mapToResponse(share, users.get(share.sharedWithUserId))),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Update permission on an existing share. Caller has verified project ownership. */
  async updatePermission(
    projectId: string,
    shareId: string,
    permission: ProjectPermission,
  ): Promise<IProjectShareResponse> {
    const share = await this.shareStore.findById(shareId);
    if (!share || share.projectId !== projectId) {
      throw new NotFoundException(ErrorCode.PROJECT_SHARE_NOT_FOUND, 'Share not found');
    }

    const changed = share.permission !== permission;
    if (changed) {
      await this.shareStore.updatePermission(shareId, permission);
    }

    this.logger.log('Project share permission updated', { shareId, permission });

    if (changed) {
      try {
        const [project, owner] = await Promise.all([
          this.projectStore.findById(share.projectId),
          this.userService.findById(share.ownerId),
        ]);
        if (project && owner) {
          await this.pushShareNotification('project_share_updated', share.sharedWithUserId, project, owner, {
            shareId: share.id,
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

    return this.mapToResponse({ ...share, permission });
  }

  /** Revoke a share. Caller has verified project ownership. */
  async revoke(projectId: string, shareId: string): Promise<void> {
    const share = await this.shareStore.findById(shareId);
    if (!share || share.projectId !== projectId) {
      throw new NotFoundException(ErrorCode.PROJECT_SHARE_NOT_FOUND, 'Share not found');
    }

    const recipientId = share.sharedWithUserId;

    await withTransaction(this.db, async () => {
      await this.shareStore.deleteById(shareId);
      await this.projectStore.incrementShareCount(projectId, -1);
    });

    this.logger.log('Project share revoked', { shareId, projectId });

    try {
      const [project, owner] = await Promise.all([
        this.projectStore.findById(share.projectId),
        this.userService.findById(share.ownerId),
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

    const { rows, total } = await this.shareStore.findByUser(userId, { limit, offset: (page - 1) * limit });

    const projectMap = await this.projectStore.findByIds(rows.map((share) => share.projectId));
    const owners = await this.userLookup.byIds(rows.map((share) => share.sharedBy));

    const countMap = await this.conversationStore.countByProjects([...projectMap.keys()]);

    const projects: ISharedProjectResponse[] = [];
    for (const share of rows) {
      const project = projectMap.get(share.projectId);
      if (!project) continue;
      const owner = owners.get(share.sharedBy);
      projects.push({
        id: project.id,
        name: project.name,
        owner: {
          id: owner?.id ?? share.sharedBy,
          email: owner?.email ?? '',
          firstName: owner?.firstName || undefined,
          lastName: owner?.lastName || undefined,
        },
        permission: share.permission,
        shareId: share.id,
        conversationCount: countMap.get(project.id) ?? 0,
        sharedAt: share.createdAt.toISOString(),
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      });
    }

    return {
      projects,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Remove all shares for a project (cascade on project delete). */
  async removeAllByProject(projectId: string): Promise<void> {
    const deletedCount = await this.shareStore.deleteByProject(projectId);
    this.logger.log('All shares removed for project', {
      projectId,
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
    project: ProjectRecord,
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
          projectId: project.id,
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
        projectId: project.id,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  /** `user` is the resolved recipient (lookup join); empty names stay absent in JSON. */
  private mapToResponse(share: ProjectShareRecord, user?: UserSummary): IProjectShareResponse {
    return {
      id: share.id,
      projectId: share.projectId,
      user: {
        id: user?.id ?? share.sharedWithUserId,
        email: user?.email ?? '',
        firstName: user?.firstName || undefined,
        lastName: user?.lastName || undefined,
      },
      permission: share.permission,
      sharedBy: share.sharedBy,
      createdAt: share.createdAt.toISOString(),
      updatedAt: share.updatedAt.toISOString(),
    };
  }
}

function toSummary(id: string, email: string, profile?: { firstName?: string; lastName?: string }): UserSummary {
  return { id, email, firstName: profile?.firstName ?? '', lastName: profile?.lastName ?? '' };
}
