import { Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import {
  type RuntimeToolCallRecord,
  type RuntimeToolCallStore,
  type ToolCallStatus,
  type UpsertRunningToolCallData,
} from './runtime-tool-call.store';

type Row = typeof schema.appRuntimeToolCalls.$inferSelect;

function toRecord(row: Row): RuntimeToolCallRecord {
  return {
    toolCallId: row.toolCallId,
    bindingId: row.bindingId,
    workspaceId: row.workspaceId,
    tool: row.tool,
    argumentsHash: row.argumentsHash,
    baseRevisionId: row.baseRevisionId ?? null,
    status: row.status as ToolCallStatus,
    result: (row.result as Record<string, unknown>) ?? null,
    error: (row.error as Record<string, unknown>) ?? null,
    resultingRevisionId: row.resultingRevisionId ?? null,
    startedAtMs: row.startedAtMs ?? null,
    durationMs: row.durationMs ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PgRuntimeToolCallStore implements RuntimeToolCallStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async findByToolCallId(toolCallId: string): Promise<RuntimeToolCallRecord | null> {
    const [row] = await this.q
      .select()
      .from(schema.appRuntimeToolCalls)
      .where(eq(schema.appRuntimeToolCalls.toolCallId, toolCallId))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async upsertRunning(data: UpsertRunningToolCallData): Promise<void> {
    await this.q
      .insert(schema.appRuntimeToolCalls)
      .values({
        toolCallId: data.toolCallId,
        bindingId: data.bindingId,
        workspaceId: data.workspaceId,
        tool: data.tool,
        argumentsHash: data.argumentsHash,
        baseRevisionId: data.baseRevisionId,
        status: 'running',
        startedAtMs: Date.now(),
        durationMs: null,
        error: null,
        result: null,
      })
      .onConflictDoUpdate({
        target: schema.appRuntimeToolCalls.toolCallId,
        set: {
          bindingId: data.bindingId,
          workspaceId: data.workspaceId,
          tool: data.tool,
          argumentsHash: data.argumentsHash,
          baseRevisionId: data.baseRevisionId,
          status: 'running',
          startedAtMs: Date.now(),
          durationMs: null,
          error: null,
          result: null,
          updatedAt: new Date(),
        },
      });
  }

  async markSucceeded(
    toolCallId: string,
    result: Record<string, unknown>,
    resultingRevisionId: string | null,
    durationMs: number | null,
  ): Promise<void> {
    await this.q
      .update(schema.appRuntimeToolCalls)
      .set({
        status: 'succeeded',
        result,
        error: null,
        resultingRevisionId,
        durationMs,
        updatedAt: new Date(),
      })
      .where(eq(schema.appRuntimeToolCalls.toolCallId, toolCallId));
  }

  async markFailed(
    toolCallId: string,
    error: Record<string, unknown>,
    durationMs: number | null,
  ): Promise<void> {
    await this.q
      .update(schema.appRuntimeToolCalls)
      .set({
        status: 'failed',
        error,
        durationMs,
        updatedAt: new Date(),
      })
      .where(eq(schema.appRuntimeToolCalls.toolCallId, toolCallId));
  }

  async getStartedAtMs(toolCallId: string): Promise<number | null> {
    const [row] = await this.q
      .select({ startedAtMs: schema.appRuntimeToolCalls.startedAtMs })
      .from(schema.appRuntimeToolCalls)
      .where(eq(schema.appRuntimeToolCalls.toolCallId, toolCallId))
      .limit(1);
    return row?.startedAtMs ?? null;
  }
}
