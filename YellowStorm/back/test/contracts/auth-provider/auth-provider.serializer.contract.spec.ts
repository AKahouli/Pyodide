import 'reflect-metadata';
import { AuthProviderService } from '@modules/auth-provider/services/auth-provider.service';
import { providerRecord } from '@modules/auth-provider/persistence/auth-provider-stores.fake';
import { expectContract } from '../expect-contract';

/** Admin response contract for auth providers: OAuth credentials must serialize as the literal '****'. */
const wire = (): Record<string, unknown> => {
  const service = Object.create(AuthProviderService.prototype) as unknown as {
    toAdminResponse(p: unknown, linked: number): unknown;
  };
  return JSON.parse(
    JSON.stringify(
      service.toAdminResponse(
        providerRecord({
          id: '64b000000000000000000040',
          clientId: 'encrypted-client-id-should-mask',
          clientSecret: 'encrypted-client-secret-should-mask',
          tenantId: 'encrypted-tenant-id-should-mask',
          authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
          tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
          userinfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-15T00:00:00Z'),
        }),
        3,
      ),
    ),
  );
};

describe('auth-provider serializer contract', () => {
  it('matches the recorded admin wire shape', () => {
    const body = wire();
    expectContract('auth-provider/auth-provider.serializer', body);
    expect(body.clientId).toBe('****');
    expect(body.clientSecret).toBe('****');
    expect(body.tenantId).toBe('****');
    expect(JSON.stringify(body)).not.toContain('should-mask');
    expect(body).not.toHaveProperty('_id');
  });
});
