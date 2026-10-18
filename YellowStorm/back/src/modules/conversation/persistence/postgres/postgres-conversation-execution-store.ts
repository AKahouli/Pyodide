import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { LoggerService } from '@modules/logger';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { measureBackendPreparation } from '../../utils/backend-latency-tracker';
import {
  AdmitExecutionInput,
  AdmitExecutionResult,
  ConversationExecutionConflictReason,
  ConversationExecutionStore,
} from '../conversation-execution-store';

interface PgErrorShape {
  code?: string;
  constraint?: string;
  cause?: PgErrorShape;
}

function pgError(error: unknown): PgErrorShape | undefined {
  const candidate = error as PgErrorShape | undefined;
  return candidate?.code ? candidate : candidate?.cause;
}

@Injectable()
export class PostgresConversationExecutionStore implements ConversationExecutionStore {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PostgresConversationExecutionStore.name);
  }

  /** Probe the admission table once at startup so a skipped migration is loud. */
  async onModuleInit(): Promise<void> {
    await this.db.execute(sql`SELECT 1 FROM conversation.conversation_executions LIMIT 0`);
  }

  async admit(input: AdmitExecutionInput): Promise<AdmitExecutionResult> {
    try {
      // Serialize the admission decision across replicas: quotas count executions,
      // including distinct isolated turns within the same conversation.
      return await this.db.transaction(async (tx) => {
        await measureBackendPreparation('fleet.lock_acquisition', () => tx.execute(sql`SELECT pg_advisory_xact_lock(73124, 1)`));
        // Keep the lock in a separate statement: this decision needs a fresh
        // READ COMMITTED snapshot after any preceding lock holder commits.
        const result = await measureBackendPreparation('fleet.decision', () => tx.execute(sql`
          WITH conflict AS (
          SELECT 1 FROM conversation.conversation_executions
          WHERE conversation_id = ${input.conversationId}::char(24) AND status = 'running'
            AND (native_session_id IS NULL OR ${input.nativeSessionId ?? null}::text IS NULL
              OR native_session_id = ${input.nativeSessionId ?? null}) LIMIT 1
          ), admitted AS (
          INSERT INTO conversation.conversation_executions
            (id, conversation_id, user_id, message_id, owner_replica_id, native_session_id, status, expires_at)
          SELECT
            ${input.executionId}::char(24), ${input.conversationId}::char(24),
            ${input.userId}::char(24), ${input.messageId}::char(24),
            ${input.ownerReplicaId}, ${input.nativeSessionId ?? null}, 'running',
            ${input.expiresAt.toISOString()}::timestamptz
          WHERE NOT EXISTS (SELECT 1 FROM conflict) AND
            (SELECT count(*) FROM conversation.conversation_executions
              WHERE status = 'running' AND expires_at > now()
                AND user_id = ${input.userId}::char(24)) < ${input.maxActiveRunsPerUser}
            AND (SELECT count(*) FROM conversation.conversation_executions
              WHERE status = 'running' AND expires_at > now()) < ${input.maxActiveRunsFleet}
          RETURNING id
          )
          SELECT CASE WHEN EXISTS (SELECT 1 FROM conflict) THEN 'conversation_busy'
            WHEN EXISTS (SELECT 1 FROM admitted) THEN 'admitted' ELSE 'capacity' END AS decision
        `));
        const decision = (result.rows[0] as { decision: 'admitted' | 'conversation_busy' | 'capacity' }).decision;
        return decision === 'admitted' ? { admitted: true as const }
          : { admitted: false as const, reason: decision };
      });
    } catch (error) {
      const conflict = this.classifyConflict(error);
      if (conflict) {
        return { admitted: false, reason: conflict };
      }
      throw error;
    }
  }

  async extendExpiry(messageId: string, expiresAt: Date): Promise<void> {
    await this.db.execute(sql`
      UPDATE conversation.conversation_executions
      SET expires_at = ${expiresAt.toISOString()}::timestamptz, updated_at = now()
      WHERE message_id = ${messageId}::char(24) AND status = 'running'
    `);
  }

  async isCancelRequested(messageId: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT 1 FROM conversation.conversation_executions
      WHERE message_id = ${messageId}::char(24)
        AND status = 'running'
        AND cancel_requested_at IS NOT NULL
      LIMIT 1
    `);
    return (result.rowCount ?? 0) === 1;
  }

  async requestCancel({ conversationId, messageId }: { conversationId: string; messageId: string }): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE conversation.conversation_executions
      SET cancel_requested_at = now(), updated_at = now()
      WHERE conversation_id = ${conversationId}::char(24)
        AND message_id = ${messageId}::char(24) AND status = 'running'
      RETURNING message_id
    `);
    return (result.rowCount ?? 0) === 1;
  }

  async finalizeByMessage(messageId: string): Promise<void> {
    // Release capacity only after the message has a durable terminal state.
    await this.db.execute(sql`
      UPDATE conversation.conversation_executions e
      SET status = m.execution_status,
          terminal_at = now(),
          updated_at = now()
      FROM conversation.messages m
      WHERE e.message_id = ${messageId}::char(24)
        AND e.status = 'running'
        AND m.id = e.message_id
        AND m.conversation_id = e.conversation_id
        AND m.execution_status IN ('completed', 'failed', 'interrupted', 'cancelled')
    `);
  }

  async finalizeExpired(now: Date): Promise<number> {
    // Lock both rows: a late heartbeat cannot race capacity reclamation.
    // Active message leases are settled by message recovery first.
    const result = await this.db.execute(sql`
      WITH expired AS (
        SELECT e.id, m.execution_status
        FROM conversation.conversation_executions e
        JOIN conversation.messages m ON m.id = e.message_id AND m.conversation_id = e.conversation_id
        WHERE e.status = 'running'
          AND e.expires_at < ${now.toISOString()}::timestamptz
          AND m.execution_status IN ('completed', 'failed', 'interrupted', 'cancelled')
          AND (m.stream_execution_lease_expires_at IS NULL
            OR m.stream_execution_lease_expires_at < ${now.toISOString()}::timestamptz)
        ORDER BY e.expires_at, e.id
        LIMIT 100
        FOR UPDATE OF e, m SKIP LOCKED
      )
      UPDATE conversation.conversation_executions e
      SET status = expired.execution_status, terminal_at = now(), updated_at = now()
      FROM expired WHERE e.id = expired.id AND e.status = 'running'
    `);
    return result.rowCount ?? 0;
  }

  private classifyConflict(error: unknown): ConversationExecutionConflictReason | null {
    const candidate = pgError(error);
    if (!candidate || candidate.code !== '23505') {
      return null;
    }
    if (candidate.constraint === 'uq_conversation_executions_running_conversation') {
      return 'conversation_busy';
    }
    if (candidate.constraint === 'uq_conversation_executions_message') {
      return 'message_already_running';
    }
    return 'conversation_busy';
  }

}
/** New execution row id (24-hex, matching the conversation id conventions). */
export function newExecutionId(): string {
  return randomUUID().replaceAll('-', '').slice(0, 24);
}

