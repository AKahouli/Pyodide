import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { sign } from 'jsonwebtoken';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { JwtStrategy } from '@modules/auth/strategies/jwt.strategy';
import { AuthService } from '@modules/auth/services/auth.service';
import { PgSessionStore } from '@modules/auth/persistence/pg-session.store';
import { UserService } from '@modules/user/services/user.service';
import { WorkspaceInternalController } from './workspace-internal.controller';
import { PgWorkspaceStore } from './stores/postgres/pg-workspace-store';
import { WorkspaceShareService } from './workspace-share.service';

describe('Workspace name lookup with real access JWTs and current workspace rights', () => {
  const alice = '507f1f77bcf86cd799439011', bob = '507f1f77bcf86cd799439012';
  const aliceWorkspace = '507f1f77bcf86cd799439013', bobWorkspace = '507f1f77bcf86cd799439014';
  const secret = 'names-only-synthetic-access-token-test-secret-00001';
  const rows = new Map([[aliceWorkspace, { storagePrefix: 'alice-workspace' }], [bobWorkspace, { storagePrefix: 'bob-workspace' }]]);
  const workspaces = { findByIds: jest.fn(), filterOwned: jest.fn(), filterPublic: jest.fn() };
  const shared = { filterSharedWithUser: jest.fn() }, sessions = { findValidByIdWithUser: jest.fn() };
  let app: INestApplication, status: string;
  beforeAll(async () => {
    const shares = new WorkspaceShareService(workspaces as never, shared as never, {} as never,
      { setContext: jest.fn() } as never, {} as never, {} as never, {} as never,
      { get: () => 1000 } as never);
    const module = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [WorkspaceInternalController],
      providers: [JwtStrategy, { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: ConfigService, useValue: new ConfigService({ jwt: { secret, issuer: 'names-test', audience: 'names-users' } }) },
        { provide: UserService, useValue: { findById: async (id: string) => [alice, bob].includes(id)
          ? { _id: id, id, status, email: 'synthetic@example.test' } : null } },
        { provide: AuthService, useValue: {} }, { provide: PgSessionStore, useValue: sessions },
        { provide: PgWorkspaceStore, useValue: workspaces }, { provide: WorkspaceShareService, useValue: shares },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => { if (app) await app.close(); });
  beforeEach(() => {
    jest.clearAllMocks(); status = 'active';
    workspaces.findByIds.mockImplementation(async (ids: string[]) => new Map(ids.map(id => [id, rows.get(id)])));
    workspaces.filterOwned.mockImplementation(async (ids: string[], actor: string) => ids.filter(id =>
      actor === alice ? id === aliceWorkspace : id === bobWorkspace));
    workspaces.filterPublic.mockResolvedValue([]); shared.filterSharedWithUser.mockResolvedValue([]);
    sessions.findValidByIdWithUser.mockResolvedValue({ valid: false });
  });
  const token = (sub = alice, claims: Record<string, unknown> = {}, signingSecret = secret) => sign(
    { sub, type: 'access', ...claims }, signingSecret,
    { algorithm: 'HS256', issuer: 'names-test', audience: 'names-users', expiresIn: 300 });
  const post = async (ids: string[], access?: string, extra: Record<string, string> = {}) => fetch(
    `${await app.getUrl()}/workspaces/internal/resolve-names`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(access ? { Authorization: `Bearer ${access}` } : {}), ...extra },
      body: JSON.stringify({ ids }) });

  it('returns only the authenticated actor’s authorized workspace names', async () => {
    const response = await post([aliceWorkspace], token());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ [aliceWorkspace]: 'alice-workspace' });
    expect(workspaces.filterOwned).toHaveBeenCalledWith([aliceWorkspace], alice);
  });
  it.each(['no token', 'generic machine key', 'foreign signature', 'refresh token', 'revoked session'])
    ('denies %s before reading workspace names', async scenario => {
      let access: string | undefined;
      const extra: Record<string, string> = {};
      if (scenario === 'generic machine key') extra['X-Internal-Token'] = 'legacy-shared-key';
      if (scenario === 'foreign signature') access = token(alice, {}, 'foreign-signature-secret');
      if (scenario === 'refresh token') access = token(alice, { type: 'refresh' });
      if (scenario === 'revoked session') access = token(alice, { sessionId: 'revoked-session' });
      expect((await post([aliceWorkspace], access, extra)).status).toBe(401);
      expect(workspaces.findByIds).not.toHaveBeenCalled();
    });
  it('denies a different user and an all-or-nothing mixed workspace batch', async () => {
    expect((await post([aliceWorkspace], token(bob))).status).toBe(403);
    expect((await post([aliceWorkspace, bobWorkspace], token())).status).toBe(403);
    expect(workspaces.findByIds).not.toHaveBeenCalled();
  });
  it('rechecks share revocation instead of trusting the unchanged access JWT', async () => {
    const access = token(bob);
    shared.filterSharedWithUser.mockResolvedValue([aliceWorkspace]);
    expect((await post([aliceWorkspace], access)).status).toBe(200);
    workspaces.findByIds.mockClear(); shared.filterSharedWithUser.mockResolvedValue([]);
    expect((await post([aliceWorkspace], access)).status).toBe(403);
    expect(workspaces.findByIds).not.toHaveBeenCalled();
  });
  it.each(['inactive', 'suspended'])('denies a currently %s account', async accountStatus => {
    const access = token(); status = accountStatus;
    expect((await post([aliceWorkspace], access)).status).toBeGreaterThanOrEqual(400);
    expect(workspaces.findByIds).not.toHaveBeenCalled();
  });
});
