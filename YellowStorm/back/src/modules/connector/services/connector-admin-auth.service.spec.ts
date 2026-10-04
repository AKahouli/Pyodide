import { BadRequestException, NotFoundException } from '../../exceptions';
import { ConnectorAdminAuthService } from './connector-admin-auth.service';

/** Non-refresh paths (the refresh/single-flight paths live in the .refresh integration spec). */
describe('ConnectorAdminAuthService (unit)', () => {
  const def = {
    appKey: 'app', authorizationUrl: 'https://auth.test/authorize', tokenUrl: 'https://token.test', revokeUrl: 'https://revoke.test',
    clientId: 'cid', clientSecret: 'sec', scopes: ['a', 'b'], pkceEnabled: true,
  };
  let stateStore: Record<string, jest.Mock>;
  let authStore: Record<string, jest.Mock>;
  let definitions: { findByKey: jest.Mock };
  let service: ConnectorAdminAuthService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    stateStore = { create: jest.fn(), consume: jest.fn(), exists: jest.fn() };
    authStore = {
      findByUserAndApp: jest.fn(), findConnected: jest.fn(), upsertOnCallback: jest.fn(),
      touchLastUsedThrottled: jest.fn(), markDisconnected: jest.fn(),
    };
    definitions = { findByKey: jest.fn().mockResolvedValue(def) };
    const config = { get: (k: string, d?: string) => (k === 'app.frontendUrl' ? 'http://front.test' : k === 'app.backendUrl' ? 'http://back.test' : d) };
    const crypto = { encrypt: (v: string) => `enc:${v}`, decrypt: (v: string) => v.replace(/^enc:/, '') };
    service = new ConnectorAdminAuthService(
      stateStore as never, authStore as never, {} as never, crypto as never, config as never,
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as never, definitions as never,
    );
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => { fetchSpy.mockRestore(); });

  it('buildAuthorizationUrl persists a PKCE state and returns a provider URL with matching state/challenge', async () => {
    const url = new URL(await service.buildAuthorizationUrl('u1', 'app'));
    const saved = stateStore.create.mock.calls[0][0];
    expect(url.origin + url.pathname).toBe('https://auth.test/authorize');
    expect(url.searchParams.get('state')).toBe(saved.state);
    expect(url.searchParams.get('scope')).toBe('a b');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toContain('/v1/connected-apps/app/callback');
    expect(saved).toMatchObject({ appKey: 'app', userId: 'u1' });
    expect(saved.codeVerifier).toEqual(expect.any(String));
    expect(saved.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('buildAuthorizationUrl omits PKCE when the app disables it', async () => {
    definitions.findByKey.mockResolvedValue({ ...def, pkceEnabled: false });
    const url = new URL(await service.buildAuthorizationUrl('u1', 'app'));
    expect(url.searchParams.has('code_challenge')).toBe(false);
    expect(stateStore.create.mock.calls[0][0].codeVerifier).toBeUndefined();
  });

  it('handleCallback rejects unknown/expired state and app-key mismatch without calling the provider', async () => {
    stateStore.consume.mockResolvedValue(null);
    await expect(service.handleCallback('app', 'code', 's')).rejects.toBeInstanceOf(BadRequestException);
    stateStore.consume.mockResolvedValue({ appKey: 'other', userId: 'u1', codeVerifier: null });
    await expect(service.handleCallback('app', 'code', 's')).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('handleCallback exchanges the code and stores ENCRYPTED tokens for the state owner', async () => {
    stateStore.consume.mockResolvedValue({ appKey: 'app', userId: 'u9', codeVerifier: 'ver' });
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 60 }) } as never);

    await expect(service.handleCallback('app', 'code', 's')).resolves.toEqual({ success: true, appKey: 'app' });

    const body = new URLSearchParams(fetchSpy.mock.calls[0][1].body as string);
    expect(body.get('code_verifier')).toBe('ver');
    expect(body.get('code')).toBe('code');
    expect(authStore.upsertOnCallback).toHaveBeenCalledWith('u9', 'app', expect.objectContaining({
      accessToken: 'enc:AT', refreshToken: 'enc:RT', scopes: ['a', 'b'],
    }));
  });

  it('handleCallback fails on provider error / missing access token and stores nothing', async () => {
    stateStore.consume.mockResolvedValue({ appKey: 'app', userId: 'u1', codeVerifier: null });
    fetchSpy.mockResolvedValueOnce({ ok: false } as never);
    await expect(service.handleCallback('app', 'c', 's')).rejects.toBeInstanceOf(BadRequestException);
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ error: 'invalid_grant' }) } as never);
    await expect(service.handleCallback('app', 'c', 's')).rejects.toBeInstanceOf(BadRequestException);
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ token_type: 'x' }) } as never);
    await expect(service.handleCallback('app', 'c', 's')).rejects.toBeInstanceOf(BadRequestException);
    expect(authStore.upsertOnCallback).not.toHaveBeenCalled();
  });

  it('getStatus maps a record and reports disconnected when absent', async () => {
    authStore.findByUserAndApp.mockResolvedValue(null);
    expect(await service.getStatus('u', 'app')).toMatchObject({ appKey: 'app', connected: false });
    const createdAt = new Date();
    authStore.findByUserAndApp.mockResolvedValue({ connected: true, status: 'active', createdAt, disconnectedAt: null, providerEmail: 'e@x.test' });
    expect(await service.getStatus('u', 'app')).toMatchObject({ connected: true, status: 'active', connectedAt: createdAt, providerEmail: 'e@x.test' });
  });

  it('getValidToken 404s when not connected, and returns the decrypted token for a fresh one', async () => {
    authStore.findConnected.mockResolvedValue(null);
    await expect(service.getValidToken('u', 'app')).rejects.toBeInstanceOf(NotFoundException);
    authStore.findConnected.mockResolvedValue({ id: 'r1', accessToken: 'enc:live', tokenExpiresAt: new Date(Date.now() + 3600_000) });
    await expect(service.getValidToken('u', 'app')).resolves.toBe('live');
    expect(authStore.touchLastUsedThrottled).toHaveBeenCalledWith('r1');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('disconnect 404s when there is no record; otherwise revokes best-effort and always marks revoked', async () => {
    authStore.findByUserAndApp.mockResolvedValue(null);
    await expect(service.disconnect('u', 'app')).rejects.toBeInstanceOf(NotFoundException);

    authStore.findByUserAndApp.mockResolvedValue({ id: 'r1', accessToken: 'enc:tok' });
    fetchSpy.mockRejectedValue(new Error('network down'));
    await service.disconnect('u', 'app');
    expect(fetchSpy).toHaveBeenCalledWith('https://revoke.test', expect.objectContaining({ method: 'POST' }));
    expect(authStore.markDisconnected).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'revoked', disconnectedAt: expect.any(Date) }));
  });

  it('buildCallbackHtml never reflects raw markup from the error message', () => {
    const html = service.buildCallbackHtml('app', false, '<script>alert(1)</script>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });
});
