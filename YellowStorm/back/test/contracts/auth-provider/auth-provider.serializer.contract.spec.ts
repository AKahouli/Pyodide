import 'reflect-metadata';
import { Types } from 'mongoose';
import { AuthProviderSchema } from '@modules/auth-provider/schemas/auth-provider.schema';
import { expectContract, hydrateDoc } from '../expect-contract';


/**
 * Serializer contract for Mongo `auth_providers` — parity gate for the 1A
 * mapper: OAuth client credentials must serialize as the literal '****'.
 */
const wire = (): Record<string, unknown> =>
  JSON.parse(
    JSON.stringify(
      hydrateDoc(AuthProviderSchema, {
        _id: new Types.ObjectId('64b000000000000000000040'),
        providerKey: 'microsoft',
        displayName: 'Microsoft',
        clientId: 'encrypted-client-id-should-mask',
        clientSecret: 'encrypted-client-secret-should-mask',
        tenantId: 'encrypted-tenant-id-should-mask',
        authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        userinfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
        scopes: ['openid', 'email', 'profile'],
        iconKey: 'microsoft',
        sortOrder: 0,
        pkceEnabled: true,
        enabled: true,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-15T00:00:00Z'),
      }).toJSON(),
    ),
  );

describe('auth-provider serializer contract', () => {
  it('matches the recorded Mongo toJSON shape', () => {
    const body = wire();
    expectContract('auth-provider/auth-provider.serializer', body);
    expect(body.clientId).toBe('****');
    expect(body.clientSecret).toBe('****');
    expect(body.tenantId).toBe('****');
    expect(body).not.toHaveProperty('_id');
    expect(body).not.toHaveProperty('__v');
  });
});
