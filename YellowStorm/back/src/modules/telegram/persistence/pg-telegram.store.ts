import { Inject } from '@nestjs/common';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { newObjectId } from '@common/postgres';
import { withTransaction, resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import {
  TELEGRAM_BINDING_STORE,
  TELEGRAM_INTEGRATION_STORE,
  TELEGRAM_LINK_CODE_STORE,
  type TelegramBindingRow,
  type TelegramBindingStore,
  type TelegramIntegrationRow,
  type TelegramIntegrationStore,
  type TelegramLinkCodeRow,
  type TelegramLinkCodeStore,
} from './telegram.store';

type IntRow = typeof schema.channelsTelegramIntegrations.$inferSelect;
type BindRow = typeof schema.channelsTelegramChatBindings.$inferSelect;
type CodeRow = typeof schema.channelsTelegramLinkCodes.$inferSelect;

function intToRow(r: IntRow): TelegramIntegrationRow {
  return {
    id: r.id,
    userId: r.userId,
    agentId: r.agentId,
    encryptedBotToken: r.encryptedBotToken,
    botUsername: r.botUsername ?? null,
    webhookSecret: r.webhookSecret,
    enabled: r.enabled,
    status: r.status,
    errorMessage: r.errorMessage ?? null,
    lastWebhookAt: r.lastWebhookAt ?? null,
    lastUpdateId: r.lastUpdateId ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function bindToRow(r: BindRow): TelegramBindingRow {
  return {
    id: r.id,
    integrationId: r.integrationId,
    userId: r.userId,
    agentId: r.agentId,
    telegramChatId: r.telegramChatId,
    telegramUserId: r.telegramUserId ?? null,
    conversationId: r.conversationId ?? null,
    lastMessageAt: r.lastMessageAt ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export class PgTelegramIntegrationStore implements TelegramIntegrationStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async findByAgent(agentId: string): Promise<TelegramIntegrationRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.channelsTelegramIntegrations)
      .where(eq(schema.channelsTelegramIntegrations.agentId, agentId))
      .limit(1);
    return row ? intToRow(row) : null;
  }

  async findById(id: string): Promise<TelegramIntegrationRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.channelsTelegramIntegrations)
      .where(eq(schema.channelsTelegramIntegrations.id, id))
      .limit(1);
    return row ? intToRow(row) : null;
  }

  async insert(row: {
    userId: string;
    agentId: string;
    encryptedBotToken: string;
    botUsername: string | null;
    webhookSecret: string;
    enabled: boolean;
    status: string;
  }): Promise<TelegramIntegrationRow> {
    const [inserted] = await this.q
      .insert(schema.channelsTelegramIntegrations)
      .values({ id: newObjectId(), ...row })
      .returning();
    return intToRow(inserted);
  }

  async update(
    id: string,
    patch: Partial<Pick<TelegramIntegrationRow, 'encryptedBotToken' | 'botUsername' | 'enabled' | 'status' | 'errorMessage'>>,
  ): Promise<TelegramIntegrationRow | null> {
    const [row] = await this.q
      .update(schema.channelsTelegramIntegrations)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.channelsTelegramIntegrations.id, id))
      .returning();
    return row ? intToRow(row) : null;
  }

  async markWebhookUpdate(integrationId: string, updateId: number): Promise<boolean> {
    const rows = await this.q
      .update(schema.channelsTelegramIntegrations)
      .set({ lastUpdateId: updateId, lastWebhookAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(schema.channelsTelegramIntegrations.id, integrationId),
        sql`(${schema.channelsTelegramIntegrations.lastUpdateId} IS NULL OR ${schema.channelsTelegramIntegrations.lastUpdateId} < ${updateId})`,
      ))
      .returning({ id: schema.channelsTelegramIntegrations.id });
    return rows.length > 0;
  }

  async touchLastWebhook(integrationId: string): Promise<void> {
    await this.q
      .update(schema.channelsTelegramIntegrations)
      .set({ lastWebhookAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.channelsTelegramIntegrations.id, integrationId));
  }

  async delete(id: string): Promise<void> {
    await this.q.delete(schema.channelsTelegramIntegrations).where(eq(schema.channelsTelegramIntegrations.id, id));
  }
}

