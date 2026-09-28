import { Injectable,  Logger,  Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserService } from '@modules/user/user.service';
import { EmailService } from '@modules/email';
import { EmailTemplateRenderer } from '@modules/email/email-template-renderer.service';
import { EmailTemplate } from '@modules/email/email-template.constants';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { NotificationType } from '@modules/notifications/notification.types';
import {
  BadRequestException,
  ErrorCode,
  NotFoundException,
  ServiceUnavailableException,
} from '@modules/exceptions';
import { isObjectId } from '@common/postgres';
import type { DeployedAppSummary } from './conversation-v2-session.service';
import { ConversationV2ShareService } from './conversation-v2-share.service';
import { AppDataClientService } from '@modules/app-data/services/app-data-client.service';
import {
  type ConversationV2AppShareRecord,  
} from '../persistence/conversation-v2-app-share.store';
import { PgConversationV2AppShareStore } from '../persistence/postgres/pg-conversation-v2-app-share.store';
import { PgConversationV2SessionStore } from '../persistence/postgres/pg-conversation-v2-session.store';

export interface ShareAppsBatchResult {
  shared: Array<{ shareId: string; recipientEmail: string }>;
  notFound: string[];
  skippedSelf: string[];
}

export interface ResolvedAppShareInvite {
  email: string;
  appTitle: string;
  deployedUrl: string;
  sessionId: string;
  workspaceId: string | null;
  expiresAt: Date;
  consumed: boolean;
}

/**
 * Marketplace app sharing. New shares also grant full conversation access
 * (`includeConversation: true`) so recipients can open the session via the
 * same Share icon flow.
 */
@Injectable()
export class ConversationV2AppShareService {
  private readonly logger = new Logger(ConversationV2AppShareService.name);

  constructor(
    private readonly shares: PgConversationV2AppShareStore,
    private readonly sessions: PgConversationV2SessionStore,
    private readonly users: UserService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    private readonly emailRenderer: EmailTemplateRenderer,
    private readonly config: ConfigService,
    private readonly shareTokens: ConversationV2ShareService,
    @Optional() private readonly appDataClient?: AppDataClientService,
  ) {}

  async shareByEmails(params: {
    ownerId: string;
    sessionId: string;
    emails: string[];
    title: string;
    deployedUrl: string;
    lastDeployedAt: Date | null;
  }): Promise<ShareAppsBatchResult> {
    if (!this.email.isAvailable()) {
      throw new ServiceUnavailableException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'Email service is not available',
      );
    }

    const recipients = Array.from(new Set(params.emails.map((e) => e.trim().toLowerCase())));
    const shared: ShareAppsBatchResult['shared'] = [];
    const notFound: string[] = [];
    const skippedSelf: string[] = [];

    for (const email of recipients) {
      try {
        shared.push(await this.shareOne({ ...params, email }));
      } catch (error) {
        if (error instanceof BadRequestException) {
          skippedSelf.push(email);
          continue;
        }
        throw error;
      }
    }

