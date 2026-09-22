import { PgTtlSweeper } from './pg-ttl-sweeper.service';
import { PgTtlRegistrationService } from './pg-ttl-registration.service';

/** Remediation 3.7: the full TTL sweep registry is asserted, not incidental. */
describe('PgTtlRegistrationService', () => {
  it('registers the complete list of (schema, table, column) sweeps', () => {
    const registered: Array<Record<string, unknown>> = [];
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
    ]);
  });
});
