import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { LoggerService } from '@modules/logger';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import {
  AdmitExecutionInput,
  AdmitExecutionResult,
  ConversationExecutionConflictReason,
  ConversationExecutionStore,
} from '../conversation-execution-store';

interface PgErrorShape {
  code?: string;
  constraint?: string;
}

@Injectable()
export class PostgresConversationExecutionStore implements ConversationExecutionStore {
  /** Cleared-safe flag: a missing table (migration not applied) disables the store once. */
  private unavailable = false;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PostgresConversationExecutionStore.name);
  }

  /** Probe the admission table once at startup so a skipped migration is loud. */
  onModuleInit(): void {
    void this.isCancelRequested('000000000000000000000000').catch(() => undefined);
  }

  async admit(input: AdmitExecutionInput): Promise<AdmitExecutionResult> {
    if (this.unavailable) {
      return { admitted: true };
    }
    try {
      // Single atomic statement: capacity gates + insert. Same-conversation
      // and per-message exclusivity are hard-enforced by the partial unique
      // indexes (uq_conversation_executions_running_conversation /
      // uq_conversation_executions_message) even under concurrent races.
      const result = await this.db.execute(sql`
        INSERT INTO conversation.conversation_executions
          (id, conversation_id, user_id, message_id, owner_replica_id, status, expires_at)
        SELECT
          ${input.executionId}::char(24),
          ${input.conversationId}::char(24),
          ${input.userId}::char(24),
          ${input.messageId}::char(24),
          ${input.ownerReplicaId},
          'running',
          ${input.expiresAt.toISOString()}::timestamptz
        WHERE
          (SELECT count(*) FROM conversation.conversation_executions
            WHERE status = 'running' AND expires_at > now()
              AND user_id = ${input.userId}::char(24)) < ${input.maxActiveRunsPerUser}
          AND (SELECT count(*) FROM conversation.conversation_executions
            WHERE status = 'running' AND expires_at > now()) < ${input.maxActiveRunsFleet}
        RETURNING id
      `);
      if ((result.rowCount ?? 0) === 1) {
        return { admitted: true };
      }
      return { admitted: false, reason: 'capacity' };
    } catch (error) {
      const conflict = this.classifyConflict(error);
      if (conflict) {
        return { admitted: false, reason: conflict };
      }
      if (this.markUnavailableOnMissingTable(error)) {
        // Migration 0011 not applied yet: degrade to process-local limits
        // rather than breaking every stream.
        return { admitted: true };
      }
      throw error;
    }
  }

  async extendExpiry(messageId: string, expiresAt: Date): Promise<void> {
    if (this.unavailable) return;
    try {
      await this.db.execute(sql`
        UPDATE conversation.conversation_executions
        SET expires_at = ${expiresAt.toISOString()}::timestamptz, updated_at = now()
        WHERE message_id = ${messageId}::char(24) AND status = 'running'
      `);
    } catch (error) {
      this.markUnavailableOnMissingTable(error);
    }
  }

  async isCancelRequested(messageId: string): Promise<boolean> {
    if (this.unavailable) return false;
    try {
      const result = await this.db.execute(sql`
        SELECT 1 FROM conversation.conversation_executions
        WHERE message_id = ${messageId}::char(24)
          AND status = 'running'
          AND cancel_requested_at IS NOT NULL
        LIMIT 1
      `);
      return (result.rowCount ?? 0) === 1;
    } catch (error) {
      this.markUnavailableOnMissingTable(error);
      return false;
    }
  }

  async requestCancel(messageId: string): Promise<boolean> {
    if (this.unavailable) return false;
    try {
      const result = await this.db.execute(sql`
        UPDATE conversation.conversation_executions
        SET cancel_requested_at = now(), updated_at = now()
        WHERE message_id = ${messageId}::char(24) AND status = 'running'
      `);
      return (result.rowCount ?? 0) === 1;
    } catch (error) {
      this.markUnavailableOnMissingTable(error);
      return false;
    }
  }

  async finalizeByMessage(messageId: string): Promise<void> {
    if (this.unavailable) return;
    try {
      // Status mirrors the message's durable execution state; a message that
      // has no execution metadata finalizes as 'failed' rather than staying
      // 'running' forever.
      await this.db.execute(sql`
        UPDATE conversation.conversation_executions e
        SET status = COALESCE(m.execution_status, 'failed'),
            terminal_at = now(),
            updated_at = now()
        FROM conversation.messages m
        WHERE e.message_id = ${messageId}::char(24)
          AND e.status = 'running'
          AND m.id = e.message_id
      `);
    } catch (error) {
      this.markUnavailableOnMissingTable(error);
    }
  }

  async finalizeExpired(now: Date): Promise<number> {
    if (this.unavailable) return 0;
    try {
      const result = await this.db.execute(sql`
        UPDATE conversation.conversation_executions e
        SET status = COALESCE(
              CASE WHEN m.execution_status IN ('running', 'starting') OR m.execution_status IS NULL
                   THEN 'interrupted' ELSE m.execution_status END,
              'interrupted'),
            terminal_at = now(),
            updated_at = now()
        FROM conversation.messages m
        WHERE e.status = 'running'
          AND e.expires_at < ${now.toISOString()}::timestamptz
          AND m.id = e.message_id
      `);
      return result.rowCount ?? 0;
    } catch (error) {
      this.markUnavailableOnMissingTable(error);
      return 0;
    }
  }

  private classifyConflict(error: unknown): ConversationExecutionConflictReason | null {
    const candidate = error as PgErrorShape | null;
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

  private markUnavailableOnMissingTable(error: unknown): boolean {
    const candidate = error as PgErrorShape | null;
    if (candidate?.code === '42P01') {
      if (!this.unavailable) {
        this.unavailable = true;
        // Error level: a skipped migration silently removes cross-replica
        // conversation exclusivity and fleet caps for this process.
        this.logger.error(
          'conversation.conversation_executions missing — migration 0011 not applied. Fleet admission is DISABLED for this process; apply the migration and restart to restore cross-replica enforcement.',
        );
      }
      return true;
    }
    return false;
  }
}

/** New execution row id (24-hex, matching the conversation id conventions). */
export function newExecutionId(): string {
  return randomUUID().replaceAll('-', '').slice(0, 24);
}

