import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ConversationV2AppShareService } from '@modules/conversation-v2/services/conversation-v2-app-share.service';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import {
  AppDataErrorCode,
  AppDataException,
} from '../constants/app-data.errors';
import { AppDataAuditService } from './app-data-audit.service';
import { AppDataCatalogService } from './app-data-catalog.service';
import { AppDataEndUserAuthService } from './app-data-end-user-auth.service';
import { AppDataEndUserGrantsService } from './app-data-end-user-grants.service';
import { AppDataEndUserService } from './app-data-end-user.service';
import { Test } from '@nestjs/testing';

const APP = {
  id: 'app-row-1',
  appDataId: 'ad-1',
  workspaceId: 'ws-1',
  endUserAuthEnabled: true,
  jwtSecret: 'jwt-secret',
};

describe('AppDataEndUserAuthService invites', () => {
  let svc: AppDataEndUserAuthService;
  const catalog = { requireAppByAppDataId: jest.fn() };
  const endUsers = {
    normalizeEmail: (email: string) => email.trim().toLowerCase(),
    findByEmail: jest.fn(),
  };
  const grants = { seedDenyAll: jest.fn().mockResolvedValue(undefined) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const appShares = {
    resolveInviteToken: jest.fn(),
    consumeInviteToken: jest.fn(),
  };
  const jwtService = { signAsync: jest.fn().mockResolvedValue('signed-jwt') };
  const returning = jest.fn().mockResolvedValue([
    { id: 'user-1', email: 'guest@example.com', displayName: null },
  ]);
  const values = jest.fn().mockReturnValue({ returning });
  const db = { insert: jest.fn().mockReturnValue({ values }) };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => {
      if (key === 'appData.endUserAuthEnabled') return true;
      if (key === 'appData.endUserBcryptRounds') return 4;
      if (key === 'appData.endUserJwtTtl') return '7d';
      return fallback;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    catalog.requireAppByAppDataId.mockResolvedValue(APP);
    endUsers.findByEmail.mockResolvedValue(null);
    appShares.consumeInviteToken.mockResolvedValue(true);
    jwtService.signAsync.mockResolvedValue('signed-jwt');
    returning.mockResolvedValue([
      { id: 'user-1', email: 'guest@example.com', displayName: null },
    ]);

    const module = await Test.createTestingModule({
      providers: [
        AppDataEndUserAuthService,
        { provide: DRIZZLE_DB, useValue: db },
        { provide: ConfigService, useValue: config },
        { provide: JwtService, useValue: jwtService },
        { provide: AppDataCatalogService, useValue: catalog },
        { provide: AppDataEndUserService, useValue: endUsers },
        { provide: AppDataEndUserGrantsService, useValue: grants },
        { provide: AppDataAuditService, useValue: audit },
        { provide: ConversationV2AppShareService, useValue: appShares },
      ],
    }).compile();

    svc = module.get(AppDataEndUserAuthService);
  });

  function liveInvite(overrides: Record<string, unknown> = {}) {
    return {
      email: 'guest@example.com',
      appTitle: 'Shared app',
      deployedUrl: 'https://apps.example/a/',
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
      expiresAt: new Date(Date.now() + 86_400_000),
      consumed: false,
      ...overrides,
    };
  }

  it('resolveInvite returns email metadata for a live token bound to the app', async () => {
    appShares.resolveInviteToken.mockResolvedValue(liveInvite());
    await expect(svc.resolveInvite('ad-1', 'tok')).resolves.toEqual({
      email: 'guest@example.com',
      appTitle: 'Shared app',
      expiresAt: expect.any(String),
    });
  });

  it('resolveInvite returns 404 for an unknown token', async () => {
    appShares.resolveInviteToken.mockResolvedValue(null);
    await expect(svc.resolveInvite('ad-1', 'tok')).rejects.toMatchObject({
      appDataCode: AppDataErrorCode.INVITE_INVALID,
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('resolveInvite returns 410 for consumed or expired tokens', async () => {
    appShares.resolveInviteToken.mockResolvedValue(liveInvite({ consumed: true }));
    await expect(svc.resolveInvite('ad-1', 'tok')).rejects.toMatchObject({
      appDataCode: AppDataErrorCode.INVITE_CONSUMED,
      status: HttpStatus.GONE,
    });

    appShares.resolveInviteToken.mockResolvedValue(
      liveInvite({ expiresAt: new Date(Date.now() - 1000) }),
    );
    await expect(svc.resolveInvite('ad-1', 'tok')).rejects.toMatchObject({
      appDataCode: AppDataErrorCode.INVITE_EXPIRED,
      status: HttpStatus.GONE,
    });
  });

  it('resolveInvite returns 403 when the token belongs to another app', async () => {
    appShares.resolveInviteToken.mockResolvedValue(liveInvite({ workspaceId: 'other-ws' }));
    await expect(svc.resolveInvite('ad-1', 'tok')).rejects.toMatchObject({
      appDataCode: AppDataErrorCode.INVITE_MISMATCH,
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('register with inviteToken rejects email mismatch', async () => {
    appShares.resolveInviteToken.mockResolvedValue(liveInvite());
    await expect(
      svc.register({
        appDataId: 'ad-1',
        email: 'other@example.com',
        password: 'password1',
        inviteToken: 'tok',
      }),
    ).rejects.toMatchObject({
      appDataCode: AppDataErrorCode.INVITE_MISMATCH,
      status: HttpStatus.FORBIDDEN,
    });
    expect(db.insert).not.toHaveBeenCalled();
    expect(appShares.consumeInviteToken).not.toHaveBeenCalled();
  });

  it('register with inviteToken consumes after a successful create', async () => {
    appShares.resolveInviteToken.mockResolvedValue(liveInvite());
    await expect(
      svc.register({
        appDataId: 'ad-1',
        email: 'guest@example.com',
        password: 'password1',
        inviteToken: 'tok',
      }),
    ).resolves.toEqual({
      token: 'signed-jwt',
      user: { id: 'user-1', email: 'guest@example.com', displayName: null },
    });
    expect(grants.seedDenyAll).toHaveBeenCalledWith('app-row-1', 'user-1');
    expect(appShares.consumeInviteToken).toHaveBeenCalledWith('tok', 'guest@example.com');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'invite_register',
        metadata: expect.objectContaining({ inviteConsumed: true }),
      }),
    );
  });

  it('register does not consume the invite when the email is already taken', async () => {
    appShares.resolveInviteToken.mockResolvedValue(liveInvite());
    endUsers.findByEmail.mockResolvedValue({ id: 'existing' });
    await expect(
      svc.register({
        appDataId: 'ad-1',
        email: 'guest@example.com',
        password: 'password1',
        inviteToken: 'tok',
      }),
    ).rejects.toBeInstanceOf(AppDataException);
    expect(appShares.consumeInviteToken).not.toHaveBeenCalled();
  });
});
