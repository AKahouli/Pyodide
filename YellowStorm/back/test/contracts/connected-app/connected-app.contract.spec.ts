import 'reflect-metadata';
import { expectContract } from '../expect-contract';
import { toWire, callPrivate, expectNoMongoKeys, expectNoKeys } from '../wire-helpers';
import { ConnectedAppDefinitionService } from '@modules/connected-app/services/connected-app-definition.service';
import { ConnectedAppUserService } from '@modules/connected-app/services/connected-app-user.service';
import { InMemoryConnectionStore } from '@modules/connected-app/persistence/connected-app.store.fake';
import type { ConnectedAppDefinitionRow } from '@modules/connected-app/persistence/connected-app.store';

const definition: ConnectedAppDefinitionRow = {
  id: '64b000000000000000000901',
  appKey: 'microsoft',
  displayName: 'Microsoft',
  description: 'Microsoft 365',
  iconKey: 'microsoft',
  authorizationUrl: 'https://login.example.test/authorize',
  tokenUrl: 'https://login.example.test/token',
  revokeUrl: 'https://login.example.test/revoke',
  clientId: 'REAL-CLIENT-ID',
  clientSecret: 'REAL-CLIENT-SECRET',
  tenantId: 'REAL-TENANT',
  scopes: ['offline_access', 'User.Read'],
  pkceEnabled: true,
  enabled: true,
  sortOrder: 1,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

describe('connected-app contracts', () => {
  it('admin definition response masks clientId / clientSecret / tenantId', () => {
    const body = toWire(callPrivate(ConnectedAppDefinitionService, 'toAdminResponse', [definition, 3]));
    expectContract('connected-app/definition-admin', body);
    expect(body.id).toBe(definition.id);
    expect(body.clientId).toBe('****');
    expect(body.clientSecret).toBe('****');
    expect(body.tenantId).toBe('****');
    expect(JSON.stringify(body)).not.toMatch(/REAL-/);
    expectNoMongoKeys(body);
  });

  it('a definition without tenant omits tenantId rather than masking nothing', () => {
    const body = toWire(callPrivate(ConnectedAppDefinitionService, 'toAdminResponse', [{ ...definition, tenantId: null }]));
    expect(body).not.toHaveProperty('tenantId');
    expect(body.clientSecret).toBe('****');
  });

  it('user connection response never contains tokens', async () => {
    const store = new InMemoryConnectionStore();
    store.seed({
      userId: 'u1',
      appKey: 'microsoft',
      accessToken: 'SECRET-ACCESS',
      refreshToken: 'SECRET-REFRESH',
      scopes: ['User.Read'],
      providerEmail: 'user-1@example.test',
      providerAccountId: 'acct-1',
    });
    const service = new ConnectedAppUserService(
      store,
      { findAllEnabled: async () => [definition] } as never,
      { setContext: jest.fn() } as never,
    );
    const body = toWire<any[]>(await service.getUserConnections('u1'));
    expect(body).toHaveLength(1);
    expectContract('connected-app/user-connection', body[0]);
    expect(JSON.stringify(body)).not.toMatch(/SECRET-/);
    expectNoKeys(body, 'accessToken', 'refreshToken', 'tokenExpiresAt', 'userId', 'providerAccountId');
    expectNoMongoKeys(body);
  });
});
