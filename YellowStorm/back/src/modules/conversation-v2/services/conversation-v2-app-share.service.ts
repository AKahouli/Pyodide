import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { UserService } from '@modules/user/user.service';
import { EmailService } from '@modules/email';
import { EmailTemplateRenderer } from '@modules/email/email-template-renderer.service';
import { EmailTemplate } from '@modules/email/email-template.constants';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { NotificationType } from '@modules/notifications/schemas/notification.schema';
import {
  BadRequestException,
  ErrorCode,
  NotFoundException,
  ServiceUnavailableException,
} from '@modules/exceptions';
import {
  ConversationV2AppShare,
  ConversationV2AppShareDocument,
} from '../schemas/conversation-v2-app-share.schema';
import {
  ConversationV2Session,
  ConversationV2SessionDocument,
} from '../schemas/conversation-v2-session.schema';
import type { DeployedAppSummary } from './conversation-v2-session.service';
import { ConversationV2ShareService } from './conversation-v2-share.service';
import { AppDataClientService } from '@modules/app-data/services/app-data-client.service';

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
    @InjectModel(ConversationV2AppShare.name)
    private readonly model: Model<ConversationV2AppShareDocument>,
    @InjectModel(ConversationV2Session.name)
    private readonly sessionModel: Model<ConversationV2SessionDocument>,
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

    const docs = await this.model
      .find({ recipientUserId: new Types.ObjectId(userId) })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();

    // The share rows snapshot the title at share time, which goes stale when the
    // owner renames the session or the app title is only set after sharing. Resolve
    // the live title from the session pointer so owner and recipient stay in sync.
    const sessionIds = docs.map((doc) => doc.sessionId);
    const pointers = sessionIds.length
      ? await this.sessionModel
          .find({ _id: { $in: sessionIds } })
          .select('title deployedAppTitle')
          .lean()
          .exec()
      : [];
    const liveTitleBySession = new Map(
      pointers.map((pointer) => [
        (pointer._id as Types.ObjectId).toString(),
        (pointer as unknown as { deployedAppTitle?: string | null }).deployedAppTitle ??
          (pointer as unknown as { title?: string | null }).title ??
          '',
      ]),
    );

    return docs.map((doc) => ({
      sessionId: doc.sessionId.toString(),
      title: liveTitleBySession.get(doc.sessionId.toString()) || doc.title || '',
      deployedUrl: doc.deployedUrl,
      lastDeployedAt: doc.lastDeployedAt
        ? new Date(doc.lastDeployedAt).toISOString()
        : null,
      source: 'shared' as const,
      shareId: doc._id.toString(),
      canOpenConversation: doc.includeConversation !== false,
      lastDeployedRevisionId: null,
      latestFinalizedRevisionId: null,
      latestFinalizedAt: null,
      finalizedVersionCount: 0,
    }));
  }

  /** True when the user has an app-share row with conversation access for this session. */
  async hasConversationAccess(userId: string, sessionId: string): Promise<boolean> {
    await this.claimPendingSharesForUser(userId);

    if (!Types.ObjectId.isValid(sessionId) || !Types.ObjectId.isValid(userId)) return false;
    const share = await this.model
      .findOne({
        sessionId: new Types.ObjectId(sessionId),
        recipientUserId: new Types.ObjectId(userId),
        includeConversation: { $ne: false },
      })
      .select('_id')
      .lean()
      .exec();
    return !!share;
  }

  async removeShareForRecipient(userId: string, sessionId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(sessionId)) return false;
    const result = await this.model
      .findOneAndDelete({
        sessionId: new Types.ObjectId(sessionId),
        recipientUserId: new Types.ObjectId(userId),
      })
      .lean()
      .exec();
    return !!result;
  }

  /**
   * Look up a register-invite token by SHA-256 hash. Returns null when the
   * token is unknown. Callers map expired/consumed/mismatch to HTTP errors.
   */
  async resolveInviteToken(token: string): Promise<ResolvedAppShareInvite | null> {
    const hash = this.hashInviteToken(token);
    if (!hash) return null;

    const share = await this.model.findOne({ inviteTokenHash: hash }).lean().exec();
    if (!share?.inviteExpiresAt) return null;

    const email = await this.resolveShareEmail(share);
    if (!email) return null;

    const session = await this.sessionModel.findById(share.sessionId).lean().exec();
    const workspaceId = session?.aiSessionId ?? null;
    const liveTitle =
      (session as { deployedAppTitle?: string | null } | null)?.deployedAppTitle?.trim() ||
      session?.title?.trim() ||
      share.title;

    return {
      email,
      appTitle: liveTitle || 'An app',
      deployedUrl: share.deployedUrl,
      sessionId: share.sessionId.toString(),
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

    const share = await this.model.findOne({ inviteTokenHash: hash }).exec();
    if (!share?.inviteExpiresAt) return false;
    if (share.inviteExpiresAt.getTime() < Date.now()) return false;

    const shareEmail = await this.resolveShareEmail(share);
    if (!shareEmail || shareEmail !== normalized) return false;

    if (share.inviteConsumedAt) return true;

    share.inviteConsumedAt = new Date();
    await share.save();
    return true;
  }

  async deleteAllSharesForSession(sessionId: string): Promise<void> {
    if (!Types.ObjectId.isValid(sessionId)) return;
    await this.model.deleteMany({ sessionId: new Types.ObjectId(sessionId) }).exec();
  }

  async syncDeployMetadata(
    sessionId: string,
    patch: { title: string; deployedUrl: string; lastDeployedAt: Date | null },
  ): Promise<void> {
    if (!Types.ObjectId.isValid(sessionId)) return;
    await this.model
      .updateMany(
        { sessionId: new Types.ObjectId(sessionId) },
        {
          $set: {
            title: patch.title,
            deployedUrl: patch.deployedUrl,
            lastDeployedAt: patch.lastDeployedAt,
          },
        },
      )
      .exec();
  }

  /**
   * Create an invite for the session owner so their email is pre-filled on
   * the deployed app's Register page. Unlike `shareOne`, this does NOT send
   * an email or create a conversation share record.
   *
   * Returns the plain-text invite token, or null when the owner lookup or
   * invite creation fails (the deploy still succeeds — auto-fill is best-effort).
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
        const session = await this.sessionModel.findById(params.sessionId).lean().exec();
        const workspaceId = (session as { aiSessionId?: string } | null)?.aiSessionId;
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

    // Store a local invite record so resolveInviteToken can find it.
    await this.model
      .findOneAndUpdate(
        {
          sessionId: new Types.ObjectId(params.sessionId),
          recipientEmail: email,
        },
        {
          $set: {
            ownerId: new Types.ObjectId(params.ownerId),
            title: params.title,
            deployedUrl: params.deployedUrl,
            includeConversation: false,
            recipientEmail: email,
            ...inviteFields,
          },
          $setOnInsert: {
            sessionId: new Types.ObjectId(params.sessionId),
          },
        },
        { upsert: true, new: true },
      )
      .exec();

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
        // params.sessionId is a MongoDB ObjectId; the microservice stores the
        // AI workspace ID (aiSessionId) as workspace_id. Resolve it first.
        const session = await this.sessionModel.findById(params.sessionId).lean().exec();
        const workspaceId = (session as { aiSessionId?: string } | null)?.aiSessionId;
        if (workspaceId) {
          const app = await this.appDataClient.getAppByWorkspace(workspaceId);
          if (app) {
            const ttlDays = this.config.get<number>('conversationV2.appShareInviteTtlDays', 7);
            const remote = await this.appDataClient.createInvite(app.id, email, ttlDays);
            inviteToken = remote.token;
          }
        }
      } catch (err) {
        // In remote mode the deployed app resolves invites against the
        // microservice, so a locally-minted token is useless — the user
        // would hit a 404 on the register page. Fail the share instead.
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
    const share = recipient
      ? await this.upsertKnownRecipientShare(params, recipient._id, email, inviteFields)
      : await this.upsertPendingEmailShare(params, email, inviteFields);

    await this.sendInviteEmail({
      to: email,
      title: params.title,
      deployedUrl: params.deployedUrl,
      sessionId: params.sessionId,
      inviteToken,
    });

    if (recipient) {
      await this.notifyRecipient(recipient._id.toString(), params.title);
    }

    return { shareId: share._id.toString(), recipientEmail: email };
  }

  private async upsertKnownRecipientShare(
    params: {
      ownerId: string;
      sessionId: string;
      title: string;
      deployedUrl: string;
      lastDeployedAt: Date | null;
    },
    recipientId: Types.ObjectId,
    email: string,
    inviteFields: {
      inviteTokenHash: string;
      inviteExpiresAt: Date;
      inviteConsumedAt: Date | null;
    },
  ): Promise<ConversationV2AppShareDocument> {
    return this.model.findOneAndUpdate(
      {
        sessionId: new Types.ObjectId(params.sessionId),
        recipientUserId: recipientId,
      },
      {
        $set: {
          ownerId: new Types.ObjectId(params.ownerId),
          title: params.title,
          deployedUrl: params.deployedUrl,
          lastDeployedAt: params.lastDeployedAt,
          includeConversation: true,
          recipientEmail: email,
          ...inviteFields,
        },
        $setOnInsert: {
          sessionId: new Types.ObjectId(params.sessionId),
          recipientUserId: recipientId,
        },
      },
      { upsert: true, new: true },
    );
  }

  private async upsertPendingEmailShare(
    params: {
      ownerId: string;
      sessionId: string;
      title: string;
      deployedUrl: string;
      lastDeployedAt: Date | null;
    },
    email: string,
    inviteFields: {
      inviteTokenHash: string;
      inviteExpiresAt: Date;
      inviteConsumedAt: Date | null;
    },
  ): Promise<ConversationV2AppShareDocument> {
    return this.model.findOneAndUpdate(
      {
        sessionId: new Types.ObjectId(params.sessionId),
        recipientEmail: email,
      },
      {
        $set: {
          ownerId: new Types.ObjectId(params.ownerId),
          title: params.title,
          deployedUrl: params.deployedUrl,
          lastDeployedAt: params.lastDeployedAt,
          includeConversation: true,
          recipientEmail: email,
          ...inviteFields,
        },
        $setOnInsert: {
          sessionId: new Types.ObjectId(params.sessionId),
        },
      },
      { upsert: true, new: true },
    );
  }

  private async claimPendingSharesForUser(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user?.email) return;

    const email = user.email.trim().toLowerCase();
    await this.model
      .updateMany(
        {
          recipientEmail: email,
          $or: [{ recipientUserId: null }, { recipientUserId: { $exists: false } }],
        },
        {
          $set: { recipientUserId: new Types.ObjectId(userId) },
        },
      )
      .exec();
  }

  private async resolveShareEmail(share: {
    recipientEmail?: string | null;
    recipientUserId?: Types.ObjectId | null;
  }): Promise<string | null> {
    if (share.recipientEmail) return share.recipientEmail.trim().toLowerCase();
    if (!share.recipientUserId) return null;
    const user = await this.users.findById(share.recipientUserId.toString());
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
    const base = deployedUrl.replace(/\/?$/, '/');
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
