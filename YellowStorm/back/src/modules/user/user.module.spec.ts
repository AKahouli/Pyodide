import { UserModule } from './user.module';
import { PgUserLookupAdapter } from './adapters/pg-user-lookup.adapter';
import { USER_LOOKUP_PORT } from '@common/ports/user-lookup.port';

/**
 * DB-free wiring guard: the lookup port must stay bound to the Postgres
 * adapter (remediation plan step 1.2 — this is the regression test the
 * original cutover lacked).
 */
describe('UserModule wiring', () => {
  it('binds USER_LOOKUP_PORT to PgUserLookupAdapter', () => {
    const providers = Reflect.getMetadata('providers', UserModule) as Array<Record<string, unknown>>;
    const binding = providers.find((p) => p && p.provide === USER_LOOKUP_PORT);
    expect(binding).toBeDefined();
    expect(binding!.useExisting).toBe(PgUserLookupAdapter);
  });
});
