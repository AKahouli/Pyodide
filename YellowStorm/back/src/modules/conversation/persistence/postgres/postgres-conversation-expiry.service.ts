import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { LoggerService } from '@modules/logger';

const CLEANUP_BATCH_SIZE = 1000;

@Injectable()
export class PostgresConversationExpiryService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('PostgresConversationExpiryService');
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpired(): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`
          DELETE FROM conversation.shared_conversations
          WHERE id IN (
            SELECT id
            FROM conversation.shared_conversations
            WHERE expires_at IS NOT NULL AND expires_at <= now()
            ORDER BY expires_at
            LIMIT ${CLEANUP_BATCH_SIZE}
            FOR UPDATE SKIP LOCKED
          )
        `);
        await tx.execute(sql`
          DELETE FROM conversation.conversation_playbook_handoffs
          WHERE id IN (
            SELECT id
            FROM conversation.conversation_playbook_handoffs
            WHERE expires_at <= now()
            ORDER BY expires_at
            LIMIT ${CLEANUP_BATCH_SIZE}
            FOR UPDATE SKIP LOCKED
          )
        `);
      });
    } catch (error: unknown) {
      this.logger.error('Failed to clean up expired Conversation records', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
