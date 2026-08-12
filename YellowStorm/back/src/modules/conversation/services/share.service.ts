import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { nanoid } from 'nanoid';
import { SharedConversation, SharedConversationDocument } from '../schemas/shared-conversation.schema';
import { Conversation, ConversationDocument } from '../schemas/conversation.schema';
import { Message, MessageDocument } from '../schemas/message.schema';
import {
  CreateShareData,
  ShareResponse,
  PublicShareViewResponse,
  EmbeddedMessage,
} from '../interfaces/share.interface';
import { MessageComponent } from '../interfaces/message.interface';
import { LoggerService } from '../../logger';
import { NotFoundException, ForbiddenException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

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
  'artifact',
  'citation',
  'choice',
]);

function sanitizePublicShareMessages(messages: readonly EmbeddedMessage[]): EmbeddedMessage[] {
  return messages.map(({ components, content, ...message }) => ({
    ...message,
    // AI content can aggregate private reasoning. Public AI output must use
    // explicitly typed components, while user text remains shareable.
    ...(message.conversationType === 'user' && content ? { content } : {}),
    ...(components ? {
      components: components
        .filter((component) => publicShareComponentTypes.has(component.type))
        .map((component) => component.type === 'task'
          ? { ...component, data: { ...component.data, items: [] } }
          : component),
    } : {}),
  }));
}

@Injectable()
export class ShareService {
  constructor(
    @InjectModel(SharedConversation.name)
    private readonly sharedConversationModel: Model<SharedConversationDocument>,
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('ShareService');
  }

  async createShare(
    userId: string,
    data: CreateShareData,
  ): Promise<ShareResponse> {
    const conversation = await this.conversationModel.findById(data.conversationId);

    if (!conversation) {
      throw new NotFoundException(
        ErrorCode.CHAT_NOT_FOUND,
        'Conversation not found',
      );
    }
    if (conversation.runtimeMode === 'governed') {
      throw new ForbiddenException(ErrorCode.CHAT_FORBIDDEN, 'Governed conversations cannot be shared');
    }

    if (data.shareType === 'public') {
      return this.createPublicShare(userId, conversation, data);
    } else {
      return this.createPrivateShare(userId, conversation, data);
    }
  }

  private async createPublicShare(
    userId: string,
    conversation: ConversationDocument,
    data: CreateShareData,
  ): Promise<ShareResponse> {
    // Snapshot current messages
    const messages = await this.messageModel
      .find({ conversationId: conversation._id })
      .sort({ createdAt: 1 })
      .exec();

    const embeddedMessages = sanitizePublicShareMessages(messages.map((msg) => ({
      conversationType: msg.conversationType as 'user' | 'ai',
      content: msg.content,
      components: msg.components as unknown as MessageComponent[],
      modelId: msg.modelId,
      createdAt: msg.createdAt,
    })));

    const accessToken = nanoid(32);

    const expiryDays = data.expiresInDays ||
      this.configService.get<number>('conversation.shareExpiryDays', 30);
    const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

    const shared = await this.sharedConversationModel.create({
      originalConversationId: conversation._id,
      sharedBy: new Types.ObjectId(userId),
      shareType: 'public',
      title: data.title || conversation.title,
      messages: embeddedMessages,
      accessToken,
      expiresAt,
      viewCount: 0,
      isRevoked: false,
    });

    this.logger.log('Public share created', {
      shareId: shared._id,
      conversationId: conversation._id.toString(),
      userId,
    });

    return this.mapToResponse(shared);
  }

  private async createPrivateShare(
    userId: string,
    conversation: ConversationDocument,
    data: CreateShareData,
  ): Promise<ShareResponse> {
    const recipientEmails = data.recipientEmails || [];
    const forkedConversationIds: Types.ObjectId[] = [];

    // Fork conversation for each recipient
    for (const email of recipientEmails) {
      const forkedId = await this.forkConversation(
        conversation,
        userId,
        email,
      );
      if (forkedId) {
        forkedConversationIds.push(new Types.ObjectId(forkedId));
      }
    }

    const shared = await this.sharedConversationModel.create({
      originalConversationId: conversation._id,
      sharedBy: new Types.ObjectId(userId),
      shareType: 'private',
      title: data.title || conversation.title,
      recipientEmails,
      forkedConversationIds,
      isRevoked: false,
      viewCount: 0,
    });

    this.logger.log('Private share created', {
      shareId: shared._id,
      conversationId: conversation._id.toString(),
      userId,
      recipientCount: recipientEmails.length,
    });

    return this.mapToResponse(shared);
  }

