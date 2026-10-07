import { Inject } from '@nestjs/common';
import { and, eq, gt, lte } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { newObjectId } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import {
  type AiPreviewTicketRecord,
  type AiPreviewTicketStore,
  type CreateAiPreviewTicketData,
} from './ai-preview-ticket.store';

type Row = typeof schema.appRuntimeAiPreviewTickets.$inferSelect;

function toRecord(row: Row): AiPreviewTicketRecord {
  return {
    id: row.id,
    ticketHash: row.ticketHash,
    conversationSessionId: row.conversationSessionId,
    workspaceId: row.workspaceId,
    bindingId: row.bindingId,
    billableUserId: row.billableUserId,
    purpose: row.purpose,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PgAiPreviewTicketStore implements AiPreviewTicketStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async create(data: CreateAiPreviewTicketData): Promise<AiPreviewTicketRecord> {
    const [row] = await this.q
      .insert(schema.appRuntimeAiPreviewTickets)
      .values({
        id: newObjectId(),
        ticketHash: data.ticketHash,
        conversationSessionId: data.conversationSessionId,
        workspaceId: data.workspaceId,
        bindingId: data.bindingId,
        billableUserId: data.billableUserId,
        purpose: data.purpose ?? 'ai_preview',
        expiresAt: data.expiresAt,
      })
      .returning();
    return toRecord(row);
  }

  async expireLiveForWorkspace(workspaceId: string): Promise<void> {
    await this.q
      .update(schema.appRuntimeAiPreviewTickets)
      .set({ expiresAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.appRuntimeAiPreviewTickets.workspaceId, workspaceId),
          gt(schema.appRuntimeAiPreviewTickets.expiresAt, new Date()),
        ),
      );
  }

  async findLiveByHash(ticketHash: string, purpose: string): Promise<AiPreviewTicketRecord | null> {
    const [row] = await this.q
      .select()
      .from(schema.appRuntimeAiPreviewTickets)
      .where(
        and(
          eq(schema.appRuntimeAiPreviewTickets.ticketHash, ticketHash),
          eq(schema.appRuntimeAiPreviewTickets.purpose, purpose),
          gt(schema.appRuntimeAiPreviewTickets.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return row ? toRecord(row) : null;
  }
}