export class PgTelegramBindingStore implements TelegramBindingStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async findByChat(integrationId: string, telegramChatId: string): Promise<TelegramBindingRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.channelsTelegramChatBindings)
      .where(and(
        eq(schema.channelsTelegramChatBindings.integrationId, integrationId),
        eq(schema.channelsTelegramChatBindings.telegramChatId, telegramChatId),
      ))
      .limit(1);
    return row ? bindToRow(row) : null;
  }

  async upsert(row: {
    integrationId: string;
    userId: string;
    agentId: string;
    telegramChatId: string;
    telegramUserId: string | null;
    lastMessageAt: Date;
  }): Promise<TelegramBindingRow> {
    const [inserted] = await this.q
      .insert(schema.channelsTelegramChatBindings)
      .values({ id: newObjectId(), ...row })
      .onConflictDoUpdate({
        target: [schema.channelsTelegramChatBindings.integrationId, schema.channelsTelegramChatBindings.telegramChatId],
        set: {
          userId: row.userId,
          agentId: row.agentId,
          telegramUserId: row.telegramUserId,
          lastMessageAt: row.lastMessageAt,
          updatedAt: new Date(),
        },
      })
      .returning();
    return bindToRow(inserted);
  }

  async updateLastMessage(id: string, lastMessageAt: Date): Promise<void> {
    await this.q
      .update(schema.channelsTelegramChatBindings)
      .set({ lastMessageAt, updatedAt: new Date() })
      .where(eq(schema.channelsTelegramChatBindings.id, id));
  }

  async update(id: string, patch: Partial<Pick<TelegramBindingRow, 'conversationId' | 'telegramUserId'>>): Promise<void> {
    await this.q
      .update(schema.channelsTelegramChatBindings)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.channelsTelegramChatBindings.id, id));
  }

  async deleteAllForIntegration(integrationId: string): Promise<void> {
    await this.q.delete(schema.channelsTelegramChatBindings).where(eq(schema.channelsTelegramChatBindings.integrationId, integrationId));
  }
}

export class PgTelegramLinkCodeStore implements TelegramLinkCodeStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async generate(row: { integrationId: string; userId: string; agentId: string; codeHash: string; expiresAt: Date }): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      await tx
        .delete(schema.channelsTelegramLinkCodes)
        .where(and(
          eq(schema.channelsTelegramLinkCodes.integrationId, row.integrationId),
          eq(schema.channelsTelegramLinkCodes.consumed, false),
        ));
      await tx.insert(schema.channelsTelegramLinkCodes).values({ id: newObjectId(), ...row, consumed: false });
    });
  }

  async consume(codeHash: string, integrationId: string): Promise<TelegramLinkCodeRow | null> {
    const [row] = await this.q
      .update(schema.channelsTelegramLinkCodes)
      .set({ consumed: true, consumedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(schema.channelsTelegramLinkCodes.codeHash, codeHash),
        eq(schema.channelsTelegramLinkCodes.integrationId, integrationId),
        eq(schema.channelsTelegramLinkCodes.consumed, false),
        gt(schema.channelsTelegramLinkCodes.expiresAt, new Date()),
      ))
      .returning();
    if (!row) return null;
    return {
      id: row.id,
      integrationId: row.integrationId,
      userId: row.userId,
      agentId: row.agentId,
      codeHash: row.codeHash,
      expiresAt: row.expiresAt,
      consumed: row.consumed,
      consumedAt: row.consumedAt ?? null,
    };
  }

  async deleteAllForIntegration(integrationId: string): Promise<void> {
    await this.q.delete(schema.channelsTelegramLinkCodes).where(eq(schema.channelsTelegramLinkCodes.integrationId, integrationId));
  }
}
