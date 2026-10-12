import { JwtService } from '@nestjs/jwt';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SemanticModelMcpJwtService } from './semantic-model-mcp-jwt.service';

jest.mock('node:fs', () => ({ ...jest.requireActual('node:fs'), readFileSync: jest.fn() }));

describe('SemanticModelMcpJwtService', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const url = 'http://localhost:8027/mcp';
  const users = { findById: jest.fn() };
  const configValues = {
    SEMANTIC_MODEL_MCP_AUTH_MODE: 'JWT',
    SEMANTIC_MODEL_MCP_SERVER_URL: url,
    SEMANTIC_MODEL_MCP_JWT_PRIVATE_KEY_FILE: 'private.pem',
    SEMANTIC_MODEL_MCP_JWT_ISSUER: 'yellowstorm',
    SEMANTIC_MODEL_MCP_JWT_AUDIENCE: 'mcp-semantic-model',
  };
  const config = (overrides = {}) => ({ get: (name: string, fallback?: unknown) => ({ ...configValues, ...overrides })[name] ?? fallback });
  const create = (overrides = {}) => new SemanticModelMcpJwtService(config(overrides) as never, users as never);

  beforeEach(() => {
    users.findById.mockReset().mockResolvedValue({ id: 'user-1', status: 'active' });
    (readFileSync as jest.Mock).mockReturnValue(privateKey.export({ type: 'pkcs8', format: 'pem' }));
  });

  it('issues verifiable RS256 JWTs and renews with a new token id', async () => {
    const service = create();
    const first = await service.issue(url, 'user-1');
    const claims = new JwtService().verify(first.token, { publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), algorithms: ['RS256'], issuer: 'yellowstorm', audience: 'mcp-semantic-model' });
    expect(claims).toMatchObject({ sub: 'user-1', iss: 'yellowstorm', aud: 'mcp-semantic-model', exp: first.expiresAt });
    expect(claims.exp - claims.iat).toBe(300);
    const renewed = await service.issue(url, 'user-1');
    expect(renewed.token).not.toBe(first.token);
    expect(users.findById).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['PLAYBOOK', 'http://localhost:8025/mcp', 'mcp-playbook'],
    ['AGENT', 'http://localhost:8026/mcp', 'mcp-agent'],
  ])('issues a user token scoped to the %s MCP', async (name, serverUrl, audience) => {
    const service = create({ [`${name}_MCP_AUTH_MODE`]: 'JWT' });
    const issued = await service.issue(serverUrl, 'user-1');
    const claims = new JwtService().verify(issued.token, {
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      algorithms: ['RS256'], issuer: 'yellowstorm', audience,
    });
    expect(claims.sub).toBe('user-1');
    expect(claims.exp - claims.iat).toBe(300);
    await expect(service.issue('https://evil.example/mcp', 'user-1')).rejects.toThrow();
  });

  it.each(['https://evil.example/mcp', `${url}/other`, 'http://localhost:8027/MCP', `${url}?other=1`, `${url}#other`, 'http://user@localhost:8027/mcp'])('refuses tokens for %s', async (target) => {
    await expect(create().issue(target, 'user-1')).rejects.toThrow();
    expect(users.findById).not.toHaveBeenCalled();
  });

  it.each([null, { status: 'suspended' }, { status: 'inactive' }])('refuses missing or unavailable accounts', async (user) => {
    users.findById.mockResolvedValue(user);
    await expect(create().issue(url, 'user-1')).rejects.toThrow();
  });

  it('propagates account lookup failures without issuing a token', async () => {
    users.findById.mockRejectedValue(new Error('database unavailable'));
    await expect(create().issue(url, 'user-1')).rejects.toThrow('database unavailable');
  });

  it('overrides authorization case-insensitively and carries renewal identity separately from credentials', async () => {
    const auth = await create().bindingAuth(url, 'user-1', 'connector-1', {
      authorization: 'Bearer static', Authorization: 'Bearer another', 'X-Correlation-Id': 'trace',
    }, {});
    expect(auth.headers.authorization).toBeUndefined();
    expect(auth.headers.Authorization).toMatch(/^Bearer ey/);
    expect(auth.headers['X-Correlation-Id']).toBe('trace');
    expect(auth.env).toEqual({ YELLOWSTORM_MCP_JWT_CONNECTOR_ID: 'connector-1', YELLOWSTORM_MCP_JWT_USER_ID: 'user-1' });
  });

  it('preserves Bearer mode and external connector credentials', async () => {
    const existing = { Authorization: 'Bearer static' };
    expect(await create({ SEMANTIC_MODEL_MCP_AUTH_MODE: 'Bearer' }).headers(url, 'user-1', existing)).toBe(existing);
    expect(await create().headers('https://external.example/mcp', 'user-1', existing)).toBe(existing);
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('fails startup for invalid signing configuration', () => {
    expect(() => create({ SEMANTIC_MODEL_MCP_JWT_PRIVATE_KEY_FILE: '' })).toThrow();
    expect(() => create({ SEMANTIC_MODEL_MCP_JWT_ISSUER: '' })).toThrow();
    const ecKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
    (readFileSync as jest.Mock).mockReturnValue(ecKey.export({ type: 'pkcs8', format: 'pem' }));
    expect(() => create()).toThrow('RSA');
  });

  it('accepts shared MCP signing settings without the legacy semantic names', async () => {
    const service = create({
      SEMANTIC_MODEL_MCP_JWT_PRIVATE_KEY_FILE: '', SEMANTIC_MODEL_MCP_JWT_ISSUER: '',
      MCP_JWT_PRIVATE_KEY_FILE: 'private.pem', MCP_JWT_ISSUER: 'yellowstorm',
    });
    await expect(service.issue(url, 'user-1')).resolves.toMatchObject({ serverUrl: url });
  });
});
