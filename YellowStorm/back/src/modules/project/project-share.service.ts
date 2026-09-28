import { Inject, Injectable, forwardRef } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { isObjectId, normalizeObjectId } from '@common/postgres/object-id';
import { isUniqueViolation } from '@common/postgres/errors';
import { withTransaction } from '@common/postgres/transaction';
import { USER_LOOKUP_PORT, type UserLookupPort, type UserSummary } from '@common/ports/user-lookup.port';
import { type ProjectRecord } from './persistence/project-store';
import { PostgresProjectStore } from './persistence/postgres/postgres-project-store';
import { type ProjectShareRecord } from './persistence/project-share-store';
import { PostgresProjectShareStore } from './persistence/postgres/postgres-project-share-store';
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
import { ConflictException, ForbiddenException, NotFoundException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import {
  CONVERSATION_STORE,
  type ConversationStore,
} from '../conversation/persistence/conversation-store';
import { UserService } from '../user/user.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.types';
import { asAuthUser, type AuthUser } from '@common/auth/auth-user';

type ShareEventType = 'project_shared' | 'project_share_revoked' | 'project_share_updated';

interface ShareIntent {
  user: UserSummary;
  /** Existing share id in PG, or null when the user is not yet shared. */
  shareId: string | null;
  /** Permission requested for this user (last entry wins within a batch). */
  permission: ProjectPermission;
  record: ProjectShareRecord | null;
}

@Injectable()
export class ProjectShareService {
  constructor(
    private readonly projectStore: PostgresProjectStore,
    private readonly shareStore: PostgresProjectShareStore,
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
    userId = normalizeObjectId(userId);
    projectId = normalizeObjectId(projectId);
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
    projectId = normalizeObjectId(projectId);
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
    projectId = normalizeObjectId(projectId);
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
    // Resolve users first (Mongo reads), tracking per-user state so duplicate
    // emails in one batch behave like the old sequential loop: one share row,
    // one write with the last requested permission, one response per entry.
    const pending = new Map<string, ShareIntent>();
    const entries: ShareIntent[] = [];

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
      let intent = pending.get(summary.id);
      if (!intent) {
        const existingShare = await this.shareStore.findOneByProjectAndUser(projectId, summary.id);
        intent = {
          user: summary,
          shareId: existingShare?.id ?? null,
          permission: entry.permission,
          record: existingShare,
        };
        pending.set(summary.id, intent);
      }
      intent.permission = entry.permission;
      entries.push(intent);
    }

    const createdEvents: { userId: string; shareId: string; permission: ProjectPermission }[] = [];
    const updatedEvents: { userId: string; shareId: string; permission: ProjectPermission }[] = [];

    if (pending.size > 0) {
      await this.withShareConflictMapping(() => withTransaction(this.db, async () => {
        for (const intent of pending.values()) {
          if (intent.shareId && intent.record) {
            // Only write + notify when the requested permission differs (old guard).
            if (intent.record.permission !== intent.permission) {
              const record = await this.shareStore.updatePermission(intent.shareId, intent.permission);
              if (record) {
                intent.record = record;
                updatedEvents.push({ userId: intent.user.id, shareId: record.id, permission: intent.permission });
              }
            }
          } else {
            intent.record = await this.shareStore.create({
              projectId,
              ownerId: project.createdBy,
              sharedWithUserId: intent.user.id,
              permission: intent.permission,
              sharedBy: ownerId,
            });
            createdEvents.push({ userId: intent.user.id, shareId: intent.record.id, permission: intent.permission });
          }
        }
        if (createdEvents.length > 0) {
          await this.projectStore.incrementShareCount(projectId, createdEvents.length);
        }
      }));
    }

    const shared: { record: ProjectShareRecord; user: UserSummary }[] = [];
    for (const intent of entries) {
      if (intent.record) shared.push({ record: intent.record, user: intent.user });
    }

    for (const event of createdEvents) {
      await this.pushShareNotification('project_shared', event.userId, project, asAuthUser(owner), {
        shareId: event.shareId,
        permission: event.permission,
      });
    }
    for (const event of updatedEvents) {
      await this.pushShareNotification('project_share_updated', event.userId, project, asAuthUser(owner), {
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
    projectId = normalizeObjectId(projectId);
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
    projectId = normalizeObjectId(projectId);
    shareId = normalizeObjectId(shareId);
    const share = await this.shareStore.findById(shareId);
    if (share?.projectId !== projectId) {
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
          await this.pushShareNotification('project_share_updated', share.sharedWithUserId, project, asAuthUser(owner), {
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
    projectId = normalizeObjectId(projectId);
    shareId = normalizeObjectId(shareId);
    const share = await this.shareStore.findById(shareId);
    if (share?.projectId !== projectId) {
      throw new NotFoundException(ErrorCode.PROJECT_SHARE_NOT_FOUND, 'Share not found');
    }

    const recipientId = share.sharedWithUserId;

    // Only the request that actually removed the row decrements the counter,
    // so a concurrent double revoke cannot drive shareCount down twice.
    const deleted = await withTransaction(this.db, async () => {
      const removed = await this.shareStore.deleteById(shareId);
      if (removed) await this.projectStore.incrementShareCount(projectId, -1);
      return removed;
    });
    if (!deleted) {
      throw new NotFoundException(ErrorCode.PROJECT_SHARE_NOT_FOUND, 'Share not found');
    }

    this.logger.log('Project share revoked', { shareId, projectId });

    try {
      const [project, owner] = await Promise.all([
        this.projectStore.findById(share.projectId),
        this.userService.findById(share.ownerId),
      ]);
      if (project && owner) {
        await this.pushShareNotification('project_share_revoked', recipientId, project, asAuthUser(owner), {
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
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- '' names must stay absent in JSON; ?? would emit ""
          firstName: owner?.firstName ? owner.firstName : undefined,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- '' names must stay absent in JSON; ?? would emit ""
          lastName: owner?.lastName ? owner.lastName : undefined,
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
   * A concurrent share of the same user can win the (project_id,
   * shared_with_user_id) unique index after our existence read; surface a 409
   * instead of a 500. The whole transaction rolls back, so retrying is safe.
   */
  private async withShareConflictMapping<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (isUniqueViolation(err, 'uq_project_shares_project_user')) {
        throw new ConflictException(ErrorCode.CONFLICT, 'This project was concurrently shared with the same user; please retry');
      }
      throw err;
    }
  }

  /**
   * Send an SSE share notification to a user. Failures are logged but swallowed —
   * a stale notification should never block the share operation itself.
   */
  private async pushShareNotification(
    eventType: ShareEventType,
    recipientId: string,
    project: ProjectRecord,
    owner: AuthUser,
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
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- '' names must stay absent in JSON; ?? would emit ""
        firstName: user?.firstName ? user.firstName : undefined,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- '' names must stay absent in JSON; ?? would emit ""
        lastName: user?.lastName ? user.lastName : undefined,
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
