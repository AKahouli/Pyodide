import { Inject } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { newObjectId } from '@common/postgres';
import { isUniqueViolation } from '@common/postgres/errors';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import {
  type RuntimeBindingRecord,
  type RuntimeBindingStore,
  type RuntimeBindingStatus,
  type UpsertBindingData,
} from './runtime-binding.store';

type Row = typeof schema.appRuntimeBindings.$inferSelect;

function toRecord(row: Row): RuntimeBindingRecord {
  return {
    bindingId: row.bindingId,
    workspaceId: row.workspaceId,
    conversationSessionId: row.conversationSessionId,
    userId: row.userId,
    status: row.status as RuntimeBindingStatus,
    latestRevisionId: row.latestRevisionId,
    mcpTokenHash: row.mcpTokenHash,
    browserRuntimeId: row.browserRuntimeId ?? null,
    browserCapabilities: (row.browserCapabilities!) ?? null,
    lastHeartbeatAt: row.lastHeartbeatAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PgRuntimeBindingStore implements RuntimeBindingStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async upsertByWorkspaceId(data: UpsertBindingData): Promise<RuntimeBindingRecord | null> {
    try {
      const [row] = await this.q
        .insert(schema.appRuntimeBindings)
        .values({
          bindingId: data.bindingId,
          workspaceId: data.workspaceId,
          conversationSessionId: data.conversationSessionId,
          userId: data.userId,
          status: data.status,
          latestRevisionId: data.latestRevisionId,
          mcpTokenHash: data.mcpTokenHash ?? '',
        })
        .onConflictDoUpdate({
          target: schema.appRuntimeBindings.workspaceId,
          set: {
            conversationSessionId: data.conversationSessionId,
            userId: data.userId,
            ...(data.mcpTokenHash !== null ? { mcpTokenHash: data.mcpTokenHash } : {}),
            updatedAt: new Date(),
          },
        })
        .returning();
      return row ? toRecord(row) : null;
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  async findByWorkspaceId(workspaceId: string): Promise<RuntimeBindingRecord | null> {
    const [row] = await this.q
      .select()
      .from(schema.appRuntimeBindings)
      .where(eq(schema.appRuntimeBindings.workspaceId, workspaceId))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async findByMcpTokenHash(mcpTokenHash: string): Promise<RuntimeBindingRecord | null> {
    const [row] = await this.q
      .select()
      .from(schema.appRuntimeBindings)
      .where(eq(schema.appRuntimeBindings.mcpTokenHash, mcpTokenHash))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async updateStatus(
    workspaceId: string,
    fromStatus: RuntimeBindingStatus | null,
    toStatus: RuntimeBindingStatus,
    extra?: Partial<Pick<RuntimeBindingRecord, 'browserRuntimeId' | 'browserCapabilities' | 'lastHeartbeatAt'>>,
  ): Promise<void> {
    const conditions = [eq(schema.appRuntimeBindings.workspaceId, workspaceId)];
    if (fromStatus !== null) {
      conditions.push(eq(schema.appRuntimeBindings.status, fromStatus));
    }
    await this.q
      .update(schema.appRuntimeBindings)
      .set({
        status: toStatus,
        ...(extra?.browserRuntimeId !== undefined ? { browserRuntimeId: extra.browserRuntimeId } : {}),
        ...(extra?.browserCapabilities !== undefined ? { browserCapabilities: extra.browserCapabilities } : {}),
        ...(extra?.lastHeartbeatAt !== undefined ? { lastHeartbeatAt: extra.lastHeartbeatAt } : {}),
        updatedAt: new Date(),
      })
      .where(and(...conditions));
  }

  async updateHeartbeat(workspaceId: string, at: Date): Promise<void> {
    await this.q
      .update(schema.appRuntimeBindings)
      .set({ lastHeartbeatAt: at, updatedAt: new Date() })
      .where(eq(schema.appRuntimeBindings.workspaceId, workspaceId));
  }

  async updateRevision(workspaceId: string, revisionId: string): Promise<void> {
    await this.q
      .update(schema.appRuntimeBindings)
      .set({ latestRevisionId: revisionId, updatedAt: new Date() })
      .where(eq(schema.appRuntimeBindings.workspaceId, workspaceId));
  }
}
