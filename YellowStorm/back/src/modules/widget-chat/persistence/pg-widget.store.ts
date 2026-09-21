import { Inject } from '@nestjs/common';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { newObjectId } from '@common/postgres';
import { withTransaction, resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import {
  type NewWidgetSession,
  type NewWidgetToken,
  type WidgetMessageInput,
  type WidgetMessageStore,
  type WidgetSessionRow,
  type WidgetSessionStore,
  type WidgetTokenRow,
  type WidgetTokenStore,
} from './widget.store';

type TokenRow = typeof schema.channelsWidgetTokens.$inferSelect;
type SessionRow = typeof schema.channelsWidgetSessions.$inferSelect;

function tokenToRow(r: TokenRow): WidgetTokenRow {
  return {
    id: r.id,
    tokenHash: r.tokenHash,
    agentId: r.agentId,
    label: r.label ?? null,
    allowedOrigins: r.allowedOrigins ?? [],
    isActive: r.isActive,
    expiresAt: r.expiresAt ?? null,
    lastUsedAt: r.lastUsedAt ?? null,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function sessionToRow(r: SessionRow): WidgetSessionRow {
  return {
    id: r.id,
    tokenHash: r.tokenHash,
    agentId: r.agentId,
    visitorId: r.visitorId,
    metadata: r.metadata ?? {},
    clientContext: r.clientContext ?? {},
    appSource: r.appSource ?? {},
    geo: r.geo ?? {},
    status: r.status,
    messageCount: r.messageCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export class PgWidgetTokenStore implements WidgetTokenStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async findActiveByHash(tokenHash: string): Promise<WidgetTokenRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.channelsWidgetTokens)
      .where(and(
        eq(schema.channelsWidgetTokens.tokenHash, tokenHash),
        eq(schema.channelsWidgetTokens.isActive, true),
      ))
      .limit(1);
    return row ? tokenToRow(row) : null;
  }

  async touchLastUsedThrottled(tokenHash: string): Promise<void> {
    // Plan 4.12: one write per minute per row instead of one per call.
    await this.q
      .update(schema.channelsWidgetTokens)
      .set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(schema.channelsWidgetTokens.tokenHash, tokenHash),
        sql`(${schema.channelsWidgetTokens.lastUsedAt} IS NULL OR ${schema.channelsWidgetTokens.lastUsedAt} < now() - interval '60 seconds')`,
      ));
  }

  async existsActiveForAgent(agentId: string): Promise<boolean> {
    const rows = await this.q
      .select({ id: schema.channelsWidgetTokens.id })
      .from(schema.channelsWidgetTokens)
      .where(and(
        eq(schema.channelsWidgetTokens.agentId, agentId),
        eq(schema.channelsWidgetTokens.isActive, true),
        or(
          isNull(schema.channelsWidgetTokens.expiresAt),
          gt(schema.channelsWidgetTokens.expiresAt, new Date()),
        ),
      ))
      .limit(1);
    return rows.length > 0;
  }

  async listByAgent(agentId: string): Promise<WidgetTokenRow[]> {
    const rows = await this.q
      .select()
      .from(schema.channelsWidgetTokens)
      .where(eq(schema.channelsWidgetTokens.agentId, agentId))
      .orderBy(desc(schema.channelsWidgetTokens.createdAt));
    return rows.map(tokenToRow);
  }

  async insert(row: NewWidgetToken): Promise<WidgetTokenRow> {
    const [inserted] = await this.q
      .insert(schema.channelsWidgetTokens)
      .values({ id: newObjectId(), ...row })
      .returning();
    return tokenToRow(inserted);
  }

  async update(
    agentId: string,
    tokenId: string,
    patch: Partial<Pick<NewWidgetToken, 'label' | 'allowedOrigins' | 'isActive' | 'expiresAt'>>,
  ): Promise<WidgetTokenRow | null> {
    const [row] = await this.q
      .update(schema.channelsWidgetTokens)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(
        eq(schema.channelsWidgetTokens.id, tokenId),
        eq(schema.channelsWidgetTokens.agentId, agentId),
      ))
      .returning();
    return row ? tokenToRow(row) : null;
  }

  async delete(agentId: string, tokenId: string): Promise<WidgetTokenRow | null> {
    const [row] = await this.q
      .delete(schema.channelsWidgetTokens)
      .where(and(
        eq(schema.channelsWidgetTokens.id, tokenId),
        eq(schema.channelsWidgetTokens.agentId, agentId),
      ))
      .returning();
    return row ? tokenToRow(row) : null;
  }

  async revokeAllForAgent(agentId: string): Promise<void> {
    await this.q
      .update(schema.channelsWidgetTokens)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(
        eq(schema.channelsWidgetTokens.agentId, agentId),
        eq(schema.channelsWidgetTokens.isActive, true),
      ));
  }
}

