import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { UserService } from '@modules/user/user.service';
import { EmailService } from '@modules/email';
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

export interface ShareAppsBatchResult {
  shared: Array<{ shareId: string; recipientEmail: string }>;
  notFound: string[];
  skippedSelf: string[];
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
    private readonly config: ConfigService,
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
        if (error instanceof NotFoundException && error.code === ErrorCode.USER_NOT_FOUND) {
          notFound.push(email);
          continue;
        }
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
    }));
  }

  /** True when the user has an app-share row with conversation access for this session. */
  async hasConversationAccess(userId: string, sessionId: string): Promise<boolean> {
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

  private async shareOne(params: {
    ownerId: string;
    sessionId: string;
    email: string;
    title: string;
    deployedUrl: string;
    lastDeployedAt: Date | null;
  }): Promise<{ shareId: string; recipientEmail: string }> {
    const email = params.email.trim().toLowerCase();
    const recipient = await this.users.findByEmail(email);
    if (!recipient) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND);
    }
    if (recipient._id.toString() === params.ownerId) {
      throw new BadRequestException('You cannot share an app with yourself');
    }

    await this.sendInviteEmail({
      to: email,
      title: params.title,
      deployedUrl: params.deployedUrl,
      sessionId: params.sessionId,
    });

    const share = await this.model.findOneAndUpdate(
      {
        sessionId: new Types.ObjectId(params.sessionId),
        recipientUserId: recipient._id,
      },
      {
        $set: {
          ownerId: new Types.ObjectId(params.ownerId),
          title: params.title,
          deployedUrl: params.deployedUrl,
          lastDeployedAt: params.lastDeployedAt,
          includeConversation: true,
        },
        $setOnInsert: {
          sessionId: new Types.ObjectId(params.sessionId),
          recipientUserId: recipient._id,
        },
      },
      { upsert: true, new: true },
    );

    await this.notifyRecipient(recipient._id.toString(), params.title);

    return { shareId: share._id.toString(), recipientEmail: email };
  }

  private async sendInviteEmail(params: {
    to: string;
    title: string;
    deployedUrl: string;
    sessionId: string;
  }): Promise<void> {
    const appName = this.config.get<string>('app.name', 'YelloStorm');
    const frontBase = this.config.get<string>('app.frontendUrl') ?? 'http://localhost:5173';
    const base = frontBase.replace(/\/$/, '');
    const marketplaceUrl = `${base}/#/app-builder`;
    const conversationUrl = `${base}/#/conversation-v2/${params.sessionId}`;
    const subject = `${params.title || 'An app'} has been shared with you`;
    const html = `
      <p>Hello,</p>
      <p>An app and its conversation built on ${appName} have been shared with you.</p>
      <p><strong>App:</strong> <a href="${params.deployedUrl}" target="_blank" rel="noreferrer">${params.deployedUrl}</a></p>
      <p><strong>Conversation:</strong> <a href="${conversationUrl}">Open the conversation</a></p>
      <p>You can also open the app from your <a href="${marketplaceUrl}">App Builder</a>.</p>
    `;
    const text = [
      'An app and its conversation have been shared with you.',
      `App: ${params.deployedUrl}`,
      `Conversation: ${conversationUrl}`,
      `App Builder: ${marketplaceUrl}`,
    ].join('\n');

    const result = await this.email.send({ to: params.to, subject, html, text });
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
