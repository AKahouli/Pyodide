import { Injectable, OnModuleInit } from '@nestjs/common';
import { PgTtlSweeper } from '@modules/postgres/ttl/pg-ttl-sweeper.service';

/**
 * Registers the Conversation TTL tables with the shared PgTtlSweeper, which
 * owns the cron and the deletion logic (formerly duplicated here).
 */
@Injectable()
export class PostgresConversationExpiryService implements OnModuleInit {
  constructor(private readonly sweeper: PgTtlSweeper) {}

  onModuleInit(): void {
    this.sweeper.register({ schema: 'conversation', table: 'shared_conversations', column: 'expires_at' });
    this.sweeper.register({ schema: 'conversation', table: 'conversation_playbook_handoffs', column: 'expires_at' });
  }
}