    return { shared, notFound, skippedSelf };
  }

  async listSharedWithUser(userId: string): Promise<DeployedAppSummary[]> {
    await this.claimPendingSharesForUser(userId);

    const docs = await this.shares.listByRecipientUserId(userId);

    const sessionIds = docs.map((doc) => doc.sessionId);
    const pointers = sessionIds.length ? await this.sessions.findByIds(sessionIds) : [];
    const liveMetaBySession = new Map(
      pointers.map((pointer) => [
        pointer.id,
        {
          title: pointer.deployedAppTitle ?? pointer.title ?? '',
          hasAiFeatures: pointer.hasAiFeatures === true,
        },
      ]),
    );

    return docs.map((doc) => {
      const live = liveMetaBySession.get(doc.sessionId);
      return {
        sessionId: doc.sessionId,
        title: live?.title || doc.title || '',
        deployedUrl: doc.deployedUrl,
        lastDeployedAt: doc.lastDeployedAt
          ? new Date(doc.lastDeployedAt).toISOString()
          : null,
        source: 'shared' as const,
        shareId: doc.id,
        canOpenConversation: doc.includeConversation !== false,
        hasAiFeatures: live?.hasAiFeatures === true,
        lastDeployedRevisionId: null,
        latestFinalizedRevisionId: null,
        latestFinalizedAt: null,
        finalizedVersionCount: 0,
      };
    });
  }

  /** True when the user has an app-share row with conversation access for this session. */
  async hasConversationAccess(userId: string, sessionId: string): Promise<boolean> {
    await this.claimPendingSharesForUser(userId);
    return this.shares.findConversationAccess(userId, sessionId);
  }

  async removeShareForRecipient(userId: string, sessionId: string): Promise<boolean> {
    return this.shares.deleteForRecipient(userId, sessionId);
  }

  /**
   * Look up a register-invite token by SHA-256 hash. Returns null when the
   * token is unknown. Callers map expired/consumed/mismatch to HTTP errors.
   */
  async resolveInviteToken(token: string): Promise<ResolvedAppShareInvite | null> {
    const hash = this.hashInviteToken(token);
    if (!hash) return null;

    const share = await this.shares.findByInviteTokenHash(hash);
    if (!share?.inviteExpiresAt) return null;

    const email = await this.resolveShareEmail(share);
    if (!email) return null;

    const session = await this.sessions.findById(share.sessionId, { includeDeleted: true });
    const workspaceId = session?.aiSessionId ?? null;
    const liveTitle =
      session?.deployedAppTitle?.trim() ||
      session?.title?.trim() ||
      share.title;

    return {
      email,
      appTitle: liveTitle || 'An app',
      deployedUrl: share.deployedUrl,
      sessionId: share.sessionId,
      workspaceId,
      expiresAt: share.inviteExpiresAt,
      consumed: !!share.inviteConsumedAt,
    };
  }

  /**
   * Mark the invite consumed. Idempotent when the same email already consumed it.
   * Returns false when the token is unknown, expired, or bound to another email.
   */
  async consumeInviteToken(token: string, email: string): Promise<boolean> {
    const hash = this.hashInviteToken(token);
    if (!hash) return false;
    const normalized = email.trim().toLowerCase();

    const share = await this.shares.findByInviteTokenHash(hash);
    if (!share?.inviteExpiresAt) return false;
    if (share.inviteExpiresAt.getTime() < Date.now()) return false;

    const shareEmail = await this.resolveShareEmail(share);
    if (!shareEmail || shareEmail !== normalized) return false;

    if (share.inviteConsumedAt) return true;

    await this.shares.markInviteConsumed(share.id);
    return true;
  }

  async deleteAllSharesForSession(sessionId: string): Promise<void> {
    await this.shares.deleteAllForSession(sessionId);
  }

  async syncDeployMetadata(
    sessionId: string,
    patch: { title: string; deployedUrl: string; lastDeployedAt: Date | null },
  ): Promise<void> {
    await this.shares.syncDeployMetadata(sessionId, patch);
  }

  /**
   * Create an invite for the session owner so their email is pre-filled on
   * the deployed app's Register page. Unlike `shareOne`, this does NOT send
   * an email or create a conversation share record.
   */
  async createOwnerInvite(params: {
    ownerId: string;
    sessionId: string;
    title: string;
    deployedUrl: string;
  }): Promise<string | null> {
    this.logger.debug(
      `createOwnerInvite: ownerId=${params.ownerId} sessionId=${params.sessionId}`,
    );
    const owner = await this.users.findById(params.ownerId);
    if (!owner?.email) {
      this.logger.warn(
        `createOwnerInvite: owner not found or missing email for ownerId=${params.ownerId}`,
      );
      return null;
    }

    const email = owner.email.trim().toLowerCase();
    const { token, hash } = this.shareTokens.issue();
    const inviteFields = {
      inviteTokenHash: hash,
      inviteExpiresAt: this.buildInviteExpiry(),
      inviteConsumedAt: null as Date | null,
    };

    let inviteToken = token;

    if (this.appDataClient?.isEnabled()) {
      try {
        const session = await this.sessions.findById(params.sessionId, { includeDeleted: true });
        const workspaceId = session?.aiSessionId;
        this.logger.debug(
          `createOwnerInvite: workspaceId=${workspaceId ?? 'null'} for session=${params.sessionId}`,
        );
        if (workspaceId) {
          const app = await this.appDataClient.getAppByWorkspace(workspaceId);
          if (app) {
            const ttlDays = this.config.get<number>('conversationV2.appShareInviteTtlDays', 7);
            const remote = await this.appDataClient.createInvite(app.id, email, ttlDays);
            inviteToken = remote.token;
            this.logger.debug(
              `createOwnerInvite: remote invite created for app=${app.id} email=${email}`,
            );
          } else {
            this.logger.warn(
              `createOwnerInvite: app not found for workspaceId=${workspaceId}`,
            );
          }
        }
      } catch (err) {
        this.logger.warn(
          `Owner auto-invite: microservice creation failed for session=${params.sessionId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    } else {
      this.logger.debug('createOwnerInvite: appDataClient not enabled, using local token');
    }

    await this.shares.upsertByRecipientEmail({
      sessionId: params.sessionId,
      ownerId: params.ownerId,
      title: params.title,
      deployedUrl: params.deployedUrl,
      includeConversation: false,
      recipientEmail: email,
      ...inviteFields,
    });

    this.logger.debug(`createOwnerInvite: returning token for email=${email}`);
    return inviteToken;
  }

  private async shareOne(params: {
    ownerId: string;
    sessionId: string;
    email: string;
    title: string;
    deployedUrl: string;
    lastDeployedAt: Date | null;
  }): Promise<{ shareId: string; recipientEmail: string }> {
    const email = params.email.trim().toLowerCase();
    const owner = await this.users.findById(params.ownerId);
    if (!owner) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND);
    }
    if (owner.email.toLowerCase() === email) {
      throw new BadRequestException('You cannot share an app with yourself');
    }

    const { token, hash } = this.shareTokens.issue();
    const inviteFields = {
      inviteTokenHash: hash,
      inviteExpiresAt: this.buildInviteExpiry(),
      inviteConsumedAt: null as Date | null,
    };

    let inviteToken = token;
    if (this.appDataClient?.isEnabled()) {
      try {
        const session = await this.sessions.findById(params.sessionId, { includeDeleted: true });
        const workspaceId = session?.aiSessionId;
        if (workspaceId) {
          const app = await this.appDataClient.getAppByWorkspace(workspaceId);
          if (app) {
            const ttlDays = this.config.get<number>('conversationV2.appShareInviteTtlDays', 7);
            const remote = await this.appDataClient.createInvite(app.id, email, ttlDays);
            inviteToken = remote.token;
          }
        }
      } catch (err) {
        this.logger.error(
          `Cannot share: microservice invite creation failed for session=${params.sessionId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw new ServiceUnavailableException(
          ErrorCode.SERVICE_UNAVAILABLE,
          'Failed to create invitation in the data service. Please try again.',
        );
      }
    }

    const recipient = await this.users.findByEmail(email);
    const recipientId = recipient
      ? String((recipient as { id?: string; _id?: { toString(): string } }).id
        ?? (recipient as { _id?: { toString(): string } })._id?.toString()
        ?? '')
      : '';

    const share = recipientId
      ? await this.shares.upsertByRecipientUser({
          sessionId: params.sessionId,
          ownerId: params.ownerId,
          recipientUserId: recipientId,
          recipientEmail: email,
          title: params.title,
          deployedUrl: params.deployedUrl,
          lastDeployedAt: params.lastDeployedAt,
          includeConversation: true,
          ...inviteFields,
        })
      : await this.shares.upsertByRecipientEmail({
          sessionId: params.sessionId,
          ownerId: params.ownerId,
          recipientEmail: email,
          title: params.title,
          deployedUrl: params.deployedUrl,
          lastDeployedAt: params.lastDeployedAt,
          includeConversation: true,
          ...inviteFields,
        });

    await this.sendInviteEmail({
      to: email,
      title: params.title,
      deployedUrl: params.deployedUrl,
      sessionId: params.sessionId,
      inviteToken,
    });

    if (recipientId) {
      await this.notifyRecipient(recipientId, params.title);
    }

    return { shareId: share.id, recipientEmail: email };
  }

  private async claimPendingSharesForUser(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user?.email) return;
    const email = user.email.trim().toLowerCase();
    await this.shares.claimPendingByEmail(userId, email);
  }

  private async resolveShareEmail(share: ConversationV2AppShareRecord): Promise<string | null> {
    if (share.recipientEmail) return share.recipientEmail.trim().toLowerCase();
    if (!share.recipientUserId) return null;
    const user = await this.users.findById(share.recipientUserId);
    return user?.email?.trim().toLowerCase() ?? null;
  }

  private hashInviteToken(token: string): string | null {
    const trimmed = token?.trim();
    if (!trimmed) return null;
    return this.shareTokens.hashToken(trimmed);
  }

  private buildInviteExpiry(): Date {
    const days = this.config.get<number>('conversationV2.appShareInviteTtlDays', 7);
    const ttl = Number.isFinite(days) && days >= 1 ? days : 7;
    return new Date(Date.now() + ttl * 24 * 60 * 60 * 1000);
  }

  private buildRegisterInviteUrl(deployedUrl: string, token: string): string {
    const base = `${(deployedUrl || '').trim().replace(/\/+$/, '')}/`;
    return `${base}register?invite=${encodeURIComponent(token)}`;
  }

  private async sendInviteEmail(params: {
    to: string;
    title: string;
    deployedUrl: string;
    sessionId: string;
    inviteToken: string;
  }): Promise<void> {
    const registerUrl = this.buildRegisterInviteUrl(params.deployedUrl, params.inviteToken);
    const inviteTtlDays = this.config.get<number>('conversationV2.appShareInviteTtlDays', 7);
    const ttl = Number.isFinite(inviteTtlDays) && inviteTtlDays >= 1 ? inviteTtlDays : 7;
    const { subject, html, text, attachments } = await this.emailRenderer.render(
      EmailTemplate.APP_SHARE_INVITE,
      {
        appTitle: params.title || 'An app',
        registerUrl,
        inviteTtlDays: String(ttl),
        inviteTtlDaysSuffix: ttl === 1 ? '' : 's',
      },
    );

    const result = await this.email.send({ to: params.to, subject, html, text, attachments });
    if (!result.success) {
      this.logger.warn(`Failed to send app-share email to ${params.to}`);
      throw new ServiceUnavailableException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'Failed to send invitation email',
      );
    }
  }

  private async notifyRecipient(userId: string, title: string): Promise<void> {
    try {
      await this.notifications.sendToUser(userId, {
        type: NotificationType.INFO,
        title: 'App shared with you',
        message: `"${title || 'An app'}" and its conversation were added to your App Builder.`,
        data: { route: '/app-builder' },
        metadata: { sourceModule: 'conversation-v2-app-share' },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to notify recipient ${userId}: ${(error as Error).message}`,
      );
    }
  }
}
