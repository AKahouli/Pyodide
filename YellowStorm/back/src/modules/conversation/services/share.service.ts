import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { nanoid } from 'nanoid';
import { ForbiddenException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { LoggerService } from '../../logger';
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
  ) {
    this.logger.setContext('ShareService');
  }

  async createShare(userId: string, data: CreateShareData): Promise<ShareResponse> {
    const conversation = await this.shareStore.findSourceConversation(data.conversationId);
    if (!conversation) {
      throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Conversation not found');
    }
    if (conversation.runtimeMode === 'governed') {
      throw new ForbiddenException(
        ErrorCode.CHAT_FORBIDDEN,
        'Governed conversations cannot be shared',
      );
    }
    return data.shareType === 'public'
      ? this.createPublicShare(userId, conversation, data)
      : this.createPrivateShare(userId, conversation, data);
  }

  private async createPublicShare(
    userId: string,
    conversation: ShareSourceConversationRecord,
    data: CreateShareData,
  ): Promise<ShareResponse> {
    const messages = sanitizePublicShareMessages(
      await this.shareStore.listSnapshotMessages(conversation.id),
    );
    const expiryDays =
      data.expiresInDays || this.configService.get<number>('conversation.shareExpiryDays', 30);
    const shared = await this.shareStore.createPublic({
      originalConversationId: conversation.id,
      sharedBy: userId,
      title: data.title || conversation.title,
      messages,
      accessToken: nanoid(32),
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
  ): Promise<ShareResponse> {
    const recipientEmails = data.recipientEmails || [];
    const forkedConversationIds: string[] = [];
    for (const _email of recipientEmails) {
      try {
        forkedConversationIds.push(
          await this.shareStore.forkConversation({ original: conversation, sharedBy: userId }),
        );
      } catch (error) {
        this.logger.error('Failed to fork conversation', {
          originalId: conversation.id,
          error: (error as Error).message,
        });
      }
    }
    const shared = await this.shareStore.createPrivate({
      originalConversationId: conversation.id,
      sharedBy: userId,
      title: data.title || conversation.title,
      recipientEmails,
      forkedConversationIds,
    });
    this.logger.log('Private share created', {
      shareId: shared.id,
      conversationId: conversation.id,
      userId,
      recipientCount: recipientEmails.length,
    });
    return this.mapToResponse(shared);
  }

  async getSharesForConversation(conversationId: string): Promise<ShareResponse[]> {
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