  private async forkConversation(
    original: ConversationDocument,
    sharedByUserId: string,
    _recipientEmail: string,
  ): Promise<string | null> {
    try {
      // Create new conversation for recipient
      // Note: In a full implementation, we'd look up the user by email
      // For now, create the forked conversation owned by the sharer
      // The recipient lookup/invite logic would be added when email module integration is done
      const forked = await this.conversationModel.create({
        title: original.title,
        createdBy: new Types.ObjectId(sharedByUserId),
        workspaces: [],
        messages: [],
        messageCount: 0,
        isArchived: false,
        isShared: true,
        sharedFrom: new Types.ObjectId(sharedByUserId),
      });

      // Copy all messages
      const originalMessages = await this.messageModel
        .find({ conversationId: original._id })
        .sort({ createdAt: 1 })
        .exec();

      const messageIdMap = new Map<string, Types.ObjectId>();

      for (const msg of originalMessages) {
        const newMessage = await this.messageModel.create({
          conversationId: forked._id,
          conversationType: msg.conversationType,
          content: msg.content,
          components: msg.components,
          attachedFileIds: msg.attachedFileIds,
          modelId: msg.modelId,
          webSearchEnabled: msg.webSearchEnabled,
          feedback: undefined,
          isStreaming: false,
          isComplete: msg.isComplete,
          inputTokens: msg.inputTokens,
          outputTokens: msg.outputTokens,
          durationMs: msg.durationMs,
        });

        messageIdMap.set(msg._id.toString(), newMessage._id);
      }

      // Link question/answer references in forked messages
      for (const msg of originalMessages) {
        if (msg.questionMessageId || msg.answerMessageId) {
          const newMsgId = messageIdMap.get(msg._id.toString());
          if (newMsgId) {
            const update: Record<string, unknown> = {};
            if (msg.questionMessageId) {
              const newQuestionId = messageIdMap.get(msg.questionMessageId.toString());
              if (newQuestionId) update.questionMessageId = newQuestionId;
            }
            if (msg.answerMessageId) {
              const newAnswerId = messageIdMap.get(msg.answerMessageId.toString());
              if (newAnswerId) update.answerMessageId = newAnswerId;
            }
            if (Object.keys(update).length > 0) {
              await this.messageModel.findByIdAndUpdate(newMsgId, update);
            }
          }
        }
      }

      // Update forked conversation with message refs
      forked.messages = Array.from(messageIdMap.values());
      forked.messageCount = originalMessages.length;
      forked.lastMessageAt = original.lastMessageAt;
      await forked.save();

      return forked._id.toString();
    } catch (error) {
      this.logger.error('Failed to fork conversation', {
        originalId: original._id.toString(),
        error: (error as Error).message,
      });
      return null;
    }
  }

  async getSharesForConversation(
    conversationId: string,
  ): Promise<ShareResponse[]> {
    const shares = await this.sharedConversationModel
      .find({ originalConversationId: new Types.ObjectId(conversationId) })
      .sort({ createdAt: -1 })
      .exec();

    return shares.map((s) => this.mapToResponse(s));
  }

  async revokeShare(shareId: string, userId: string): Promise<void> {
    const share = await this.sharedConversationModel.findById(shareId);

    if (!share) {
      throw new NotFoundException(
        ErrorCode.CHAT_SHARE_NOT_FOUND,
        'Share not found',
      );
    }

    if (share.sharedBy.toString() !== userId) {
      throw new ForbiddenException(
        ErrorCode.CHAT_SHARE_FORBIDDEN,
        'You do not have access to this share',
      );
    }

    share.isRevoked = true;
    await share.save();

    this.logger.log('Share revoked', { shareId, userId });
  }

  async viewPublicShare(accessToken: string): Promise<PublicShareViewResponse> {
    const share = await this.sharedConversationModel.findOne({
      accessToken,
      shareType: 'public',
    });

    if (!share) {
      throw new NotFoundException(
        ErrorCode.CHAT_SHARE_NOT_FOUND,
        'Shared conversation not found',
      );
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

    // Increment view count
    share.viewCount += 1;
    await share.save();

    return {
      id: share._id.toString(),
      title: share.title,
      sharedBy: share.sharedBy.toString(),
      // Legacy snapshots may contain internal components, so redact at read time
      // as well as when creating a new public-share snapshot.
      messages: sanitizePublicShareMessages((share.messages || []) as unknown as EmbeddedMessage[]),
      viewCount: share.viewCount,
      createdAt: share.createdAt.toISOString(),
    };
  }

  private mapToResponse(share: SharedConversationDocument): ShareResponse {
    return {
      id: share._id.toString(),
      originalConversationId: share.originalConversationId.toString(),
      sharedBy: share.sharedBy.toString(),
      shareType: share.shareType as 'public' | 'private',
      title: share.title,
      accessToken: share.accessToken,
      recipientEmails: share.recipientEmails,
      forkedConversationIds: share.forkedConversationIds?.map((id) => id.toString()),
      expiresAt: share.expiresAt?.toISOString(),
      viewCount: share.viewCount,
      isRevoked: share.isRevoked,
      createdAt: share.createdAt.toISOString(),
      updatedAt: share.updatedAt.toISOString(),
    };
  }
}
