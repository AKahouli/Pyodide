import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { BadRequestException, ForbiddenException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { EmailService } from '../../email/email.service';
import { LoggerService } from '../../logger';
import { UserService } from '../../user/user.service';
import { WorkspaceService } from '../../workspace/workspace.service';
import { WorkspaceShareService } from '../../workspace/workspace-share.service';
import type {
  CreateShareData,
  EmbeddedMessage,
  PublicShareViewResponse,
  ShareResponse,
} from '../interfaces/share.interface';
import {
  SHARE_STORE,
  type SharedConversationRecord,
  type ShareSourceConversationRecord,
  type ShareStore,
} from '../persistence/share-store';
import { sanitizePublicComponent } from '../utils/public-component-sanitizer';
import { buildShareEmailBody } from '../utils/share-email.template';

const publicShareComponentTypes = new Set([
  'text',
  'code',
  'plan',
  'queue',
  'checkpoint',
  'chart',
  'task',
  'error',
  'sources',
  'sandbox',
  'webPreview',
  'citation',
  'choice',
  'agentActivity',
  'toolActivity',
]);

function sanitizePublicShareMessages(messages: readonly EmbeddedMessage[]): EmbeddedMessage[] {
  return messages.map(({ components, content, ...message }) => ({
    ...message,
    ...(message.conversationType === 'user' && content ? { content } : {}),
    ...(components
      ? {
          components: components
            .filter((component) => publicShareComponentTypes.has(component.type))
            .map((component) => {
              if (component.type === 'task') {
                return sanitizePublicComponent({
                  ...component,
                  data: { ...component.data, items: [] },
                });
              }
              if (component.type === 'toolActivity') {
                const {
                  paramsJson: _paramsJson,
                  resultJson: _resultJson,
                  primaryInput: _primaryInput,
                  ...displayData
                } = component.data;
                return sanitizePublicComponent({ ...component, data: displayData });
              }
              return sanitizePublicComponent(component);
            }),
        }
      : {}),
  }));
}

@Injectable()
export class ShareService {
  constructor(
    @Inject(SHARE_STORE) private readonly shareStore: ShareStore,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly userService: UserService,
    private readonly emailService: EmailService,
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceShareService: WorkspaceShareService,
  ) {
    this.logger.setContext('ShareService');
  }

  async createShare(userId: string, data: CreateShareData): Promise<ShareResponse> {
    const conversation = await this.shareStore.findSourceConversation(data.conversationId);
    if (!conversation) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Conversation not found');
    }
    if (conversation.createdBy !== userId) {
      throw new ForbiddenException(
        ErrorCode.CHAT_SHARE_FORBIDDEN,
        'Only the conversation owner can share it',
      );
    }
    if (conversation.runtimeMode === 'governed') {
      throw new ForbiddenException(
        ErrorCode.CHAT_FORBIDDEN,
        'Governed conversations cannot be shared',
      );
    }
    if (data.shareType === 'public') {
      const maxCloneMessages = this.configService.get<number>('conversation.maxCloneMessages', 2000);
      const sourceMessages = await this.shareStore.listSnapshotMessages(
        conversation.id,
        maxCloneMessages + 1,
      );
      if (sourceMessages.length > maxCloneMessages) {
        throw new BadRequestException(
          ErrorCode.CHAT_BRANCH_INVALID,
          `Conversation exceeds the ${maxCloneMessages} message sharing limit`,
        );
      }
      return this.createPublicShare(userId, conversation, data, sourceMessages);
    }
    const emailPreviewMessages = await this.shareStore.listSnapshotMessages(conversation.id, 40);
    return this.createPrivateShare(userId, conversation, data, emailPreviewMessages);
  }

  private async createPublicShare(
    userId: string,
    conversation: ShareSourceConversationRecord,
    data: CreateShareData,
    sourceMessages: EmbeddedMessage[],
  ): Promise<ShareResponse> {
    const messages = sanitizePublicShareMessages(
      sourceMessages,
    );
    const expiryDays =
      data.expiresInDays || this.configService.get<number>('conversation.shareExpiryDays', 30);
    const shared = await this.shareStore.createPublic({
      originalConversationId: conversation.id,
      sharedBy: userId,
      title: data.title || conversation.title,
      messages,
      accessToken: randomUUID().replaceAll('-', ''),
      expiresAt: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000),
    });
    this.logger.log('Public share created', {
      shareId: shared.id,
      conversationId: conversation.id,
      userId,
    });
    return this.mapToResponse(shared);
  }

  private async createPrivateShare(
    userId: string,
    conversation: ShareSourceConversationRecord,
    data: CreateShareData,
    sourceMessages: EmbeddedMessage[],
  ): Promise<ShareResponse> {
    const recipientEmails = data.recipientEmails || [];
    if (!recipientEmails.length) {
      throw new BadRequestException(ErrorCode.CHAT_BRANCH_INVALID, 'At least one recipient email is required');
    }
    const recipients = await Promise.all(recipientEmails.map(async (email) => ({
      email,
      user: await this.userService.findByEmail(email),
    })));
    const notFound: string[] = [];
    const invalid: string[] = [];
    const existingMemberIds = new Set(conversation.memberIds);
    const selectedRecipientIds = new Set<string>();
    const accepted: Array<{ email: string; userId: string }> = [];
    for (const { email, user } of recipients) {
      if (!user) {
        notFound.push(email);
        continue;
      }
      const recipientId = user._id.toString();
      if (
        recipientId === userId ||
        existingMemberIds.has(recipientId) ||
        selectedRecipientIds.has(recipientId)
      ) {
        invalid.push(email);
        continue;
      }
      selectedRecipientIds.add(recipientId);
      accepted.push({ email, userId: recipientId });
    }
    if (!accepted.length) {
      throw new BadRequestException(
        ErrorCode.CHAT_BRANCH_INVALID,
        'No eligible registered recipients were selected',
      );
    }

    let shared: SharedConversationRecord | undefined;
    let addedMemberIds: string[] = [];
    try {
      addedMemberIds = await this.shareStore.addConversationMembers(
        conversation.id,
        accepted.map(({ userId: recipientId }) => recipientId),
        new Date(),
      );
      const addedIdSet = new Set(addedMemberIds);
      const grantedRecipients = accepted.filter(({ userId: recipientId, email }) => {
        if (addedIdSet.has(recipientId)) return true;
        invalid.push(email);
        return false;
      });
      if (!grantedRecipients.length) {
        throw new BadRequestException(
          ErrorCode.CHAT_BRANCH_INVALID,
          'No eligible registered recipients were selected',
        );
      }
      shared = await this.shareStore.createPrivate({
        originalConversationId: conversation.id,
        sharedBy: userId,
        title: data.title || conversation.title,
        recipientEmails: grantedRecipients.map(({ email }) => email),
        recipientUserIds: grantedRecipients.map(({ userId: recipientId }) => recipientId),
        forkedConversationIds: [],
      });

      const sharedWorkspaceCount = data.shareWorkspaces
        ? await this.shareReferencedWorkspaces(userId, conversation.workspaceIds, grantedRecipients)
        : 0;
      const frontBase = this.configService.get<string>('app.frontendUrl', 'http://localhost:5173').replace(/\/$/, '');
      try {
        const emailResult = await this.emailService.sendBulk({
          emails: grantedRecipients.map(({ email }) => {
            const body = buildShareEmailBody(
              data.title || conversation.title,
              `${frontBase}/#/conversation/${conversation.id}`,
              sourceMessages,
            );
            return {
              to: email,
              subject: `${data.title || conversation.title} has been shared with you`,
              text: body.text,
              html: body.html,
            };
          }),
          stopOnError: false,
        });
        if (emailResult.failed > 0) {
          this.logger.warn('Failed to send one or more conversation share emails', {
            conversationId: conversation.id,
            failedCount: emailResult.failed,
          });
        }
      } catch (error) {
        this.logger.warn('Failed to send conversation share emails', {
          conversationId: conversation.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      this.logger.log('Private share created', {
        shareId: shared.id,
        conversationId: conversation.id,
        userId,
        recipientCount: grantedRecipients.length,
        sharedWorkspaceCount,
      });
      return {
        ...this.mapToResponse(shared),
        notFound,
        invalid,
        sharedWorkspaceCount,
      };
    } catch (error) {
      try {
        await this.shareStore.removeConversationMembers(
          conversation.id,
          addedMemberIds,
        );
      } catch (cleanupError) {
        this.logger.error('Failed to remove conversation members during share rollback', {
          conversationId: conversation.id,
          error: String(cleanupError),
        });
      }
      if (shared) await this.shareStore.markRevoked(shared.id);
      throw error;
    }
  }

  private async shareReferencedWorkspaces(
    ownerId: string,
    workspaceIds: string[],
    recipients: Array<{ email: string; userId: string }>,
  ): Promise<number> {
    let sharedCount = 0;
    for (const workspaceId of workspaceIds) {
      try {
        const workspace = await this.workspaceService.findById(workspaceId);
        if (
          workspace.createdBy !== ownerId ||
          workspace.isSystem ||
          workspace.isPublic
        ) {
          continue;
        }
        const needsAccess = (
          await Promise.all(
            recipients.map(async (recipient) => ({
              ...recipient,
              hasAccess: await this.workspaceShareService.hasAccess(recipient.userId, workspaceId),
            })),
          )
        ).filter((recipient) => !recipient.hasAccess);
        if (!needsAccess.length) continue;
        const result = await this.workspaceShareService.share(workspaceId, ownerId, {
          shares: needsAccess.map(({ email }) => ({ email, permission: 'read' })),
        });
        sharedCount += result.shared.length;
      } catch (error) {
        this.logger.warn('Failed to share a referenced workspace', {
          workspaceId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    return sharedCount;
  }

  async getSharesForConversation(conversationId: string, userId: string): Promise<ShareResponse[]> {
    const conversation = await this.shareStore.findSourceConversation(conversationId);
    if (!conversation) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Conversation not found');
    }
    if (conversation.createdBy !== userId) {
      throw new ForbiddenException(
        ErrorCode.CHAT_SHARE_FORBIDDEN,
        'Only the conversation owner can view its shares',
      );
    }
    const shares = await this.shareStore.listForConversation(conversationId);
    return shares.map((share) => this.mapToResponse(share));
  }

  async revokeShare(shareId: string, userId: string): Promise<void> {
    const share = await this.shareStore.findById(shareId);
    if (!share) {
      throw new NotFoundException(ErrorCode.CHAT_SHARE_NOT_FOUND, 'Share not found');
    }
    if (share.sharedBy !== userId) {
      throw new ForbiddenException(
        ErrorCode.CHAT_SHARE_FORBIDDEN,
        'You do not have access to this share',
      );
    }
    if (share.shareType === 'private' && share.recipientUserIds?.length) {
      await this.shareStore.removeConversationMembers(
        share.originalConversationId,
        share.recipientUserIds,
      );
    }
    await this.shareStore.markRevoked(shareId);
    this.logger.log('Share revoked', { shareId, userId });
  }

  async viewPublicShare(accessToken: string): Promise<PublicShareViewResponse> {
    const share = await this.shareStore.findPublicByToken(accessToken);
    if (!share) {
      throw new NotFoundException(ErrorCode.CHAT_SHARE_NOT_FOUND, 'Shared conversation not found');
    }
    if (share.isRevoked) {
      throw new ForbiddenException(
        ErrorCode.CHAT_SHARE_REVOKED,
        'This shared conversation has been revoked',
      );
    }
    if (share.expiresAt && share.expiresAt < new Date()) {
      throw new ForbiddenException(
        ErrorCode.CHAT_SHARE_EXPIRED,
        'This shared conversation link has expired',
      );
    }
    const viewCount = await this.shareStore.incrementViewCount(share.id);
    return {
      id: share.id,
      title: share.title,
      sharedBy: share.sharedBy,
      messages: sanitizePublicShareMessages(share.messages || []),
      viewCount,
      createdAt: share.createdAt.toISOString(),
    };
  }

  private mapToResponse(share: SharedConversationRecord): ShareResponse {
    return {
      id: share.id,
      originalConversationId: share.originalConversationId,
      sharedBy: share.sharedBy,
      shareType: share.shareType,
      title: share.title,
      accessToken: share.accessToken,
      recipientEmails: share.recipientEmails,
      forkedConversationIds: share.forkedConversationIds,
      expiresAt: share.expiresAt?.toISOString(),
      viewCount: share.viewCount,
      isRevoked: share.isRevoked,
      createdAt: share.createdAt.toISOString(),
      updatedAt: share.updatedAt.toISOString(),
    };
  }
}
