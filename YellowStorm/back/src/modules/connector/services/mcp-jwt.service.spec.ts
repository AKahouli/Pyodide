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
    (readFileSync as jest.Mock).mockReturnValue(privateKey.export({ type: 'pkcs8', format: 'pem' }));
    values = { MCP_JWT_PRIVATE_KEY_FILE: 'key.pem', MCP_JWT_ISSUER: 'issuer' };
    service = new McpJwtService({ get: (name: string, fallback?: unknown) => values[name] ?? fallback } as never,
      users as never, store as never, authorization as never);
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
  it('validates the original bracketed IPv6 destination and raw exact exception without canonical reparsing', async () => {
    const endpoint = 'http://[::1]:8027/Mcp';
    row.mcpServerUrl = endpoint;
    row.mcpSecurityPolicy = { ...row.mcpSecurityPolicy as object, allowPrivateNetwork: true };
    await service.checkDestination(row as never);
    expect(assertMcpDestinationAllowed).toHaveBeenLastCalledWith(endpoint,
      expect.objectContaining({ allowExactEndpoints: [endpoint] }));
  });
  it.each([false, true])('loads bounded legacy signer config with shared precedence (%s)', async shared => {
    values = { SEMANTIC_MODEL_MCP_JWT_PRIVATE_KEY_FILE: 'legacy.pem', SEMANTIC_MODEL_MCP_JWT_ISSUER: 'legacy-issuer',
      ...(shared ? { MCP_JWT_PRIVATE_KEY_FILE: 'shared.pem', MCP_JWT_ISSUER: 'shared-issuer' } : {}) };
    const compatible = new McpJwtService({ get: (name: string, fallback?: unknown) => values[name] ?? fallback } as never,
      users as never, store as never, authorization as never);
    expect(readFileSync).toHaveBeenLastCalledWith(shared ? 'shared.pem' : 'legacy.pem');
    const { token } = await compatible.issue('connector-1', 'user-1');
    expect(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).iss).toBe(shared ? 'shared-issuer' : 'legacy-issuer');
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
    expect(await service.verifyMcpAssertion(issued.token, 'recipient')).toEqual({ sub: 'user-1', connectorId: 'connector-1' });
    const renewed = await service.renew('connector-1', issued.token);
    expect(renewed.token).not.toBe(issued.token);
    expect(JSON.parse(Buffer.from(renewed.token.split('.')[1], 'base64url').toString()).sub).toBe('user-1');
  });
  it('rejects wrong audience and another connector renewal', async () => {
    const { token } = await service.issue('connector-1', 'user-1');
    expect(await service.verifyMcpAssertion(token, 'other')).toBeNull();
    row = { ...row, id: 'connector-2' };
    await expect(service.renew('connector-2', token)).rejects.toThrow();
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
