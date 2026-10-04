import { PgTtlSweeper } from './pg-ttl-sweeper.service';
import { PgTtlRegistrationService } from './pg-ttl-registration.service';

/** Remediation 3.7: the full TTL sweep registry is asserted, not incidental. */
describe('PgTtlRegistrationService', () => {
  it('registers the complete list of (schema, table, column) sweeps', () => {
    const registered: Record<string, unknown>[] = [];
    const sweeper = { register: (spec: Record<string, unknown>) => registered.push(spec) } as unknown as PgTtlSweeper;

    new PgTtlRegistrationService(sweeper).onModuleInit();

    expect(registered).toEqual([
      { schema: 'identity', table: 'sessions', column: 'expires_at' },
      { schema: 'identity', table: 'oauth_states', column: 'expires_at' },
      { schema: 'identity', table: 'provider_link_tokens', column: 'expires_at' },
      { schema: 'authz', table: 'audit_logs', column: 'created_at', olderThan: '730 days' },
      { schema: 'ops', table: 'notifications', column: 'expires_at' },
      { schema: 'ops', table: 'health_history', column: 'expire_at' },
      { schema: 'integrations', table: 'connected_app_oauth_states', column: 'expires_at' },
      { schema: 'integrations', table: 'admin_connector_oauth_states', column: 'expires_at' },
      { schema: 'channels', table: 'telegram_link_codes', column: 'expires_at' },
      { schema: 'workspace', table: 'upload_sessions', column: 'expires_at' },
      { schema: 'playbook', table: 'execution_leases', column: 'expires_at' },
      { schema: 'playbook', table: 'idempotency_records', column: 'expires_at' },
      { schema: 'playbook', table: 'assistant_requests', column: 'expires_at' },
      { schema: 'playbook', table: 'assistant_operations', column: 'expires_at' },
      { schema: 'playbook', table: 'assistant_messages', column: 'expires_at' },
      { schema: 'playbook', table: 'assistant_revisions', column: 'expires_at' },
      { schema: 'ops', table: 'logs', column: 'created_at', olderThan: '30 days' },
    ]);
  });

  it('keeps the logs for the configured number of days', () => {
    const registered: Record<string, unknown>[] = [];
    const sweeper = { register: (spec: Record<string, unknown>) => registered.push(spec) } as unknown as PgTtlSweeper;
    const config = { get: (_key: string, fallback: number) => (_key === 'logging.retentionDays' ? 2 : fallback) };

    new PgTtlRegistrationService(sweeper, config as never).onModuleInit();

    expect(registered.at(-1)).toEqual({ schema: 'ops', table: 'logs', column: 'created_at', olderThan: '2 days' });
  });
});
