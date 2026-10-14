import { createHash } from 'node:crypto';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { EmailTemplate } from '../email/email-template.constants';
import {
  USER_INVITATION_TTL_HOURS,
  UserInvitationService,
} from './user-invitation.service';

jest.mock('../logger/logger.service', () => ({
  logDomainEvent: jest.fn(),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { logDomainEvent } = require('../logger/logger.service') as {
  logDomainEvent: jest.Mock;
};

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('UserInvitationService', () => {
  const now = Date.now();

  const makeService = (overrides: {
    emailAvailable?: boolean;
    sendResult?: { success: boolean; attempts: number };
    stored?: {
      id: string;
      email: string;
      tokenHash: string;
      invitedBy: string | null;
      expiresAt: Date;
      consumedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    } | null;
    consumeResult?: boolean;
  } = {}) => {
    const store = {
      create: jest.fn().mockResolvedValue({}),
      findByTokenHash: jest.fn().mockResolvedValue(overrides.stored ?? null),
      consumeIfValid: jest.fn().mockResolvedValue(overrides.consumeResult ?? true),
    };
    const email = {
      isAvailable: jest.fn().mockReturnValue(overrides.emailAvailable ?? true),
      send: jest.fn().mockResolvedValue(
        overrides.sendResult ?? { success: true, attempts: 1 },
      ),
    };
    const emailRenderer = {
      render: jest.fn().mockResolvedValue({
        subject: 'You are invited to join YelloStorm',
        html: '<a href="x">Accept</a>',
        text: 'Accept',
      }),
    };
    const config = {
      get: jest.fn((key: string, def?: unknown) => {
        if (key === 'app.name') return 'YelloStorm';
        if (key === 'app.frontendUrl') return 'http://localhost:5173';
        return def;
      }),
    };
    const service = new UserInvitationService(
      store as never,
      email as never,
      emailRenderer as never,
      config as never,
    );
    return { service, store, email, emailRenderer, config };
  };

  const storedInvitation = (overrides: Record<string, unknown> = {}) => ({
    id: 'inv-1',
    email: 'jane@acme.io',
    tokenHash: 'hash',
    invitedBy: 'admin-1',
    expiresAt: new Date(now + 60 * 60 * 1000),
    consumedAt: null,
    createdAt: new Date(now - 1000),
    updatedAt: new Date(now - 1000),
    ...overrides,
  });

  beforeEach(() => {
    logDomainEvent.mockReset();
  });

  describe('invite', () => {
    it('stores a hash (never the raw token) and emails a 24h link', async () => {
      const { service, store, email, emailRenderer } = makeService();
      const before = Date.now();

      const result = await service.invite({ email: ' Jane@Acme.io ', invitedById: 'admin-1' });

      expect(result.email).toBe('jane@acme.io');
      const ttlMs = USER_INVITATION_TTL_HOURS * 60 * 60 * 1000;
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + ttlMs - 1000);
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + ttlMs + 1000);

      // The store receives the hash of the token, and the invitedBy id.
      const created = store.create.mock.calls[0][0];
      expect(created.email).toBe('jane@acme.io');
      expect(created.invitedBy).toBe('admin-1');
      expect(created.expiresAt).toBe(result.expiresAt);

      const [, renderData] = emailRenderer.render.mock.calls[0];
      expect(emailRenderer.render).toHaveBeenCalledWith(
        EmailTemplate.USER_INVITE,
        expect.objectContaining({ expiresInHours: String(USER_INVITATION_TTL_HOURS) }),
      );
      expect(renderData.inviteUrl).toContain('http://localhost:5173/#/?invite=');
      const token = decodeURIComponent(renderData.inviteUrl.split('invite=')[1]);
      expect(token.length).toBeGreaterThan(20);
      expect(created.tokenHash).toBe(sha256(token));
      expect(created.tokenHash).not.toBe(token);

      expect(email.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'jane@acme.io' }),
      );
    });

    it('refuses when the email service is unavailable and does not create a row', async () => {
      const { service, store, email } = makeService({ emailAvailable: false });

      await expect(
        service.invite({ email: 'jane@acme.io', invitedById: 'admin-1' }),
      ).rejects.toMatchObject({ code: ErrorCode.USER_INVITE_EMAIL_FAILED });

      expect(store.create).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('reports a terminal dependency failure when the send fails', async () => {
      const { service } = makeService({ sendResult: { success: false, attempts: 3 } });

      await expect(
        service.invite({ email: 'jane@acme.io', invitedById: 'admin-1' }),
      ).rejects.toMatchObject({ code: ErrorCode.USER_INVITE_EMAIL_FAILED });

      expect(logDomainEvent).toHaveBeenCalledWith(
        'error',
        'dependency.request.failed',
        expect.objectContaining({ dependency: 'smtp', attempt: 3 }),
      );
    });
  });

  describe('resolve', () => {
    it('returns the invited email and expiry for a valid token', async () => {
      const expiresAt = new Date(now + 60 * 60 * 1000);
      const { service } = makeService({ stored: storedInvitation({ expiresAt }) });

      await expect(service.resolve('raw-token')).resolves.toEqual({
        email: 'jane@acme.io',
        expiresAt,
      });
    });

    it('rejects unknown or already-consumed tokens with an invalid-token error', async () => {
      const unknown = makeService({ stored: null });
      await expect(unknown.service.resolve('raw-token')).rejects.toMatchObject({
        code: ErrorCode.AUTH_INVITE_TOKEN_INVALID,
      });

      const consumed = makeService({
        stored: storedInvitation({ consumedAt: new Date(now - 1000) }),
      });
      await expect(consumed.service.resolve('raw-token')).rejects.toMatchObject({
        code: ErrorCode.AUTH_INVITE_TOKEN_INVALID,
      });

      expect(logDomainEvent).toHaveBeenCalledWith(
        'warn',
        'http.request.failed',
        expect.objectContaining({ route: '/auth/invite' }),
      );
    });

    it('rejects an expired token with an explicit expired error', async () => {
      const { service } = makeService({
        stored: storedInvitation({ expiresAt: new Date(now - 1000) }),
      });

      await expect(service.resolve('raw-token')).rejects.toMatchObject({
        code: ErrorCode.AUTH_INVITE_TOKEN_EXPIRED,
      });
    });

    it('rejects an empty token without hitting the store', async () => {
      const { service, store } = makeService();

      await expect(service.resolve('')).rejects.toMatchObject({
        code: ErrorCode.AUTH_INVITE_TOKEN_INVALID,
      });
      expect(store.findByTokenHash).not.toHaveBeenCalled();
    });
  });

  describe('assertUsableForEmail', () => {
    it('accepts a token bound to the same (case-insensitive) address', async () => {
      const { service } = makeService({ stored: storedInvitation() });

      await expect(
        service.assertUsableForEmail('raw-token', ' Jane@Acme.io '),
      ).resolves.toBeUndefined();
    });

    it('rejects a token issued for a different address', async () => {
      const { service } = makeService({ stored: storedInvitation() });

      await expect(
        service.assertUsableForEmail('raw-token', 'other@acme.io'),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_INVITE_EMAIL_MISMATCH });
    });
  });

  describe('markConsumed', () => {
    it('claims the token through the atomic store update', async () => {
      const { service, store } = makeService({ consumeResult: true });

      await service.markConsumed('raw-token');

      expect(store.consumeIfValid).toHaveBeenCalledWith(sha256('raw-token'), expect.any(Date));
      expect(logDomainEvent).not.toHaveBeenCalled();
    });

    it('warns without throwing when the claim is lost to a concurrent request', async () => {
      const { service } = makeService({ consumeResult: false });

      await expect(service.markConsumed('raw-token')).resolves.toBeUndefined();

      expect(logDomainEvent).toHaveBeenCalledWith(
        'warn',
        'http.request.failed',
        expect.objectContaining({ route: '/auth/register', status_code: 409 }),
      );
    });
  });
});
