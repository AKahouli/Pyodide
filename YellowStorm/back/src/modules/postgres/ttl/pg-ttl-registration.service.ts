import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PgTtlSweeper } from './pg-ttl-sweeper.service';

/**
 * Registers every Postgres TTL sweep (plans 1A.6 / 1B.1.4 / 1B.2.4 /
 * remediation 3.7), replacing the Mongo TTL indexes on sessions, oauth_states,
 * provider_link_tokens, audit_logs, notifications, health_history, both OAuth
 * state tables, telegram_link_codes and upload_sessions (retention: audit
 * history is swept by age — created_at older than 730 days — via the sweeper's
 * olderThan mode from step 0.4).
 */
@Injectable()
export class PgTtlRegistrationService implements OnModuleInit {
  constructor(
    private readonly sweeper: PgTtlSweeper,
    @Optional() private readonly config?: ConfigService,
  ) {}

  onModuleInit(): void {
    this.sweeper.register({ schema: 'identity', table: 'sessions', column: 'expires_at' });
    this.sweeper.register({ schema: 'identity', table: 'oauth_states', column: 'expires_at' });
    this.sweeper.register({ schema: 'identity', table: 'provider_link_tokens', column: 'expires_at' });
    this.sweeper.register({
      schema: 'authz',
      table: 'audit_logs',
      column: 'created_at',
      olderThan: '730 days',
    });
    this.sweeper.register({ schema: 'ops', table: 'notifications', column: 'expires_at' });
    this.sweeper.register({ schema: 'ops', table: 'health_history', column: 'expire_at' });
    this.sweeper.register({ schema: 'integrations', table: 'connected_app_oauth_states', column: 'expires_at' });
    this.sweeper.register({ schema: 'integrations', table: 'admin_connector_oauth_states', column: 'expires_at' });
    this.sweeper.register({ schema: 'channels', table: 'telegram_link_codes', column: 'expires_at' });
    this.sweeper.register({ schema: 'workspace', table: 'upload_sessions', column: 'expires_at' });
    // Playbook-flow rows that expired by TTL in Mongo: execution slots, idempotency records and the short-lived assistant rows.
    for (const table of ['execution_leases', 'idempotency_records', 'assistant_requests', 'assistant_operations', 'assistant_messages', 'assistant_revisions']) {
      this.sweeper.register({ schema: 'playbook', table, column: 'expires_at' });
    }
    // Application logs: retention by age (the Mongo TTL index on logs.createdAt), 30 days unless configured.
    this.sweeper.register({
      schema: 'ops',
      table: 'logs',
      column: 'created_at',
      olderThan: `${String(this.config?.get<number>('logging.retentionDays', 30) ?? 30)} days`,
    });
  }
}
