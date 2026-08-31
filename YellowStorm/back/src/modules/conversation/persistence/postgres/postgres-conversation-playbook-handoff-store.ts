import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { TrustedConversationPlaybookContextV1 } from '../../interfaces/conversation-playbook-handoff.interface';
import type {
  ConversationPlaybookHandoffRecord,
  ConversationPlaybookHandoffStore,
  PreparedHandoffInput,
} from '../conversation-playbook-handoff-store';

@Injectable()
export class PostgresConversationPlaybookHandoffStore implements ConversationPlaybookHandoffStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async findByCreationRequest(ownerId: string, creationRequestId: string) {
    return this.find(
      and(
        eq(schema.conversationPlaybookHandoffs.ownerId, ownerId),
        eq(schema.conversationPlaybookHandoffs.creationRequestId, creationRequestId),
      ),
    );
  }

  async createPrepared(
    input: PreparedHandoffInput,
  ): Promise<{ record: ConversationPlaybookHandoffRecord; created: boolean }> {
    const now = new Date();
    const rows = await this.db
      .insert(schema.conversationPlaybookHandoffs)
      .values({ ...input, status: 'prepared', createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .returning();
    if (rows[0]) return { record: this.map(rows[0]), created: true };
    const raced = await this.findByCreationRequest(input.ownerId, input.creationRequestId);
    if (!raced) throw new Error('Handoff conflict could not be resolved');
    return { record: raced, created: false };
  }

  async tryBindPrepared(input: {
    handoffId: string;
    ownerId: string;
    platformConversationId: string;
    turnRequestId: string;
    promptHash: string;
    boundAt: Date;
  }) {
    const [row] = await this.db
      .update(schema.conversationPlaybookHandoffs)
      .set({
        status: 'bound',
        boundTurnRequestId: input.turnRequestId,
        boundPromptHash: input.promptHash,
        boundAt: input.boundAt,
        updatedAt: input.boundAt,
      })
      .where(
        and(
          eq(schema.conversationPlaybookHandoffs.handoffId, input.handoffId),
          eq(schema.conversationPlaybookHandoffs.ownerId, input.ownerId),
          eq(
            schema.conversationPlaybookHandoffs.platformConversationId,
            input.platformConversationId,
          ),
          eq(schema.conversationPlaybookHandoffs.status, 'prepared'),
          gt(schema.conversationPlaybookHandoffs.expiresAt, input.boundAt),
        ),
      )
      .returning();
    return row ? this.map(row) : null;
  }

  async findOwned(handoffId: string, ownerId: string) {
    return this.find(
      and(
        eq(schema.conversationPlaybookHandoffs.handoffId, handoffId),
        eq(schema.conversationPlaybookHandoffs.ownerId, ownerId),
      ),
    );
  }

  async attachUserMessageIfBound(
    handoffId: string,
    ownerId: string,
    userMessageId: string,
  ): Promise<void> {
    await this.db
      .update(schema.conversationPlaybookHandoffs)
      .set({ boundUserMessageId: userMessageId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.conversationPlaybookHandoffs.handoffId, handoffId),
          eq(schema.conversationPlaybookHandoffs.ownerId, ownerId),
          eq(schema.conversationPlaybookHandoffs.status, 'bound'),
        ),
      );
  }

  async findForConsumption(input: {
    handoffId: string;
    ownerId: string;
    platformConversationId: string;
    turnRequestId: string;
    userMessageId: string;
  }) {
    return this.find(
      and(
        eq(schema.conversationPlaybookHandoffs.handoffId, input.handoffId),
        eq(schema.conversationPlaybookHandoffs.ownerId, input.ownerId),
        eq(
          schema.conversationPlaybookHandoffs.platformConversationId,
          input.platformConversationId,
        ),
        eq(schema.conversationPlaybookHandoffs.boundTurnRequestId, input.turnRequestId),
        eq(schema.conversationPlaybookHandoffs.boundUserMessageId, input.userMessageId),
        inArray(schema.conversationPlaybookHandoffs.status, ['bound', 'consumed']),
      ),
    );
  }

  async markConsumedIfBound(id: string, consumedAt: Date): Promise<void> {
    await this.db
      .update(schema.conversationPlaybookHandoffs)
      .set({ status: 'consumed', consumedAt, updatedAt: consumedAt })
      .where(
        and(
          eq(schema.conversationPlaybookHandoffs.id, id),
          eq(schema.conversationPlaybookHandoffs.status, 'bound'),
        ),
      );
  }

  private async find(where: ReturnType<typeof eq> | ReturnType<typeof and>) {
    const [row] = await this.db
      .select()
      .from(schema.conversationPlaybookHandoffs)
      .where(where)
      .limit(1);
    return row ? this.map(row) : null;
  }

  private map(
    row: typeof schema.conversationPlaybookHandoffs.$inferSelect,
  ): ConversationPlaybookHandoffRecord {
    return {
      id: row.id.trim(),
      contractVersion: 1,
      handoffId: row.handoffId,
      ownerId: row.ownerId.trim(),
      sourceConversationId: row.sourceConversationId.trim(),
      targetMessageId: row.targetMessageId.trim(),
      displayedAnswerVersion: row.displayedAnswerVersion,
      creationRequestId: row.creationRequestId,
      creationRequestFingerprint: row.creationRequestFingerprint,
      clientBranchSelectionFingerprint: row.clientBranchSelectionFingerprint,
      canonicalPathFingerprint: row.canonicalPathFingerprint,
      contextFingerprint: row.contextFingerprint,
      canonicalSelectedAnswerIds: row.canonicalSelectedAnswerIds.map((id) => id.trim()),
      platformConversationId: row.platformConversationId.trim(),
      context: row.context as TrustedConversationPlaybookContextV1,
      candidateBindings:
        row.candidateBindings as ConversationPlaybookHandoffRecord['candidateBindings'],
      defaultWorkspaceIds: row.defaultWorkspaceIds,
      status: row.status as ConversationPlaybookHandoffRecord['status'],
      boundTurnRequestId: row.boundTurnRequestId ?? undefined,
      boundPromptHash: row.boundPromptHash ?? undefined,
      boundUserMessageId: row.boundUserMessageId?.trim(),
      assistantRequestId: row.assistantRequestId ?? undefined,
      preparedAt: row.preparedAt,
      boundAt: row.boundAt ?? undefined,
      consumedAt: row.consumedAt ?? undefined,
      expiresAt: row.expiresAt,
    };
  }
}
