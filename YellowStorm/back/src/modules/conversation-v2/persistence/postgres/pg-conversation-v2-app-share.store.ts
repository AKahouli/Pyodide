import { Inject } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId } from '@common/postgres';
import { isUniqueViolation } from '@common/postgres/errors';
import { resolveQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type {
  ConversationV2AppShareRecord,
  ConversationV2AppShareStore,
  ConversationV2AppShareUpsert,
} from '../conversation-v2-app-share.store';

type ShareRow = typeof schema.conversationV2AppShares.$inferSelect;

export class PgConversationV2AppShareStore implements ConversationV2AppShareStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): NodePgDatabase<typeof schema> {
    return resolveQueryable(this.db);
  }

  private static toRecord(row: ShareRow): ConversationV2AppShareRecord {
    return {
      id: row.id,
      sessionId: row.sessionId,
      ownerId: row.ownerId,
      recipientUserId: row.recipientUserId ?? null,
      recipientEmail: row.recipientEmail ?? null,
      title: row.title,
      deployedUrl: row.deployedUrl,
      lastDeployedAt: row.lastDeployedAt ?? null,
      includeConversation: row.includeConversation,
      inviteTokenHash: row.inviteTokenHash ?? null,
      inviteExpiresAt: row.inviteExpiresAt ?? null,
      inviteConsumedAt: row.inviteConsumedAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private patchFields(input: ConversationV2AppShareUpsert) {
    return {
      ownerId: normalizeObjectId(input.ownerId),
      title: input.title,
      deployedUrl: input.deployedUrl,
      lastDeployedAt: input.lastDeployedAt ?? null,
      includeConversation: input.includeConversation,
      recipientEmail: input.recipientEmail?.trim().toLowerCase() ?? null,
      inviteTokenHash: input.inviteTokenHash,
      inviteExpiresAt: input.inviteExpiresAt,
      inviteConsumedAt: input.inviteConsumedAt,
      updatedAt: new Date(),
    };
  }

  async upsertByRecipientUser(
    input: ConversationV2AppShareUpsert & { recipientUserId: string },
  ): Promise<ConversationV2AppShareRecord> {
    const sessionId = normalizeObjectId(input.sessionId);
    const recipientUserId = normalizeObjectId(input.recipientUserId);

    const updateExisting = async (): Promise<ConversationV2AppShareRecord | null> => {
      const [existing] = await this.q
        .select()
        .from(schema.conversationV2AppShares)
        .where(
          and(
            eq(schema.conversationV2AppShares.sessionId, sessionId),
            eq(schema.conversationV2AppShares.recipientUserId, recipientUserId),
          ),
        )
        .limit(1);
      if (!existing) return null;
      const [row] = await this.q
        .update(schema.conversationV2AppShares)
        .set(this.patchFields(input))
        .where(eq(schema.conversationV2AppShares.id, existing.id))
        .returning();
      return PgConversationV2AppShareStore.toRecord(row);
    };

    const updated = await updateExisting();
    if (updated) return updated;

    try {
      const now = new Date();
      const [row] = await this.q
        .insert(schema.conversationV2AppShares)
        .values({
          id: newObjectId(),
          sessionId,
          recipientUserId,
          ...this.patchFields(input),
          createdAt: now,
        })
        .returning();
      return PgConversationV2AppShareStore.toRecord(row);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const raced = await updateExisting();
      if (raced) return raced;
      throw err;
    }
  }

  async upsertByRecipientEmail(
    input: ConversationV2AppShareUpsert & { recipientEmail: string },
  ): Promise<ConversationV2AppShareRecord> {
    const sessionId = normalizeObjectId(input.sessionId);
    const recipientEmail = input.recipientEmail.trim().toLowerCase();

    const updateExisting = async (): Promise<ConversationV2AppShareRecord | null> => {
      const [existing] = await this.q
        .select()
        .from(schema.conversationV2AppShares)
        .where(
          and(
            eq(schema.conversationV2AppShares.sessionId, sessionId),
            eq(schema.conversationV2AppShares.recipientEmail, recipientEmail),
          ),
        )
        .limit(1);
      if (!existing) return null;
      const [row] = await this.q
        .update(schema.conversationV2AppShares)
        .set({
          ...this.patchFields({ ...input, recipientEmail }),
          recipientUserId: input.recipientUserId
            ? normalizeObjectId(input.recipientUserId)
            : existing.recipientUserId,
        })
        .where(eq(schema.conversationV2AppShares.id, existing.id))
        .returning();
      return PgConversationV2AppShareStore.toRecord(row);
    };

    const updated = await updateExisting();
    if (updated) return updated;

    try {
      const now = new Date();
      const [row] = await this.q
        .insert(schema.conversationV2AppShares)
        .values({
          id: newObjectId(),
          sessionId,
          recipientUserId: input.recipientUserId
            ? normalizeObjectId(input.recipientUserId)
            : null,
          ...this.patchFields({ ...input, recipientEmail }),
          createdAt: now,
        })
        .returning();
      return PgConversationV2AppShareStore.toRecord(row);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const raced = await updateExisting();
      if (raced) return raced;
      throw err;
    }
  }

  async listByRecipientUserId(userId: string): Promise<ConversationV2AppShareRecord[]> {
    if (!isObjectId(userId)) return [];
    const rows = await this.q
      .select()
      .from(schema.conversationV2AppShares)
      .where(
        eq(schema.conversationV2AppShares.recipientUserId, normalizeObjectId(userId)),
      )
      .orderBy(desc(schema.conversationV2AppShares.updatedAt));
    return rows.map(PgConversationV2AppShareStore.toRecord);
  }

  async findConversationAccess(userId: string, sessionId: string): Promise<boolean> {
    if (!isObjectId(userId) || !isObjectId(sessionId)) return false;
    const [row] = await this.q
      .select({ id: schema.conversationV2AppShares.id })
      .from(schema.conversationV2AppShares)
      .where(
        and(
          eq(schema.conversationV2AppShares.sessionId, normalizeObjectId(sessionId)),
          eq(schema.conversationV2AppShares.recipientUserId, normalizeObjectId(userId)),
          eq(schema.conversationV2AppShares.includeConversation, true),
        ),
      )
      .limit(1);
    return !!row;
  }

  async deleteForRecipient(userId: string, sessionId: string): Promise<boolean> {
    if (!isObjectId(userId) || !isObjectId(sessionId)) return false;
    const deleted = await this.q
      .delete(schema.conversationV2AppShares)
      .where(
        and(
          eq(schema.conversationV2AppShares.sessionId, normalizeObjectId(sessionId)),
          eq(schema.conversationV2AppShares.recipientUserId, normalizeObjectId(userId)),
        ),
      )
      .returning({ id: schema.conversationV2AppShares.id });
    return deleted.length > 0;
  }

  async deleteAllForSession(sessionId: string): Promise<void> {
    if (!isObjectId(sessionId)) return;
    await this.q
      .delete(schema.conversationV2AppShares)
      .where(eq(schema.conversationV2AppShares.sessionId, normalizeObjectId(sessionId)));
  }

  async findByInviteTokenHash(hash: string): Promise<ConversationV2AppShareRecord | null> {
    if (!hash) return null;
    const [row] = await this.q
      .select()
      .from(schema.conversationV2AppShares)
      .where(eq(schema.conversationV2AppShares.inviteTokenHash, hash))
      .limit(1);
    return row ? PgConversationV2AppShareStore.toRecord(row) : null;
  }

  async markInviteConsumed(id: string): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q
      .update(schema.conversationV2AppShares)
      .set({ inviteConsumedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.conversationV2AppShares.id, normalizeObjectId(id)));
  }

  async syncDeployMetadata(
    sessionId: string,
    patch: { title: string; deployedUrl: string; lastDeployedAt: Date | null },
  ): Promise<void> {
    if (!isObjectId(sessionId)) return;
    await this.q
      .update(schema.conversationV2AppShares)
      .set({
        title: patch.title,
        deployedUrl: patch.deployedUrl,
        lastDeployedAt: patch.lastDeployedAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.conversationV2AppShares.sessionId, normalizeObjectId(sessionId)));
  }

  async claimPendingByEmail(userId: string, email: string): Promise<void> {
    if (!isObjectId(userId) || !email) return;
    await this.q
      .update(schema.conversationV2AppShares)
      .set({
        recipientUserId: normalizeObjectId(userId),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.conversationV2AppShares.recipientEmail, email.trim().toLowerCase()),
          isNull(schema.conversationV2AppShares.recipientUserId),
        ),
      );
  }
}
