import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sign } from 'jsonwebtoken';
import { McpJwtService } from './mcp-jwt.service';
import { assertMcpDestinationAllowed } from '../utils/mcp-destination-policy.util';

jest.mock('node:fs', () => ({ ...jest.requireActual('node:fs'), readFileSync: jest.fn() }));
jest.mock('../utils/mcp-destination-policy.util', () => ({ ...jest.requireActual('../utils/mcp-destination-policy.util'), assertMcpDestinationAllowed: jest.fn() }));

describe('McpJwtService current-policy boundary', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const users = { findById: jest.fn() };
  const store = { findById: jest.fn() };
  const authorization = { getUserRoles: jest.fn(), getUserPermissions: jest.fn() };
  const workspaces = { readableWorkspaceScope: jest.fn(), assertUserHasAccess: jest.fn() };
  let row: Record<string, unknown>;
  let service: McpJwtService;
  let values: Record<string, unknown>;
  beforeEach(() => {
    jest.clearAllMocks();
    row = { id: 'connector-1', isActive: true, mcpTransportType: 'streamable_http',
      mcpServerUrl: 'https://example.com/mcp', securityRevision: 1,
      mcpSecurityPolicy: { version: 1, profile: 'internal_jwt', audience: 'recipient',
        actorDelegation: 'verified_user', allowPrivateNetwork: false, allowInsecureHttp: false, requiredPermissions: [] } };
    users.findById.mockResolvedValue({ id: 'user-1', status: 'active' });
    store.findById.mockImplementation(async id => id === row.id ? row : null);
    authorization.getUserRoles.mockResolvedValue([]);
    authorization.getUserPermissions.mockResolvedValue([]);
    workspaces.readableWorkspaceScope.mockResolvedValue(['a'.repeat(24), 'b'.repeat(24)]);
    workspaces.assertUserHasAccess.mockResolvedValue(undefined);
    (readFileSync as jest.Mock).mockReturnValue(privateKey.export({ type: 'pkcs8', format: 'pem' }));
    values = { MCP_JWT_PRIVATE_KEY_FILE: 'key.pem', MCP_JWT_ISSUER: 'issuer' };
    service = new McpJwtService({ get: (name: string, fallback?: unknown) => values[name] ?? fallback } as never,
      users as never, store as never, authorization as never, workspaces as never);
  });
  it.each(['configured', 'public'])('preserves %s SSE binding without granting JWT authority', async profile => {
    row.mcpTransportType = 'sse';
    row.mcpSecurityPolicy = { version: 1, profile, actorDelegation: 'none', allowPrivateNetwork: false, allowInsecureHttp: false, requiredPermissions: [] };
    const headers: Record<string, string> = profile === 'configured' ? { Authorization: 'Bearer saved' } : { Accept: 'text/event-stream' };
    const bound = await service.bindingAuth(row.mcpServerUrl as string, 'user-1', 'connector-1', headers, {});
    expect(bound).toEqual({ headers, env: {} });
    expect(assertMcpDestinationAllowed).toHaveBeenCalled();
    expect(users.findById).toHaveBeenCalledWith('user-1');
    await expect(service.issue('connector-1', 'user-1')).rejects.toThrow();
  });
  it('continues to reject SSE for internal JWT', async () => {
    row.mcpTransportType = 'sse';
    await expect(service.issue('connector-1', 'user-1')).rejects.toThrow();
  });
  it.each(['Bearer provider', 'Basic provider'])('preserves unrelated configured auth %s without minting a workspace assertion', async credential => {
    row.mcpSecurityPolicy = { version: 1, profile: 'configured', actorDelegation: 'none',
      allowPrivateNetwork: false, allowInsecureHttp: false, requiredPermissions: [] };
    const existing = { Authorization: credential, 'X-Provider-Token': 'independent-provider' };
    expect(await service.headers(row.mcpServerUrl as string, 'user-1', existing, 'connector-1')).toEqual(existing);
    expect(workspaces.readableWorkspaceScope).not.toHaveBeenCalled();
  });
  it.each(['?token=TEST_CANARY_R03', '?%74oken=TEST_CANARY_R03', '#TEST_CANARY_R03'])
  ('denies legacy unsafe endpoints before browser token issuance: %s', async suffix => {
    row.mcpServerUrl = `https://example.com/mcp${suffix}`;
    let failure: unknown;
    try { await service.issue('connector-1', 'user-1'); } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(JSON.stringify(failure)).not.toContain('TEST_CANARY_R03');
    expect(users.findById).not.toHaveBeenCalled();
  });
  it('validates the original bracketed IPv6 destination and raw exact exception without canonical reparsing', async () => {
    const endpoint = 'http://[::1]:8027/Mcp';
    row.mcpServerUrl = endpoint;
    row.mcpSecurityPolicy = { ...row.mcpSecurityPolicy as object, allowPrivateNetwork: true };
    await service.checkDestination(row as never);
    expect(assertMcpDestinationAllowed).toHaveBeenLastCalledWith(endpoint,
      expect.objectContaining({ allowExactEndpoints: [endpoint] }));
  });
  it.each([false, true])('requires canonical signer config regardless of legacy settings (%s)', async shared => {
    values = { SEMANTIC_MODEL_MCP_JWT_PRIVATE_KEY_FILE: 'legacy.pem', SEMANTIC_MODEL_MCP_JWT_ISSUER: 'legacy-issuer',
      ...(shared ? { MCP_JWT_PRIVATE_KEY_FILE: 'shared.pem', MCP_JWT_ISSUER: 'shared-issuer' } : {}) };
    const compatible = new McpJwtService({ get: (name: string, fallback?: unknown) => values[name] ?? fallback } as never,
      users as never, store as never, authorization as never);
    if (!shared) {
      await expect(compatible.issue('connector-1', 'user-1')).rejects.toThrow();
      expect(readFileSync).not.toHaveBeenCalledWith('legacy.pem');
      return;
    }
    expect(readFileSync).toHaveBeenLastCalledWith('shared.pem');
    const { token } = await compatible.issue('connector-1', 'user-1');
    expect(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).iss).toBe('shared-issuer');
    row.mcpSecurityPolicy = { version: 1, profile: 'configured', actorDelegation: 'none', allowPrivateNetwork: false, allowInsecureHttp: false, requiredPermissions: [] };
    await expect(compatible.issue('connector-1', 'user-1')).rejects.toThrow();
  });
  it.each(['production', 'development'])('limits insecure HTTP override in %s', async environment => {
    values.NODE_ENV = environment;
    values.MCP_EGRESS_ALLOW_INSECURE_HTTP = true;
    row.mcpServerUrl = 'http://8.8.8.8/mcp';
    // Exercise the real egress validator, not just the supplied option.
    (assertMcpDestinationAllowed as jest.Mock).mockImplementationOnce(
      jest.requireActual('../utils/mcp-destination-policy.util').assertMcpDestinationAllowed);
    const check = service.checkDestination(row as never);
    if (environment === 'production') await expect(check).rejects.toThrow(/https/);
    else await expect(check).resolves.toBeUndefined();
  });
  it.each(['production', 'development'])('limits the per-connector insecure HTTP grant to %s', async environment => {
    values.NODE_ENV = environment;
    values.MCP_EGRESS_ALLOW_INSECURE_HTTP = false;
    row.mcpServerUrl = 'http://8.8.8.8/mcp';
    row.mcpSecurityPolicy = { ...(row.mcpSecurityPolicy as Record<string, unknown>), allowInsecureHttp: true };
    (assertMcpDestinationAllowed as jest.Mock).mockImplementationOnce(
      jest.requireActual('../utils/mcp-destination-policy.util').assertMcpDestinationAllowed);
    const check = service.checkDestination(row as never);
    if (environment === 'production') await expect(check).rejects.toThrow(/https/);
    else await expect(check).resolves.toBeUndefined();
  });
  it('issues five-minute connector-bound claims and renews the proven actor', async () => {
    const issued = await service.issue('connector-1', 'user-1');
    const claims = JSON.parse(Buffer.from(issued.token.split('.')[1], 'base64url').toString());
    expect(claims).toMatchObject({ sub: 'user-1', connectorId: 'connector-1', securityRevision: 1, aud: 'recipient' });
    expect(claims.exp - claims.iat).toBe(300);
    expect(await service.verifyMcpAssertion(issued.token, 'recipient')).toEqual({ sub: 'user-1', connectorId: 'connector-1', aud: 'recipient' });
    const renewed = await service.renew('connector-1', issued.token);
    expect(renewed.token).not.toBe(issued.token);
    expect(JSON.parse(Buffer.from(renewed.token.split('.')[1], 'base64url').toString()).sub).toBe('user-1');
  });
  it('issues and renews a 180-second scope from fresh workspace permissions', async () => {
    row.mcpSecurityPolicy = { ...row.mcpSecurityPolicy as object, workspaceAuthorization: true };
    const issued = await service.issue('connector-1', 'user-1');
    const decode = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(decode(issued.token).workspaceScope).toEqual({ version: 1, permission: 'read', ids: ['a'.repeat(24), 'b'.repeat(24)] });
    expect(decode(issued.token).exp - decode(issued.token).iat).toBe(180);
    workspaces.readableWorkspaceScope.mockResolvedValueOnce(['a'.repeat(24)]);
    const renewed = await service.renew('connector-1', issued.token);
    expect(decode(renewed.token).workspaceScope.ids).toEqual(['a'.repeat(24)]);
    expect(workspaces.readableWorkspaceScope).toHaveBeenCalledWith('user-1');
  });
  it.each(['configured', 'internal_jwt'])('binds and renews %s workspace authority using only bearer JWT', async profile => {
    row.mcpSecurityPolicy = { ...row.mcpSecurityPolicy as object, profile, workspaceAuthorization: true };
    const bound = await service.bindingAuth(row.mcpServerUrl as string, 'user-1', 'connector-1', {}, {});
    expect(bound.headers.Authorization).toMatch(/^Bearer ey/);
    expect(bound.headers['X-YellowStorm-Mcp-Assertion']).toBeUndefined();
    expect(bound.env).toEqual({ YELLOWSTORM_MCP_JWT_CONNECTOR_ID: 'connector-1' });
    const proof = bound.headers.Authorization.slice(7);
    expect(await service.verifyMcpAssertion(proof, 'recipient')).toEqual({ sub: 'user-1', connectorId: 'connector-1', aud: 'recipient' });
    workspaces.readableWorkspaceScope.mockResolvedValueOnce(['a'.repeat(24)]);
    const renewed = await service.renew('connector-1', proof);
    expect(JSON.parse(Buffer.from(renewed.token.split('.')[1], 'base64url').toString()).workspaceScope.ids).toEqual(['a'.repeat(24)]);
    row.securityRevision = 2;
    await expect(service.renew('connector-1', renewed.token)).rejects.toThrow();
  });
  it('replaces saved/resolved legacy workspace credentials and assertions without dropping independent provider headers', async () => {
    row.mcpSecurityPolicy = { ...row.mcpSecurityPolicy as object, profile: 'configured', workspaceAuthorization: true };
    row.mcpServerConfig = { headers: { authorization: 'Bearer saved' } };
    const bound = await service.bindingAuth(row.mcpServerUrl as string, 'user-1', 'connector-1', {}, {});
    expect(bound.headers.Authorization).toMatch(/^Bearer ey/);
    const headers = await service.headers(row.mcpServerUrl as string, 'user-1', {
      Authorization: 'Bearer old', authorization: 'Bearer another',
      'x-yellowstorm-mcp-assertion': 'stale', 'X-Provider-Token': 'provider-token',
    }, 'connector-1');
    expect(Object.keys(headers).filter(key => key.toLowerCase() === 'authorization')).toEqual(['Authorization']);
    expect(headers.Authorization).toMatch(/^Bearer ey/);
    expect(headers['x-yellowstorm-mcp-assertion']).toBeUndefined();
    expect(headers['X-Provider-Token']).toBe('provider-token');
  });
  it.each(['configured', 'internal_jwt'])('binds native search with %s bearer JWT and rejects denied workspace batches', async profile => {
    row.mcpSecurityPolicy = { ...row.mcpSecurityPolicy as object, profile, workspaceAuthorization: true };
    const headers = await service.workspaceReadHeaders('connector-1', 'user-1', 'https://example.com/search_native/batch',
      ['a'.repeat(24), 'b'.repeat(24)], {});
    expect(headers['Workspace-Id']).toBe(['a'.repeat(24), 'b'.repeat(24)].join(','));
    expect(headers.Authorization).toMatch(/^Bearer ey/);
    expect(headers['X-YellowStorm-Mcp-Assertion']).toBeUndefined();
    await expect(service.workspaceReadHeaders('connector-1', 'user-1', 'https://evil.example/search_native',
      ['a'.repeat(24)], { Authorization: 'Bearer service' })).rejects.toThrow();
    workspaces.assertUserHasAccess.mockRejectedValueOnce(new Error('denied'));
    await expect(service.workspaceReadHeaders('connector-1', 'user-1', 'https://example.com/search_native',
      ['a'.repeat(24), 'b'.repeat(24)], { Authorization: 'Bearer service' })).rejects.toThrow('denied');
  });
  it.each([0, 301, 1.5, 'invalid'])('rejects invalid workspace lifetime %s', value => {
    values.MCP_WORKSPACE_SCOPE_TTL_SECONDS = value;
    expect(() => new McpJwtService({ get: (name: string, fallback?: unknown) => values[name] ?? fallback } as never,
      users as never, store as never, authorization as never, workspaces as never)).toThrow(/MCP_WORKSPACE_SCOPE_TTL_SECONDS/);
  });
  it('uses the configured scope lifetime without changing ordinary assertion lifetimes', async () => {
    values.MCP_WORKSPACE_SCOPE_TTL_SECONDS = 45;
    const configured = new McpJwtService({ get: (name: string, fallback?: unknown) => values[name] ?? fallback } as never,
      users as never, store as never, authorization as never, workspaces as never);
    row.mcpSecurityPolicy = { ...row.mcpSecurityPolicy as object, workspaceAuthorization: true };
    const { token } = await configured.issue('connector-1', 'user-1');
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(claims.exp - claims.iat).toBe(45);
  });
  it('rejects wrong audience and another connector renewal', async () => {
    const { token } = await service.issue('connector-1', 'user-1');
    expect(await service.verifyMcpAssertion(token, 'other')).toBeNull();
    row = { ...row, id: 'connector-2' };
    await expect(service.renew('connector-2', token)).rejects.toThrow();
  });
  it('verifies the ADR-0024 delegated credential without an audience fence, keeping connector and revision authority', async () => {
    const { token } = await service.issue('connector-1', 'user-1');
    // No per-route audience: the same credential is accepted on any internal route.
    expect(await service.verifyDelegatedActor(token)).toEqual({ sub: 'user-1', connectorId: 'connector-1', aud: 'recipient' });
    // Connector/revision authority is unchanged: a stale policy stops working.
    row.securityRevision = 2;
    expect(await service.verifyDelegatedActor(token)).toBeNull();
    // The audience-bound path (renewal) still requires its trusted audience.
    row.securityRevision = 1;
    expect(await service.verifyMcpAssertion(token, 'recipient')).toEqual({ sub: 'user-1', connectorId: 'connector-1', aud: 'recipient' });
    expect(await service.verifyMcpAssertion(token, '')).toBeNull();
  });
  it('verifies against a route-declared audience set during the platform migration', async () => {
    const { token } = await service.issue('connector-1', 'user-1');
    expect(await service.verifyMcpAssertion(token, ['recipient', 'mcp-platform']))
      .toEqual({ sub: 'user-1', connectorId: 'connector-1', aud: 'recipient' });
    expect(await service.verifyMcpAssertion(token, ['mcp-platform'])).toBeNull();
    expect(await service.verifyMcpAssertion(token, [])).toBeNull();
  });
  it('rejects expired proof and cannot bootstrap from arbitrary unsigned identity', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = sign({ sub: 'user-1', connectorId: 'connector-1', securityRevision: 1,
      iat: now - 301, exp: now - 1, jti: 'expired' }, privateKey, {
      algorithm: 'RS256', issuer: 'issuer', audience: 'recipient',
    });
    await expect(service.renew('connector-1', expired)).rejects.toThrow();
    await expect(service.renew('connector-1', 'user-2')).rejects.toThrow();
  });
  it.each(['revision', 'inactive', 'suspended', 'permissions', 'delegation'])('rejects current %s revocation', async kind => {
    const { token } = await service.issue('connector-1', 'user-1');
    if (kind === 'revision') row.securityRevision = 2;
    if (kind === 'inactive') row.isActive = false;
    if (kind === 'suspended') users.findById.mockResolvedValue({ status: 'suspended' });
    if (kind === 'permissions') row.mcpSecurityPolicy = { ...row.mcpSecurityPolicy as object, requiredPermissions: ['connectors.read'] };
    if (kind === 'delegation') row.mcpSecurityPolicy = { ...row.mcpSecurityPolicy as object, actorDelegation: 'none' };
    expect(await service.verifyMcpAssertion(token, 'recipient')).toBeNull();
  });
  it('requires exact canonical endpoint and never promotes a URL without connector authority', async () => {
    const original = { Authorization: 'existing' };
    expect(await service.headers(row.mcpServerUrl as string, 'user-1', original)).toBe(original);
    expect(store.findById).not.toHaveBeenCalled();
    for (const endpoint of ['https://example.com/MCP', 'https://example.com/mcp/other', 'https://example.com/mcp?q=1']) {
      await expect(service.headers(endpoint, 'user-1', original, 'connector-1')).rejects.toThrow();
    }
    await expect(service.issue('https://example.com/mcp', 'user-1')).rejects.toThrow();
  });
  it('checks egress before issuing and propagates denial', async () => {
    (assertMcpDestinationAllowed as jest.Mock).mockRejectedValueOnce(new Error('denied'));
    await expect(service.issue('connector-1', 'user-1')).rejects.toThrow('denied');
    expect(users.findById).not.toHaveBeenCalled();
  });
  it('overlaps fresh account and role reads, then checks permissions before issuing', async () => {
    let finishUser!: (value: unknown) => void;
    let finishRoles!: (value: unknown[]) => void;
    users.findById.mockReturnValueOnce(new Promise(resolve => { finishUser = resolve; }));
    authorization.getUserRoles.mockReturnValueOnce(new Promise(resolve => { finishRoles = resolve; }));
    const issuing = service.issue('connector-1', 'user-1');
    // Drain the load and destination checks without a wall-clock timing assertion.
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(users.findById).toHaveBeenCalledWith('user-1');
    expect(authorization.getUserRoles).toHaveBeenCalledWith('user-1');
    expect(authorization.getUserPermissions).not.toHaveBeenCalled();
    finishRoles([{ id: 'role-1' }]);
    finishUser({ id: 'user-1', status: 'active' });
    expect((await issuing).token).toBeTruthy();
    expect(authorization.getUserPermissions).toHaveBeenCalledWith(['role-1']);
  });
  it.each([null, { id: 'user-1', status: 'suspended' }])('retains account denial ahead of a concurrent role failure (%j)', async account => {
    users.findById.mockResolvedValueOnce(account);
    const roleFailure = new Error('role read failed');
    authorization.getUserRoles.mockRejectedValueOnce(roleFailure);
    await expect(service.issue('connector-1', 'user-1')).rejects.not.toBe(roleFailure);
    expect(authorization.getUserPermissions).not.toHaveBeenCalled();
  });
  it('propagates role failures for an approved account without checking permissions', async () => {
    const roleFailure = new Error('role read failed');
    authorization.getUserRoles.mockRejectedValueOnce(roleFailure);
    await expect(service.issue('connector-1', 'user-1')).rejects.toBe(roleFailure);
    expect(authorization.getUserPermissions).not.toHaveBeenCalled();
  });
  it('emits only connector renewal metadata, never user or principal secret', async () => {
    const auth = await service.bindingAuth(row.mcpServerUrl as string, 'user-1', 'connector-1', {}, {
      YELLOWSTORM_MCP_JWT_USER_ID: 'arbitrary', ADK_RUNTIME_MCP_RENEWAL_TOKEN: 'secret',
    });
    expect(auth.env).toEqual({ YELLOWSTORM_MCP_JWT_CONNECTOR_ID: 'connector-1' });
    expect(auth.headers.Authorization).toMatch(/^Bearer /);
  });
  it('does not issue for configured/public same-URL connectors', async () => {
    for (const profile of ['configured', 'public']) {
    row.mcpSecurityPolicy = { version: 1, profile, actorDelegation: 'none', allowPrivateNetwork: false, allowInsecureHttp: false, requiredPermissions: [] };
      await expect(service.issue('connector-1', 'user-1')).rejects.toThrow();
    }
    await expect(service.headers(row.mcpServerUrl as string, 'user-1', { Cookie: 'secret' }, 'connector-1')).rejects.toThrow();
  });
});
