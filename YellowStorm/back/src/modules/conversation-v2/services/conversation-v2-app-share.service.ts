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
import type { DeployedAppSummary } from './conversation-v2-session.service';

export interface ShareAppsBatchResult {
  shared: Array<{ shareId: string; recipientEmail: string }>;
  notFound: string[];
  skippedSelf: string[];
}

/**
 * Marketplace-only app sharing: grants recipients a card without conversation access.
 */
@Injectable()
export class ConversationV2AppShareService {
  private readonly logger = new Logger(ConversationV2AppShareService.name);

  constructor(
    @InjectModel(ConversationV2AppShare.name)
    private readonly model: Model<ConversationV2AppShareDocument>,
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
    return docs.map((doc) => ({
      sessionId: doc.sessionId.toString(),
      title: doc.title,
      deployedUrl: doc.deployedUrl,
      lastDeployedAt: doc.lastDeployedAt
        ? new Date(doc.lastDeployedAt).toISOString()
        : null,
      source: 'shared' as const,
      shareId: doc._id.toString(),
    }));
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

    await this.sendInviteEmail({ to: email, title: params.title, deployedUrl: params.deployedUrl });

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
  }): Promise<void> {
    const appName = this.config.get<string>('app.name', 'YelloStorm');
    const frontBase = this.config.get<string>('app.frontendUrl') ?? 'http://localhost:5173';
    const marketplaceUrl = `${frontBase.replace(/\/$/, '')}/#/app-market`;
    const subject = `${params.title || 'An app'} has been shared with you`;
    const html = `
      <p>Hello,</p>
      <p>An app built on ${appName} has been shared with you.</p>
      <p><a href="${params.deployedUrl}" target="_blank" rel="noreferrer">${params.deployedUrl}</a></p>
      <p>You can also open it from your <a href="${marketplaceUrl}">App Marketplace</a>.</p>
    `;
    const text = [
      'An app has been shared with you.',
      `Open it here: ${params.deployedUrl}`,
      `Marketplace: ${marketplaceUrl}`,
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
        message: `"${title || 'An app'}" was added to your App Marketplace.`,
        data: { route: '/app-market' },
        metadata: { sourceModule: 'conversation-v2-app-share' },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to notify recipient ${userId}: ${(error as Error).message}`,
      );
    }
  }
}
