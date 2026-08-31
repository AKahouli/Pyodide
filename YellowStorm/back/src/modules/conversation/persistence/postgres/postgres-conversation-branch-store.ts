import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { newOwnedId } from '../owned-id';
import type {
  BranchStateRecord,
  ConversationBranchStore,
} from '../conversation-branch-store';

@Injectable()
export class PostgresConversationBranchStore implements ConversationBranchStore {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  async findByRequest(ownerId: string, requestId: string): Promise<BranchStateRecord | null> {
    const [row] = await this.db
      .select()
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.createdBy, ownerId),
          eq(schema.conversations.branchRequestId, requestId),
        ),
      )
      .limit(1);
    return row ? this.map(row) : null;
  }

  async createPending(input: Parameters<ConversationBranchStore['createPending']>[0]) {
    return this.db.transaction(async (tx) => {
      const id = newOwnedId();
      const idMap = new Map(input.path.map((message) => [message.id, newOwnedId()]));
      const now = Date.now();
      const messages = input.path.map((message, index) => ({
        id: idMap.get(message.id)!,
        conversationId: id,
        senderId: message.conversationType === 'user' ? input.userId : null,
        parentMessageId: message.parentMessageId
          ? (idMap.get(message.parentMessageId) ?? null)
          : null,
        conversationType: message.conversationType,
        content: message.content,
        components: message.components,
        attachedFileIds: message.attachedFileIds,
        agentIds: message.agentIds,
        memberIds: message.memberIds,
        modelId: message.modelId,
        reasoningEffort: message.reasoningEffort,
        webSearchEnabled: message.webSearchEnabled,
        questionMessageId: message.questionMessageId
          ? (idMap.get(message.questionMessageId) ?? null)
          : null,
        answerMessageId: message.answerMessageId
          ? (idMap.get(message.answerMessageId) ?? null)
          : null,
        isEdited: message.isEdited,
        editedAt: message.editedAt,
        isStreaming: false,
        isComplete: true,
        interaction: message.interaction
          ? {
              ...message.interaction,
              ...(typeof message.interaction.sourceMessageId === 'string' &&
              idMap.has(message.interaction.sourceMessageId)
                ? { sourceMessageId: idMap.get(message.interaction.sourceMessageId) }
                : {}),
            }
          : undefined,
        createdAt: new Date(now + index),
        updatedAt: new Date(now + index),
      }));
      for (const userMessage of messages.filter((message) => message.conversationType === 'user')) {
        userMessage.answerMessageId =
          messages.find((message) => message.questionMessageId === userMessage.id)?.id ?? null;
      }
      const lastMessageAt = messages.at(-1)?.createdAt ?? new Date();
      const [row] = await tx
        .insert(schema.conversations)
        .values({
          id,
          title: `${input.source.title.slice(0, 191)} · Branch`,
          createdBy: input.userId,
          projectId: input.source.projectId,
          lastMessageAt,
          messageCount: messages.length,
          isFirstMessage: false,
          initializationStatus: 'pending',
          branchRequestId: input.requestId,
          branchProvenance: {
            sourceConversationId: input.source.id,
            sourceTargetMessageId: input.targetMessageId,
            requestId: input.requestId,
            requestFingerprint: input.requestFingerprint,
            branchedBy: input.userId,
            branchedAt: new Date().toISOString(),
            selectedAnswerIds: input.selectedAnswerIds,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      const ordered = [
        [schema.conversationWorkspaces, input.source.workspaces],
        [schema.conversationSelectedSkills, input.source.selectedSkills],
        [schema.conversationTaggedAgents, input.source.taggedAgentIds],
      ] as const;
      for (const [table, values] of ordered) {
        if (values.length) {
          await tx
            .insert(table)
            .values(values.map((value, position) => ({ conversationId: id, position, value })));
        }
      }
      const batchSize = this.configService?.get<number>('conversation.cloneInsertBatchSize', 250) ?? 250;
      for (let offset = 0; offset < messages.length; offset += batchSize) {
        await tx.insert(schema.messages).values(messages.slice(offset, offset + batchSize));
      }
      return this.map(row);
    });
  }

  async claimSeed(id: string, attemptId: string): Promise<boolean> {
    return Boolean(
      (
        await this.db
          .update(schema.conversations)
          .set({ initializationStatus: 'seeding', branchSeedAttemptId: attemptId, updatedAt: new Date() })
          .where(
            and(
              eq(schema.conversations.id, id),
              eq(schema.conversations.initializationStatus, 'pending'),
            ),
          )
          .returning({ id: schema.conversations.id })
      )[0],
    );
  }

  async finalizeSeed(id: string, attemptId: string): Promise<boolean> {
    return Boolean(
      (
        await this.db
          .update(schema.conversations)
          .set({ initializationStatus: 'ready', branchSeedAttemptId: null, updatedAt: new Date() })
          .where(
            and(
              eq(schema.conversations.id, id),
              eq(schema.conversations.initializationStatus, 'seeding'),
              eq(schema.conversations.branchSeedAttemptId, attemptId),
            ),
          )
          .returning({ id: schema.conversations.id })
      )[0],
    );
  }

  async ownsSeed(id: string, attemptId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, id),
          eq(schema.conversations.initializationStatus, 'seeding'),
          eq(schema.conversations.branchSeedAttemptId, attemptId),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async markCleanup(id: string, attemptId?: string): Promise<boolean> {
    const conditions = [eq(schema.conversations.id, id)];
    if (attemptId) {
      conditions.push(eq(schema.conversations.initializationStatus, 'seeding'));
      conditions.push(eq(schema.conversations.branchSeedAttemptId, attemptId));
    }
    const rows = await this.db
      .update(schema.conversations)
      .set({ initializationStatus: 'cleanup_pending', branchSeedAttemptId: null, updatedAt: new Date() })
      .where(and(...conditions))
      .returning({ id: schema.conversations.id });
    return rows.length === 1;
  }

  async deleteCleanup(id: string): Promise<void> {
    await this.db
      .delete(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, id),
          eq(schema.conversations.initializationStatus, 'cleanup_pending'),
        ),
      );
  }

  async claimStale(cutoff: Date): Promise<BranchStateRecord[]> {
    return this.db.transaction(async (tx) => {
      const candidates = await tx
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(
          and(
            inArray(schema.conversations.initializationStatus, [
              'pending',
              'seeding',
              'cleanup_pending',
            ]),
            lt(schema.conversations.updatedAt, cutoff),
          ),
        )
        .for('update', { skipLocked: true });
      if (!candidates.length) return [];
      const rows = await tx
        .update(schema.conversations)
        .set({ initializationStatus: 'cleanup_pending', branchSeedAttemptId: null, updatedAt: new Date() })
        .where(inArray(schema.conversations.id, candidates.map((item) => item.id)))
        .returning();
      return rows.map((row) => this.map(row));
    });
  }

  private map(row: typeof schema.conversations.$inferSelect): BranchStateRecord {
    const provenance = row.branchProvenance as {
      sourceConversationId: string;
      sourceTargetMessageId: string;
      requestId: string;
      requestFingerprint: string;
    };
    return {
      id: row.id.trim(),
      createdBy: row.createdBy.trim(),
      initializationStatus: row.initializationStatus as BranchStateRecord['initializationStatus'],
      sourceConversationId: provenance.sourceConversationId,
      sourceTargetMessageId: provenance.sourceTargetMessageId,
      requestId: provenance.requestId,
      requestFingerprint: provenance.requestFingerprint,
    };
  }
}
