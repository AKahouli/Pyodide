import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sign } from 'jsonwebtoken';
import { request as httpRequest, Server } from 'node:http';
import { AgentCrudInternalController } from '@modules/agent/controllers/agent-crud-internal.controller';
import { AgentService } from '@modules/agent/agent.service';
import { AgentTypeService } from '@modules/agent-type/agent-type.service';
import { TeamCrudInternalController } from '@modules/team/controllers/team-crud-internal.controller';
import { TeamService } from '@modules/team/team.service';
import { ModelsService } from '@modules/models/models.service';
import { PlaybookAssistantInternalController } from '@modules/playbook-flow/controllers/playbook-assistant-internal.controller';
import { PlaybookAssistantService } from '@modules/playbook-flow/assistant/playbook-assistant.service';
import { PlaybookAssistantContextService } from '@modules/playbook-flow/assistant/playbook-assistant-context.service';
import { SemanticModelAssistantInternalController } from '@modules/semantic-model/controllers/semantic-model-assistant-internal.controller';
import { SemanticModelAssistantService } from '@modules/semantic-model/services/semantic-model-assistant.service';
import { PyodideRuntimeInternalController } from '@modules/pyodide-runtime/pyodide-runtime-internal.controller';
import { PyodideFileResolver } from '@modules/pyodide-runtime/pyodide-file.resolver';
import { PyodideRuntimeDispatcher } from '@modules/pyodide-runtime/pyodide-runtime.dispatcher';
import { UserService } from '@modules/user/user.service';
import { AuthorizationService } from '@modules/authorization/authorization.service';
import { Permissions } from '@modules/authorization/constants/permissions';
import { AuditLogService } from '@modules/authorization/services/audit-log.service';
import { McpJwtService } from '@modules/connector/services/mcp-jwt.service';
import { PgConnectorStore } from '@modules/connector/persistence/pg-connector.store';
import { DelegatedActorGuard } from './delegated-actor.guard';

// Workspace operations are outside these callback domains. Avoid bootstrapping
// the full application via WorkspaceShareService's user/auth barrel imports.
jest.mock('@modules/workspace/workspace-share.service', () => ({ WorkspaceShareService: class WorkspaceShareService { } }));

interface HttpProbe {
  set(name: string, value: string | string[]): HttpProbe;
  set(headers: Record<string, string>): HttpProbe;
  send(body: unknown): HttpProbe;
  expect(status: number): Promise<{ body: unknown }>;
}
function request(server: Server): { get(path: string): HttpProbe; post(path: string): HttpProbe } {
  function probeFor(path: string, method: string): HttpProbe {
    const headers: Record<string, string | string[]> = {};
    let payload: unknown;
    const probe: HttpProbe = {
      set(name: string | Record<string, string>, value?: string | string[]): HttpProbe {
        if (typeof name === 'string') headers[name] = value!;
        else Object.assign(headers, name);
        return probe;
      },
      send(value: unknown): HttpProbe {
        payload = value;
        return probe;
      },
      async expect(status: number) {
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing test HTTP listener');
        if (payload !== undefined) {
          const serialized = JSON.stringify(payload);
          headers['Content-Length'] = String(Buffer.byteLength(serialized));
          headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
        }
        return new Promise((resolve, reject) => {
          const req = httpRequest({ hostname: '127.0.0.1', port: address.port, path, method, headers }, response => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('error', reject);
            response.on('end', () => {
              try {
                const body = JSON.parse(Buffer.concat(chunks).toString()) as unknown;
                expect({ status: response.statusCode, body }).toMatchObject({ status });
                resolve({ body });
              } catch (error) { reject(error); }
            });
          });
          req.on('error', reject);
          if (payload !== undefined) req.write(JSON.stringify(payload));
          req.end();
        });
      },
    };
    return probe;
  }
  return { get: path => probeFor(path, 'GET'), post: path => probeFor(path, 'POST') };
}

