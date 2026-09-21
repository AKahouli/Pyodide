import { SemanticDataTokenService, signHs256 } from './semantic-data-token.service';

const decode = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
const grant = {
  grantId: '11111111-1111-4111-8111-111111111111',
  scopeHash: 'scope-hash',
  jti: '22222222-2222-4222-8222-222222222222',
  expiresAt: new Date(Date.now() + 60_000),
};

const serviceWith = (config: Record<string, unknown>, issue = jest.fn().mockResolvedValue(grant)) => ({
  service: new SemanticDataTokenService(
    config as never,
    { issue } as never,
    { setContext: jest.fn() } as never,
  ),
  issue,
});

const baseConfig = {
  dataApiEnabled: true,
  realtimeEnabled: true,
  dataJwtSecret: 'data-secret',
  realtimeJwtSecret: 'realtime-secret',
  dataTokenTtlSeconds: 60,
  dataRestUrl: 'http://127.0.0.1:3000',
  dataRealtimeUrl: 'ws://127.0.0.1:4000',
};

describe('SemanticDataTokenService', () => {
  it('mints grant-scoped data and model-scoped realtime tokens', async () => {
    const { service, issue } = serviceWith(baseConfig);
    const issued = await service.issue('user-1', 'model-9');
    expect(issue).toHaveBeenCalledWith('user-1', 'model-9', 60);
    expect(decode(issued.token!)).toMatchObject({
      sub: 'user-1', role: 'semantic_api_user', model_id: 'model-9',
      grant_id: grant.grantId, scope_hash: grant.scopeHash, jti: grant.jti,
      iss: 'yellowmind', aud: 'yellowmind-semantic-data',
    });
    expect(decode(issued.realtimeToken!)).toMatchObject({ sub: 'user-1', role: 'authenticated', model_id: 'model-9' });
    expect(issued.capabilities).toEqual({ dataApi: true, realtime: true });
  });

  it('does not mint tokens when the data API is disabled', async () => {
    const { service, issue } = serviceWith({ ...baseConfig, dataApiEnabled: false, realtimeEnabled: false });
    await expect(service.issue('user-1', 'model-9')).resolves.toMatchObject({
      capabilities: { dataApi: false, realtime: false }, token: null, realtimeToken: null,
    });
    expect(issue).not.toHaveBeenCalled();
  });

  it('omits realtime credentials when realtime is disabled', async () => {
    const { service } = serviceWith({ ...baseConfig, realtimeEnabled: false, realtimeJwtSecret: '' });
    await expect(service.issue('user-1', 'model-9')).resolves.toMatchObject({
      capabilities: { dataApi: true, realtime: false }, realtimeToken: null, realtimeUrl: null, topic: null,
    });
  });

  it('fails closed when an enabled data-plane secret is unconfigured', async () => {
    const { service } = serviceWith({ ...baseConfig, dataJwtSecret: '' });
    await expect(service.issue('user-1', 'model-9')).rejects.toThrow('not configured');
  });

  it('signs verifiable HS256 tokens', () => {
    expect(signHs256('s', { sub: 'u' }).split('.')).toHaveLength(3);
  });
});
