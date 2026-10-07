import { Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
import { UserService } from '@modules/user';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { NotificationType } from '@modules/notifications/notification.types';
import { ForbiddenException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticModelService } from './semantic-model.service';
import type { ShareSemanticModelDto, UpdateSemanticModelShareDto } from '../dto/semantic-model-share.dto';
import { SemanticDataGrantService } from './semantic-data-grant.service';

export interface SemanticModelMemberRow {
  userId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: 'viewer' | 'editor';
  createdAt: string;
}

export interface SemanticModelShareResult {
  shared: { userId: string; email: string; role: string }[];
  notFound: string[];
  alreadyOwner: string[];
  alreadyShared: string[];
}

type ShareEvent = 'shared' | 'role_changed' | 'revoked';

@Injectable()
export class SemanticModelShareService {
  private readonly logger = new Logger(SemanticModelShareService.name);

  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly models: SemanticModelService,
    private readonly users: UserService,
    private readonly grants: SemanticDataGrantService,
    @Optional() @Inject(forwardRef(() => NotificationsService))
    private readonly notifications?: NotificationsService,
  ) {}

  /** Adds who owns each model the user does not own, so the catalog can say who shared it. */
  async attachOwners<T extends { items: Array<{ ownerUserId: string; role?: string }> }>(page: T): Promise<T> {
    const foreign = [...new Set(page.items.filter((item) => item.role !== 'owner').map((item) => item.ownerUserId))];
    if (!foreign.length) return page;
    const owners = new Map<string, { ownerName: string | null; ownerEmail: string | null }>();
    await Promise.all(foreign.map(async (id) => {
      const user = await this.users.findById(id).catch(() => null);
      if (!user) return;
      const name = [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(' ');
      owners.set(id, { ownerName: name || null, ownerEmail: user.email ?? null });
    }));
    for (const item of page.items) Object.assign(item, owners.get(item.ownerUserId) ?? {});
    return page;
  }

  /** A notification must never fail the share itself: errors are logged and swallowed. */
  private async notify(event: ShareEvent, requesterId: string, recipientId: string, model: { id: string; name: string }, role?: string): Promise<void> {
    if (!this.notifications) return;
    try {
      const requester = await this.users.findById(requesterId).catch(() => null);
      const who = [requester?.profile?.firstName, requester?.profile?.lastName].filter(Boolean).join(' ') || requester?.email || 'Someone';
      const roleLabel = role === 'editor' ? 'edit' : 'view';
      const [title, message] = event === 'shared'
        ? ['Business model shared', `${who} shared "${model.name}" with you (you can ${roleLabel} it).`]
        : event === 'role_changed'
          ? ['Business model access updated', `Your access to "${model.name}" changed: you can now ${roleLabel} it.`]
          : ['Business model access revoked', `Your access to "${model.name}" was revoked.`];
      await this.notifications.sendToUser(recipientId, {
        type: NotificationType.INFO,
        title,
        message,
        data: { eventType: `semantic_model_${event}`, modelId: model.id, modelName: model.name, role },
        actions: event === 'revoked' ? undefined : [{ label: 'Open model', url: `/semantic-models/${model.id}` }],
        metadata: { sourceModule: 'semantic-model-share' },
      });
    } catch (error) {
      this.logger.warn(`Share notification failed (${event}): ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  async list(requesterId: string, modelId: string): Promise<SemanticModelMemberRow[]> {
    await this.models.requireRole(requesterId, modelId, ['owner', 'editor', 'viewer']);
    const result = await this.database.query<SemanticModelMemberRow>(
      `SELECT user_id AS "userId", email, first_name AS "firstName", last_name AS "lastName",
              role, created_at AS "createdAt"
       FROM semantic_model.memberships
       WHERE model_id = $1 AND role != 'owner'
       ORDER BY created_at`,
      [modelId],
    );
    return result.rows;
  }

  async share(requesterId: string, modelId: string, dto: ShareSemanticModelDto): Promise<SemanticModelShareResult> {
    const model = await this.models.requireRole(requesterId, modelId, ['owner']);
    const result: SemanticModelShareResult = { shared: [], notFound: [], alreadyOwner: [], alreadyShared: [] };

    for (const entry of dto.shares) {
      const user = await this.users.findByEmail(entry.email);
      if (!user) { result.notFound.push(entry.email); continue; }
      const userId = user._id.toString();
      if (userId === model.ownerUserId) { result.alreadyOwner.push(entry.email); continue; }

      const upsert = await this.database.transaction(async (client) => {
        const changed = await client.query<{ inserted: boolean }>(
          `INSERT INTO semantic_model.memberships (model_id, user_id, role, email, first_name, last_name)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (model_id, user_id) DO UPDATE
             SET role = EXCLUDED.role, email = EXCLUDED.email,
                 first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name
           RETURNING (xmax = 0) AS inserted`,
          [modelId, userId, entry.role, user.email, user.profile?.firstName ?? null, user.profile?.lastName ?? null],
        );
        if (!changed.rows[0]?.inserted) await this.grants.revokeModelGrants(client, modelId, userId);
        return changed;
      });

      const wasInserted = upsert.rows[0]?.inserted;
      if (!wasInserted) result.alreadyShared.push(entry.email);
      result.shared.push({ userId, email: entry.email, role: entry.role });
      await this.notify(wasInserted ? 'shared' : 'role_changed', requesterId, userId, model, entry.role);
    }
    return result;
  }

  async updateRole(requesterId: string, modelId: string, targetUserId: string, dto: UpdateSemanticModelShareDto): Promise<void> {
    const model = await this.models.requireRole(requesterId, modelId, ['owner']);
    const update = await this.database.transaction(async (client) => {
      const changed = await client.query(
        `UPDATE semantic_model.memberships SET role = $3
         WHERE model_id = $1 AND user_id = $2 AND role != 'owner'`,
        [modelId, targetUserId, dto.role],
      );
      if (changed.rowCount) await this.grants.revokeModelGrants(client, modelId, targetUserId);
      return changed;
    });
    if (!update.rowCount) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND);
    await this.notify('role_changed', requesterId, targetUserId, model, dto.role);
  }

  async revoke(requesterId: string, modelId: string, targetUserId: string): Promise<void> {
    const model = await this.models.requireRole(requesterId, modelId, ['owner']);
    if (targetUserId === model.ownerUserId) throw new ForbiddenException(ErrorCode.SEMANTIC_MODEL_ACCESS_DENIED);
    await this.database.transaction(async (client) => {
      await client.query(
        `DELETE FROM semantic_model.memberships WHERE model_id = $1 AND user_id = $2 AND role != 'owner'`,
        [modelId, targetUserId],
      );
      await this.grants.revokeModelGrants(client, modelId, targetUserId);
    });
    await this.notify('revoked', requesterId, targetUserId, model);
  }
}