// Real HTTP parsing, production controllers/guards and RSA verification. Only
// persistence, account/permission reads, audit persistence and domain work are faked.
describe('MCP controller security boundary over HTTP', () => {
  const userId = '507f1f77bcf86cd799439011';
  const targets = [
    { audience: 'mcp-agent', principal: 'mcp-agent', path: '/internal/agent-crud/agents' },
    { audience: 'mcp-playbook', principal: 'mcp-playbook', path: '/internal/playbook-assistant/playbooks' },
    { audience: 'mcp-semantic-model', principal: 'semantic-model-mcp', path: '/internal/semantic-model-assistant/models' },
    { audience: 'mcp-agent', principal: 'mcp-agent', path: '/internal/agent-crud/teams' },
  ];
  // Migration matrix: every consolidated surface also accepts the shared
  // mcp-platform audience until the three legacy MCP deployments retire.
  const platformTargets = [
    { audience: 'mcp-platform', principal: 'mcp-platform', path: '/internal/agent-crud/agents' },
    { audience: 'mcp-platform', principal: 'mcp-platform', path: '/internal/playbook-assistant/playbooks' },
    { audience: 'mcp-platform', principal: 'mcp-platform', path: '/internal/semantic-model-assistant/models' },
    { audience: 'mcp-platform', principal: 'mcp-platform', path: '/internal/agent-crud/teams' },
  ];
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const agent = { getAllForUserResponse: jest.fn(async () => [{ id: 'agent' }]) };
  const team = { findAllForUser: jest.fn(async () => [{ id: 'team' }]) };
  const playbook = { searchPlaybooks: jest.fn(async () => [{ id: 'playbook' }]) };
  const semantic = { listModels: jest.fn(async () => [{ id: 'semantic' }]), createModel: jest.fn(async () => ({ id: 'created' })) };
  const pyodideDispatcher = { execute: jest.fn(async () => ({ ok: true, stdout: '', stderr: '', execution: { runtime: 'pyodide', durationMs: 1, coldStart: false, loadedPackages: [] } })) };
  const pyodideResolver = { resolveInputs: jest.fn(async () => []), persistOutputs: jest.fn(async () => []) };
  const audit = { logSuccess: jest.fn() };
  let accountStatus: string;
  let permissions: string[];
  let revision: number;
  let active: boolean;
  let requiredPermissions: string[];
  let app: INestApplication;
  let directory: string;

  const assertion = (audience: string, overrides: Record<string, unknown> = {}) => sign({
    sub: userId, connectorId: audience, securityRevision: 1, jti: randomUUID(), ...overrides,
  }, privateKey, { algorithm: 'RS256', issuer: 'ws01-test', audience, expiresIn: 300 });
  const headers = (target = targets[0], token = assertion(target.audience)) => ({
    'X-YellowStorm-Mcp-Assertion': token,
    'X-Correlation-Id': randomUUID(),
  });
  const expectNoDomainWork = () => {
    expect(agent.getAllForUserResponse).not.toHaveBeenCalled();
    expect(team.findAllForUser).not.toHaveBeenCalled();
    expect(playbook.searchPlaybooks).not.toHaveBeenCalled();
    expect(semantic.listModels).not.toHaveBeenCalled();
    expect(semantic.createModel).not.toHaveBeenCalled();
  };

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'ws01-mcp-security-'));
    const keyPath = join(directory, 'ephemeral.pem');
    writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    const values: Record<string, string> = {
      NODE_ENV: 'production', MCP_JWT_PRIVATE_KEY_FILE: keyPath, MCP_JWT_ISSUER: 'ws01-test',
    };
    const module = await Test.createTestingModule({
      controllers: [AgentCrudInternalController, TeamCrudInternalController, PlaybookAssistantInternalController, SemanticModelAssistantInternalController, PyodideRuntimeInternalController],
      providers: [DelegatedActorGuard, McpJwtService,
        { provide: ConfigService, useValue: { get: (key: string, fallback?: unknown) => (key === 'pyodideRuntime.enabled' ? true : values[key as string] ?? fallback) } },
        { provide: UserService, useValue: { findById: jest.fn(async () => ({ id: userId, status: accountStatus, email: 'ws01@example.test' })) } },
        {
          provide: AuthorizationService, useValue: {
            getUserRoles: jest.fn(async () => [{ id: 'role' }]), getUserPermissions: jest.fn(async () => permissions),
          }
        },
        {
          provide: PgConnectorStore, useValue: {
            findById: jest.fn(async (id: string) => [...targets, ...platformTargets, { audience: 'mcp-pyodide' }].some(target => target.audience === id) ? {
              id, isActive: active, mcpTransportType: 'streamable_http', mcpServerUrl: 'https://8.8.8.8/mcp', securityRevision: revision,
              mcpSecurityPolicy: {
                version: 1, profile: 'internal_jwt', audience: id, actorDelegation: 'verified_user',
                allowPrivateNetwork: false, allowInsecureHttp: false, requiredPermissions
              },
            } : null)
          }
        },
        { provide: AuditLogService, useValue: audit },
        { provide: AgentService, useValue: agent }, { provide: AgentTypeService, useValue: {} }, { provide: ModelsService, useValue: {} },
        { provide: TeamService, useValue: team },
        { provide: PlaybookAssistantService, useValue: playbook }, { provide: PlaybookAssistantContextService, useValue: {} },
        { provide: SemanticModelAssistantService, useValue: semantic },
        { provide: PyodideRuntimeDispatcher, useValue: pyodideDispatcher }, { provide: PyodideFileResolver, useValue: pyodideResolver },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    if (app) await app.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });
  beforeEach(() => {
    jest.clearAllMocks();
    accountStatus = 'active'; revision = 1; active = true; requiredPermissions = [];
    permissions = [Permissions.PLAYBOOK_READ, Permissions.SEMANTIC_MODELS_READ];
  });

  it.each(targets)('accepts the current signed actor on $principal and serializes its result', async target => {
    // Preflight real policy evaluation so a bad fixture cannot masquerade as
    // successful negative boundary coverage.
    await app.get(McpJwtService).assertConnectorAccess({
      id: target.audience, isActive: active,
      mcpTransportType: 'streamable_http', mcpServerUrl: 'https://8.8.8.8/mcp', securityRevision: revision,
      mcpSecurityPolicy: {
        version: 1, profile: 'internal_jwt', audience: target.audience,
        actorDelegation: 'verified_user', allowPrivateNetwork: false, allowInsecureHttp: false, requiredPermissions
      },
    } as never, userId);
    const response = await request(app.getHttpServer()).get(target.path).set(headers(target)).expect(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(audit.logSuccess).toHaveBeenCalledWith(expect.objectContaining({
      actorId: userId,
      metadata: expect.objectContaining({ servicePrincipal: target.principal, connectorId: target.audience }),
    }));
  });
  it.each(platformTargets)('accepts the shared platform audience on $path during migration', async target => {
    await app.get(McpJwtService).assertConnectorAccess({
      id: target.audience, isActive: active,
      mcpTransportType: 'streamable_http', mcpServerUrl: 'https://8.8.8.8/mcp', securityRevision: revision,
      mcpSecurityPolicy: {
        version: 1, profile: 'internal_jwt', audience: target.audience,
        actorDelegation: 'verified_user', allowPrivateNetwork: false, allowInsecureHttp: false, requiredPermissions
      },
    } as never, userId);
    const response = await request(app.getHttpServer()).get(target.path)
      .set(headers(target, assertion(target.audience))).expect(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(audit.logSuccess).toHaveBeenCalledWith(expect.objectContaining({
      actorId: userId,
      metadata: expect.objectContaining({ servicePrincipal: 'mcp-platform', connectorId: target.audience }),
    }));
  });
  it.each(targets)('does not trust a caller-selected service identity on $principal', async target => {
    await request(app.getHttpServer()).get(target.path).set(headers(target))
      .set('X-YellowStorm-Service-Principal', 'caller-selected')
      .set('X-YellowStorm-Service-Token', 'not-a-credential').expect(200);
    expect(audit.logSuccess).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ servicePrincipal: target.principal, connectorId: target.audience }),
    }));
  });
  it.each(targets)('rejects generic-key-only on $principal', async target => {
    await request(app.getHttpServer()).get(target.path).set('X-Correlation-Id', randomUUID())
      .set('X-Internal-Token', 'legacy-generic-test-only-secret-00000001').expect(401);
    expectNoDomainWork();
  });
  it.each(targets)('rejects a valid foreign audience without service tokens on $principal', async target => {
    const foreign = targets.find(other => other.audience !== target.audience)!;
    await request(app.getHttpServer()).get(target.path).set(headers(target, assertion(foreign.audience)))
      .set('X-YellowStorm-Mcp-Audience', foreign.audience).expect(401);
    expectNoDomainWork();
  });
  describe('Pyodide relay surface', () => {
    const PYODIDE_AUDIENCE = 'mcp-pyodide';
    const execute = (token: string) => request(app.getHttpServer())
      .post('/internal/pyodide-runtime/execute')
      .set({
        'X-YellowStorm-Mcp-Assertion': token,
        'X-Correlation-Id': randomUUID(),
        'X-YellowStorm-Workspace-Id': '65f0000000000000000000aa',
      })
      .send({ code: '1 + 1' });

    it('accepts the current signed actor and dispatches with the verified subject', async () => {
      const response = await execute(assertion(PYODIDE_AUDIENCE)).expect(200);
      expect(pyodideDispatcher.execute).toHaveBeenCalledWith(userId, expect.objectContaining({ code: '1 + 1' }));
      expect(audit.logSuccess).toHaveBeenCalledWith(expect.objectContaining({
        actorId: userId,
        metadata: expect.objectContaining({ servicePrincipal: PYODIDE_AUDIENCE, connectorId: PYODIDE_AUDIENCE }),
      }));
      expect(response.body).toMatchObject({ ok: true });
    });

    it('rejects a foreign-audience assertion before the relay runs', async () => {
      await execute(assertion('mcp-agent')).expect(401);
      expect(pyodideDispatcher.execute).not.toHaveBeenCalled();
    });

    it('rejects a missing assertion before the relay runs', async () => {
      await execute('').expect(401);
      expect(pyodideDispatcher.execute).not.toHaveBeenCalled();
    });

    it('rejects a spoofed user even with a valid assertion', async () => {
      await execute(assertion(PYODIDE_AUDIENCE))
        .set('X-YellowStorm-User-Id', '65f000000000000000000099').expect(401);
      expect(pyodideDispatcher.execute).not.toHaveBeenCalled();
    });

    it('rejects a stale connector revision before the relay runs', async () => {
      revision = 2;
      await execute(assertion(PYODIDE_AUDIENCE)).expect(401);
      expect(pyodideDispatcher.execute).not.toHaveBeenCalled();
    });

    it('rejects legacy machine credentials without a signed assertion', async () => {
      await execute('').set('X-Internal-Token', 'retired-test-secret')
        .set('X-YellowStorm-User-Id', userId).expect(401);
      expect(pyodideDispatcher.execute).not.toHaveBeenCalled();
    });
  });
  it.each([
    ['missing assertion', (): string => ''], ['invalid signature', (): string => 'not-a-jwt'],
    ['missing subject', () => assertion('mcp-agent', { sub: undefined })],
    ['invalid subject', () => assertion('mcp-agent', { sub: 'not-an-object-id' })],
    ['missing revision', () => assertion('mcp-agent', { securityRevision: undefined })],
    ['wrong revision', () => assertion('mcp-agent', { securityRevision: 0 })],
    ['unknown connector', () => assertion('mcp-agent', { connectorId: 'missing' })],
  ] as const)('rejects %s without domain side effects', async (_name, token) => {
    await request(app.getHttpServer()).get(targets[0].path).set(headers(targets[0], token())).expect(401);
    expectNoDomainWork();
  });
  it('rejects an expired assertion', async () => {
    const token = sign({
      sub: userId, connectorId: 'mcp-agent', securityRevision: 1, jti: randomUUID(),
      iat: Math.floor(Date.now() / 1000) - 400
    }, privateKey,
      { algorithm: 'RS256', issuer: 'ws01-test', audience: 'mcp-agent', expiresIn: 300 });
    await request(app.getHttpServer()).get(targets[0].path).set(headers(targets[0], token)).expect(401);
    expectNoDomainWork();
  });
  it('rejects a signed assertion without an audience', async () => {
    const token = sign({ sub: userId, connectorId: 'mcp-agent', securityRevision: 1, jti: randomUUID() }, privateKey,
      { algorithm: 'RS256', issuer: 'ws01-test', expiresIn: 300 });
    await request(app.getHttpServer()).get(targets[0].path).set(headers(targets[0], token)).expect(401);
    expectNoDomainWork();
  });
  it.each(targets)('rejects a foreign signature without service tokens on $principal', async target => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const token = sign({ sub: userId, connectorId: target.audience, securityRevision: 1, jti: randomUUID() }, other,
      { algorithm: 'RS256', issuer: 'ws01-test', audience: target.audience, expiresIn: 300 });
    await request(app.getHttpServer()).get(target.path).set(headers(target, token)).expect(401);
    expectNoDomainWork();
  });
  it.each(targets)('rejects a foreign issuer without service tokens on $principal', async target => {
    const token = sign({ sub: userId, connectorId: target.audience, securityRevision: 1, jti: randomUUID() }, privateKey,
      { algorithm: 'RS256', issuer: 'foreign-issuer', audience: target.audience, expiresIn: 300 });
    await request(app.getHttpServer()).get(target.path).set(headers(target, token)).expect(401);
    expectNoDomainWork();
  });
  it('blocks wrong-domain JWT authority before a Semantic write can run', async () => {
    await request(app.getHttpServer()).post('/internal/semantic-model-assistant/models').set(headers()).expect(401);
    expectNoDomainWork();
  });
  it.each(targets)('rejects missing assertion without service tokens on $principal', async target => {
    await request(app.getHttpServer()).get(target.path).set(headers(target, '')).expect(401);
    expectNoDomainWork();
  });
  it.each(targets)('rejects stale revision without service tokens on $principal', async target => {
    const signedHeaders = headers(target);
    revision = 2;
    await request(app.getHttpServer()).get(target.path).set(signedHeaders).expect(401);
    expectNoDomainWork();
  });
  it.each(['revision', 'inactive connector', 'revoked account', 'connector permission'])('rechecks current %s', async state => {
    const signedHeaders = headers();
    if (state === 'revision') revision = 2;
    if (state === 'inactive connector') active = false;
    if (state === 'revoked account') accountStatus = 'suspended';
    if (state === 'connector permission') requiredPermissions = ['connector.admin'];
    await request(app.getHttpServer()).get(targets[0].path).set(signedHeaders).expect(401);
    expectNoDomainWork();
  });
  it.each(targets.filter(target => target.audience !== 'mcp-agent'))('denies revoked route permissions on $principal', async target => {
    permissions = [];
    await request(app.getHttpServer()).get(target.path).set(headers(target)).expect(403);
    expectNoDomainWork();
  });
  it('rejects spoofed actor identity', async () => {
    await request(app.getHttpServer()).get(targets[0].path).set(headers())
      .set('X-YellowStorm-User-Id', '507f1f77bcf86cd799439099').expect(401);
    expectNoDomainWork();
  });
  it.each(['X-YellowStorm-Service-Principal', 'X-YellowStorm-Service-Token', 'X-YellowStorm-Mcp-Assertion', 'X-YellowStorm-User-Id', 'X-Correlation-Id'])
    ('rejects raw duplicate %s headers through the HTTP parser', async name => {
      const valid = {
        ...headers(), 'X-YellowStorm-User-Id': userId,
        'X-YellowStorm-Service-Principal': 'untrusted', 'X-YellowStorm-Service-Token': 'unused'
      };
      const value = valid[name as keyof typeof valid];
      await request(app.getHttpServer()).get(targets[0].path).set(valid).set(name, [value, value]).expect(401);
      expectNoDomainWork();
    });
});
