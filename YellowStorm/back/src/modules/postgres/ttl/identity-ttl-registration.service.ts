import { Injectable, OnModuleInit } from '@nestjs/common';
import { PgTtlSweeper } from './pg-ttl-sweeper.service';

/**
 * Registers the identity- and ops-phase TTL sweeps (plans 1A.6/1B.1.4/1B.2.4),
 * replacing the Mongo TTL indexes on sessions, oauth_states,
 * provider_link_tokens, audit_logs, notifications and health_history
 * (retention: audit history is swept by age — created_at older than 730 days —
 * via the sweeper's olderThan mode from step 0.4).
 */
@Injectable()
export class IdentityTtlRegistrationService implements OnModuleInit {
  constructor(private readonly sweeper: PgTtlSweeper) {}

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
  }
}
