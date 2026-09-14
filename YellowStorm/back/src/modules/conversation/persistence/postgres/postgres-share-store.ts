import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { EmbeddedMessage } from '../../interfaces/share.interface';
import { newOwnedId } from '../owned-id';
import type {
  SharedConversationRecord,
  ShareSourceConversationRecord,
  ShareStore,
} from '../share-store';
import { ConversationCloneLimitError } from '../share-store';

@Injectable()
export class PostgresShareStore implements ShareStore {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  async findSourceConversation(id: string): Promise<ShareSourceConversationRecord | null> {
    const [row] = await this.db
      .select({
        id: schema.conversations.id,
        title: schema.conversations.title,
        createdBy: schema.conversations.createdBy,
        workspaceIds: sql<string[]>`COALESCE((SELECT array_agg(cw.workspace_id ORDER BY cw.position) FROM conversation.conversation_workspaces cw WHERE cw.conversation_id = ${schema.conversations.id}), ARRAY[]::bpchar[])`,
        memberIds: sql<string[]>`COALESCE((SELECT array_agg(gm.user_id ORDER BY gm.position) FROM conversation.conversation_group_members gm WHERE gm.conversation_id = ${schema.conversations.id}), ARRAY[]::bpchar[])`,
        runtimeMode: schema.conversations.runtimeMode,
        messageCount: schema.conversations.messageCount,
        lastMessageAt: schema.conversations.lastMessageAt,
      })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, id))
      .limit(1);
    return row
      ? {
          id: row.id.trim(),
          title: row.title,
          createdBy: row.createdBy.trim(),
          workspaceIds: row.workspaceIds.map((value) => value.trim()),
          memberIds: row.memberIds.map((value) => value.trim()),
          runtimeMode: row.runtimeMode,
          messageCount: row.messageCount,
          lastMessageAt: row.lastMessageAt ?? undefined,
        }
      : null;
  }

  async listSnapshotMessages(conversationId: string, limit: number): Promise<EmbeddedMessage[]> {
    const rows = await this.db
      .select({
        conversationType: schema.messages.conversationType,
        content: schema.messages.content,
        components: schema.messages.components,
        modelId: schema.messages.modelId,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .orderBy(schema.messages.createdAt, schema.messages.id)
      .limit(limit);
    return rows.map((row) => ({
      conversationType: row.conversationType as 'user' | 'ai',
      content: row.content ?? undefined,
      components: row.components as EmbeddedMessage['components'],
      modelId: row.modelId ?? undefined,
      createdAt: row.createdAt,
    }));
  }

  async createPublic(input: {
    originalConversationId: string;
    sharedBy: string;
    title: string;
    messages: EmbeddedMessage[];
    accessToken: string;
    expiresAt: Date;
  }): Promise<SharedConversationRecord> {
    const [row] = await this.db
      .insert(schema.sharedConversations)
      .values({ id: newOwnedId(), ...input, shareType: 'public', viewCount: 0, isRevoked: false })
      .returning();
    return this.map(row);
  }

  async forkConversation(input: {
    original: ShareSourceConversationRecord;
    ownerId: string;
    sharedBy: string;
    maxMessages: number;
  }): Promise<string> {
    return this.db.transaction(async (tx) => {
      const conversationId = newOwnedId();
      const maxCloneMessages = input.maxMessages;
      const sourceMessages = await tx
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, input.original.id))
        .orderBy(schema.messages.createdAt, schema.messages.id)
        .limit(maxCloneMessages + 1);
      if (sourceMessages.length > maxCloneMessages) {
        throw new ConversationCloneLimitError(
          `Conversation exceeds the ${maxCloneMessages} message sharing limit`,
        );
      }
      const ids = new Map(sourceMessages.map((message) => [message.id.trim(), newOwnedId()]));
      const now = new Date();
      await tx
        .insert(schema.conversations)
        .values({
          id: conversationId,
          title: input.original.title,
          createdBy: input.ownerId,
          messageCount: sourceMessages.length,
          isShared: true,
          sharedFrom: input.sharedBy,
          lastMessageAt: input.original.lastMessageAt ?? null,
          isFirstMessage: sourceMessages.length === 0,
          createdAt: now,
          updatedAt: now,
        });
      if (sourceMessages.length) {
        const messages = sourceMessages.map((message) => ({
            ...message,
            id: ids.get(message.id.trim())!,
            conversationId,
            senderId: null,
            parentMessageId: message.parentMessageId
              ? (ids.get(message.parentMessageId.trim()) ?? null)
              : null,
            questionMessageId: message.questionMessageId
              ? (ids.get(message.questionMessageId.trim()) ?? null)
              : null,
            answerMessageId: message.answerMessageId
              ? (ids.get(message.answerMessageId.trim()) ?? null)
              : null,
            feedback: null,
            feedbackAt: null,
            isStreaming: false,
            streamExecutionLeaseId: null,
            streamExecutionLeaseExpiresAt: null,
            createdAt: message.createdAt,
            updatedAt: message.updatedAt,
          }));
        const batchSize = this.configService?.get<number>('conversation.cloneInsertBatchSize', 250) ?? 250;
        for (let offset = 0; offset < messages.length; offset += batchSize) {
          await tx.insert(schema.messages).values(messages.slice(offset, offset + batchSize));
        }
      }
      return conversationId;
    });
  }

  async deleteForkConversations(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.db
      .delete(schema.conversations)
      .where(inArray(schema.conversations.id, ids));
  }

  async addConversationMembers(
    conversationId: string,
    userIds: string[],
    joinedAt: Date,
  ): Promise<string[]> {
    if (!userIds.length) return [];
    return this.db.transaction(async (tx) => {
      await tx
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(eq(schema.conversations.id, conversationId))
        .for('update');
      const existing = await tx
        .select({ userId: schema.conversationGroupMembers.userId })
        .from(schema.conversationGroupMembers)
        .where(
          and(
            eq(schema.conversationGroupMembers.conversationId, conversationId),
            inArray(schema.conversationGroupMembers.userId, userIds),
          ),
        );
      const existingIds = new Set(existing.map((member) => member.userId.trim()));
      const additions = userIds.filter((userId) => !existingIds.has(userId));
      if (!additions.length) return [];
      const [position] = await tx
        .select({
          value: sql<number>`COALESCE(max(${schema.conversationGroupMembers.position}), -1)::int + 1`,
        })
        .from(schema.conversationGroupMembers)
        .where(eq(schema.conversationGroupMembers.conversationId, conversationId));
      await tx.insert(schema.conversationGroupMembers).values(
        additions.map((userId, index) => ({
          conversationId,
          userId,
          position: (position?.value ?? 0) + index,
          joinedAt,
          status: 'member' as const,
        })),
      );
      await tx
        .update(schema.conversations)
        .set({ isGroup: true, isShared: true, updatedAt: joinedAt })
        .where(eq(schema.conversations.id, conversationId));
      return additions;
    });
  }

  async removeConversationMembers(conversationId: string, userIds: string[]): Promise<void> {
    if (!userIds.length) return;
    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.conversationMemberMentions)
        .where(
          and(
            eq(schema.conversationMemberMentions.conversationId, conversationId),
            inArray(schema.conversationMemberMentions.userId, userIds),
          ),
        );
      await tx
        .delete(schema.conversationGroupMembers)
        .where(
          and(
            eq(schema.conversationGroupMembers.conversationId, conversationId),
            inArray(schema.conversationGroupMembers.userId, userIds),
          ),
        );
    });
  }

  async createPrivate(input: {
    originalConversationId: string;
    sharedBy: string;
    title: string;
    recipientEmails: string[];
    recipientUserIds?: string[];
    forkedConversationIds: string[];
  }): Promise<SharedConversationRecord> {
    const [row] = await this.db
      .insert(schema.sharedConversations)
      .values({ id: newOwnedId(), ...input, shareType: 'private', viewCount: 0, isRevoked: false })
      .returning();
    return this.map(row);
  }

  async listForConversation(conversationId: string): Promise<SharedConversationRecord[]> {
    return (
      await this.db
        .select()
        .from(schema.sharedConversations)
        .where(eq(schema.sharedConversations.originalConversationId, conversationId))
        .orderBy(desc(schema.sharedConversations.createdAt))
    ).map((row) => this.map(row));
  }

  async findById(shareId: string): Promise<SharedConversationRecord | null> {
    const [row] = await this.db
      .select()
      .from(schema.sharedConversations)
      .where(eq(schema.sharedConversations.id, shareId))
      .limit(1);
    return row ? this.map(row) : null;
  }

  async markRevoked(shareId: string): Promise<void> {
    await this.db
      .update(schema.sharedConversations)
      .set({ isRevoked: true, updatedAt: new Date() })
      .where(eq(schema.sharedConversations.id, shareId));
  }

  async findPublicByToken(accessToken: string): Promise<SharedConversationRecord | null> {
    const [row] = await this.db
      .select()
      .from(schema.sharedConversations)
      .where(
        and(
          eq(schema.sharedConversations.accessToken, accessToken),
          eq(schema.sharedConversations.shareType, 'public'),
        ),
      )
      .limit(1);
    return row ? this.map(row) : null;
  }

  async incrementViewCount(shareId: string): Promise<number> {
    const [row] = await this.db
      .update(schema.sharedConversations)
      .set({ viewCount: sql`${schema.sharedConversations.viewCount} + 1`, updatedAt: new Date() })
      .where(eq(schema.sharedConversations.id, shareId))
      .returning({ viewCount: schema.sharedConversations.viewCount });
    return row?.viewCount ?? 0;
  }

  private map(row: typeof schema.sharedConversations.$inferSelect): SharedConversationRecord {
    return {
      id: row.id.trim(),
      originalConversationId: row.originalConversationId.trim(),
      sharedBy: row.sharedBy.trim(),
      shareType: row.shareType as SharedConversationRecord['shareType'],
      title: row.title,
      messages: row.messages as EmbeddedMessage[] | undefined,
      accessToken: row.accessToken ?? undefined,
      recipientEmails: row.recipientEmails ?? undefined,
      recipientUserIds: row.recipientUserIds?.map((id) => id.trim()),
      forkedConversationIds: row.forkedConversationIds?.map((id) => id.trim()),
      expiresAt: row.expiresAt ?? undefined,
      viewCount: row.viewCount,
      isRevoked: row.isRevoked,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
