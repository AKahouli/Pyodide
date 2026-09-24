import { Inject } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import {
  type RuntimeTicketRecord,
  type RuntimeTicketStore,
  type CreateRuntimeTicketData,
} from './runtime-ticket.store';

type Row = typeof schema.appRuntimeTickets.$inferSelect;

function toRecord(row: Row): RuntimeTicketRecord {
  return {
    runtimeSessionId: row.runtimeSessionId,
    ticketHash: row.ticketHash,
    bindingId: row.bindingId,
    workspaceId: row.workspaceId,
    userId: row.userId,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PgRuntimeTicketStore implements RuntimeTicketStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async create(data: CreateRuntimeTicketData): Promise<RuntimeTicketRecord> {
    const [row] = await this.q
      .insert(schema.appRuntimeTickets)
      .values({
        runtimeSessionId: data.runtimeSessionId,
        ticketHash: data.ticketHash,
        bindingId: data.bindingId,
        workspaceId: data.workspaceId,
        userId: data.userId,
        expiresAt: data.expiresAt,
        consumedAt: null,
      })
      .returning();
    return toRecord(row);
  }

  async consumeByHash(ticketHash: string): Promise<RuntimeTicketRecord | null> {
    const [row] = await this.q
      .update(schema.appRuntimeTickets)
      .set({ consumedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.appRuntimeTickets.ticketHash, ticketHash),
          isNull(schema.appRuntimeTickets.consumedAt),
          gt(schema.appRuntimeTickets.expiresAt, new Date()),
        ),
      )
      .returning();
    return row ? toRecord(row) : null;
  }
}