export class PgWidgetSessionStore implements WidgetSessionStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async createOrGetSession(row: NewWidgetSession): Promise<{ session: WidgetSessionRow; created: boolean }> {
    // Plan 4.13 race fix: the partial unique index arbitrates concurrent
    // inserts; the loser reads the winner's row instead of failing.
    const [inserted] = await this.q
      .insert(schema.channelsWidgetSessions)
      .values({ id: newObjectId(), ...row })
      .onConflictDoNothing({
        target: [schema.channelsWidgetSessions.tokenHash, schema.channelsWidgetSessions.visitorId],
        // Partial unique index predicate (status='active').
        where: sql`${schema.channelsWidgetSessions.status} = 'active'`,
      })
      .returning();
    if (inserted) {
      return { session: sessionToRow(inserted), created: true };
    }
    const [existing] = await this.q
      .select()
      .from(schema.channelsWidgetSessions)
      .where(and(
        eq(schema.channelsWidgetSessions.tokenHash, row.tokenHash),
        eq(schema.channelsWidgetSessions.visitorId, row.visitorId),
        eq(schema.channelsWidgetSessions.status, 'active'),
      ))
      .limit(1);
    return { session: sessionToRow(existing), created: false };
  }

  async resetVisitorSession(row: NewWidgetSession): Promise<{ session: WidgetSessionRow; closedSessionIds: string[] }> {
    return withTransaction(this.db, async (tx) => {
      const closed = await tx
        .update(schema.channelsWidgetSessions)
        .set({ status: 'closed', updatedAt: new Date() })
        .where(and(
          eq(schema.channelsWidgetSessions.tokenHash, row.tokenHash),
          eq(schema.channelsWidgetSessions.visitorId, row.visitorId),
          eq(schema.channelsWidgetSessions.status, 'active'),
        ))
        .returning({ id: schema.channelsWidgetSessions.id });
      const [inserted] = await tx
        .insert(schema.channelsWidgetSessions)
        .values({ id: newObjectId(), ...row })
        .returning();
      return { session: sessionToRow(inserted), closedSessionIds: closed.map((c) => c.id) };
    });
  }

  async findByIdWithAgent(id: string, tokenHash: string, agentId: string): Promise<WidgetSessionRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.channelsWidgetSessions)
      .where(and(
        eq(schema.channelsWidgetSessions.id, id),
        eq(schema.channelsWidgetSessions.tokenHash, tokenHash),
        eq(schema.channelsWidgetSessions.agentId, agentId),
        eq(schema.channelsWidgetSessions.status, 'active'),
      ))
      .limit(1);
    return row ? sessionToRow(row) : null;
  }

  async incrementMessageCount(id: string): Promise<void> {
    await this.q
      .update(schema.channelsWidgetSessions)
      .set({ messageCount: sql`${schema.channelsWidgetSessions.messageCount} + 1`, updatedAt: new Date() })
      .where(eq(schema.channelsWidgetSessions.id, id));
  }
}

export class PgWidgetMessageStore implements WidgetMessageStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async insert(input: WidgetMessageInput): Promise<{ id: string }> {
    // Plan 4.14: message row and session counter move together.
    return withTransaction(this.db, async (tx) => {
      const [inserted] = await tx
        .insert(schema.channelsWidgetMessages)
        .values({
          id: newObjectId(),
          sessionId: input.sessionId,
          tokenHash: input.tokenHash,
          agentId: input.agentId,
          role: input.role,
          content: input.content,
          components: input.components ?? [],
          interaction: input.interaction ?? null,
          inputTokens: input.inputTokens ?? null,
          outputTokens: input.outputTokens ?? null,
          durationMs: input.durationMs ?? null,
        })
        .returning({ id: schema.channelsWidgetMessages.id });
      await tx
        .update(schema.channelsWidgetSessions)
        .set({ messageCount: sql`${schema.channelsWidgetSessions.messageCount} + 1`, updatedAt: new Date() })
        .where(eq(schema.channelsWidgetSessions.id, input.sessionId));
      return inserted;
    });
  }
}
