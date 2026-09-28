import { Types } from 'mongoose';
import { AuthService } from './auth.service';
import { ConflictException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { RotationReceiptCrypto } from './utils/rotation-receipt.crypto';
import { makeSessionStoreFake, sessionRecord, type SessionStoreFake } from './persistence/session-store.fake';
import { RotationConflictError } from './persistence/session.store';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-new'),
  compare: jest.fn(),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const bcrypt = require('bcrypt') as { compare: jest.Mock };

describe('AuthService.refreshTokens atomic rotation (F03)', () => {
  const successorId = 'b0000000000000000000aaa';
  const userId = new Types.ObjectId().toString();
  const receiptKey = Buffer.alloc(32, 7).toString('base64');

  const build = (predecessorOverrides: Partial<ReturnType<typeof sessionRecord>> = {}) => {
    const predecessor = sessionRecord({
      id: 'a0000000000000000000aaa',
      userId,
      isValid: true,
      expiresAt: new Date(Date.now() + 60_000),
      tokenFamily: 'family-1',
      refreshTokenHash: 'hashed-old',
      ...predecessorOverrides,
    });
    const store = makeSessionStoreFake([predecessor]);
    const user = {
      _id: userId,
      id: userId,
      email: 'jane@acme.io',
      status: 'active',
      roles: [],
      permissionsVersion: 1,
      profile: {},
      appearance: {},
      consents: {},
    };
    const configValues: Record<string, unknown> = {
      'auth.bcryptRounds': 12,
      'auth.maxSessionsPerUser': 10,
      'auth.rotationReceiptKey': receiptKey,
      'auth.rotationReceiptKeyId': 'test-receipt-v1',
      'auth.rotationReceiptWindowSeconds': 120,
    };
    const configService = { get: jest.fn((key: string, def?: unknown) => configValues[key] ?? def) };
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const jwtService = { sign: jest.fn().mockReturnValue('signed.access') };
    const service = new AuthService(
      store as never,
      { findById: jest.fn().mockResolvedValue(user) } as never,
      jwtService as never,
      configService as never,
      logger as never,
      {} as never, // emailService
      {} as never, // emailTemplateRenderer
      {} as never, // usageService
      { getUserPermissions: jest.fn().mockResolvedValue(['p']), getUserRoleNames: jest.fn().mockResolvedValue(['r']) } as never, // authorizationService
      { getLoginSettingsSync: () => ({ accessExpiry: '15m', refreshExpiry: '7d' }) } as never, // systemService
      { getSettings: jest.fn().mockResolvedValue({
        throttle: { limit: 100, windowSeconds: 60 },
        auth: { maxSessionsPerUser: 10 },
        documentUpload: { maxFileSizeMb: 50, maxFilesPerUpload: 10, allowedMimeTypes: [] },
      }) } as never, // platformSettings
      {} as never, // workspaceInitializer
      { ensureForUser: jest.fn() } as never, // humainAgentService
    );
    return { service, store, jwtService, predecessor };
  };

  beforeEach(() => {
    bcrypt.compare.mockReset();
  });

  it('commits successor + predecessor invalidation in one store transaction', async () => {
    const { service, store, jwtService } = build();
    bcrypt.compare.mockResolvedValue(true);

    const result = await service.refreshTokens(`${predecessorId()}.old-secret`, '127.0.0.1', 'jest');

    expect(store.rotations).toHaveLength(1);
    const rotation = store.rotations[0];
    expect(rotation.predecessorId).toBe(predecessorId());
    expect(result.refreshToken).toContain(rotation.bookkeeping.rotatedToSessionId);
    expect(store.invalidateByFamily).not.toHaveBeenCalled();
    expect(jwtService.sign).toHaveBeenCalledWith(expect.anything(), { expiresIn: 900 });
  });

  it('seals the rotation receipt when an attempt id is supplied', async () => {
    const { service, store } = build();
    bcrypt.compare.mockResolvedValue(true);

    await service.refreshTokens(`${predecessorId()}.old-secret`, '127.0.0.1', 'jest', 'attempt-12345678');

    const bookkeeping = store.rotations[0].bookkeeping;
    expect(bookkeeping.rotationAttemptId).toBe('attempt-12345678');
    expect(typeof bookkeeping.receipt?.ciphertext).toBe('string');
    expect(bookkeeping.receipt!.ciphertext).not.toContain('old-secret');
    expect(bookkeeping.receipt!.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 121_000);
  });

  it('aborts the whole rotation when the predecessor was consumed concurrently', async () => {
    const { service, store } = build();
    store.rotateError = new RotationConflictError();
    bcrypt.compare.mockResolvedValue(true);

    await expect(
      service.refreshTokens(`${predecessorId()}.old-secret`, '127.0.0.1', 'jest'),
    ).rejects.toBeInstanceOf(ConflictException);
    // The store threw before committing: no successor exists, no family invalidation.
    expect(store.records.filter((r) => r.rotatedFromSessionId === predecessorId())).toHaveLength(0);
    expect(store.invalidateByFamily).not.toHaveBeenCalled();
  });

  it('recovers the same successor from the receipt for a repeated attempt', async () => {
    const receiptCrypto = new RotationReceiptCrypto(receiptKey, 'test-receipt-v1');
    const receiptExpiresAt = new Date(Date.now() + 60_000);
    const succId = 'b0000000000000000000bbb';
    const ciphertext = receiptCrypto.seal('new-secret-xyz', {
      predecessorSessionId: 'a0000000000000000000aaa',
      successorSessionId: succId,
      tokenFamily: 'family-1',
      rotationAttemptId: 'attempt-12345678',
      receiptExpiresAt: receiptExpiresAt.getTime(),
    });
    const consumed = sessionRecord({
      id: 'a0000000000000000000aaa',
      userId,
      isValid: false,
      rotatedToSessionId: succId,
      rotationAttemptId: 'attempt-12345678',
      rotationReceiptCiphertext: ciphertext,
      rotationReceiptKeyId: 'test-receipt-v1',
      rotationReceiptExpiresAt: receiptExpiresAt,
    });
    const successor = sessionRecord({ id: succId, userId, tokenFamily: 'family-1' });
    const store = makeSessionStoreFake([consumed, successor]);
    const { service } = build(consumed);
    // Swap in a store that also resolves the successor lookup.
    (service as unknown as { sessionStore: SessionStoreFake }).sessionStore = store;
    bcrypt.compare.mockResolvedValue(true);

    const result = await service.refreshTokens(`${predecessorId()}.old-secret`, '127.0.0.1', 'jest', 'attempt-12345678');

    expect(result.refreshToken).toBe(`${succId}.new-secret-xyz`);
    expect(store.rotations).toHaveLength(0); // no second rotation
    expect(store.invalidateByFamily).not.toHaveBeenCalled();
  });

  it('returns a retryable conflict (not reuse) inside the window with a different attempt id', async () => {
    const consumed = sessionRecord({
      id: 'a0000000000000000000aaa',
      userId,
      isValid: false,
      rotatedToSessionId: 'b0000000000000000000bbb',
      rotationAttemptId: 'other-attempt-9999',
      rotationReceiptExpiresAt: new Date(Date.now() + 60_000),
    });
    const { service } = build(consumed);
    bcrypt.compare.mockResolvedValue(true); // presented token matches predecessor

    await expect(
      service.refreshTokens(`${predecessorId()}.old-secret`, '127.0.0.1', 'jest', 'different-id-0001'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('applies the reuse policy (family invalidation) outside the receipt window', async () => {
    const consumed = sessionRecord({
      id: 'a0000000000000000000aaa',
      userId,
      isValid: false,
      rotatedToSessionId: 'b0000000000000000000bbb',
      rotationAttemptId: 'attempt-12345678',
      rotationReceiptExpiresAt: new Date(Date.now() - 60_000), // expired window
    });
    const { service, store } = build(consumed);
    bcrypt.compare.mockResolvedValue(true);

    await expect(
      service.refreshTokens(`${predecessorId()}.old-secret`, '127.0.0.1', 'jest', 'attempt-12345678'),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_REFRESH_TOKEN_INVALID });
    expect(store.invalidateByFamily).toHaveBeenCalledWith('family-1');
  });

  it('returns a retryable conflict, never family invalidation, inside the claimed-but-unattached window', async () => {
    // Predecessor claimed (isValid=false, rotatedAt set) but the successor
    // link/receipt is not attached yet — a concurrent racer with the correct
    // credential must NOT nuke the token family.
    const claimedButUnattached = sessionRecord({
      id: 'a0000000000000000000aaa',
      userId,
      isValid: false,
      rotatedAt: new Date(Date.now() - 200), // fresh claim
    });
    const { service, store } = build(claimedButUnattached);
    bcrypt.compare.mockResolvedValue(true); // correct predecessor credential

    await expect(
      service.refreshTokens(`${predecessorId()}.old-secret`, '127.0.0.1', 'jest'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(store.invalidateByFamily).not.toHaveBeenCalled();
  });

  it('treats a STALE claimed-but-unattached rotation as dead and applies the reuse policy', async () => {
    // Crash mid-rotation long ago: the rotation is unrecoverable; the family
    // invalidation (re-login) is the reviewed outcome.
    const staleClaim = sessionRecord({
      id: 'a0000000000000000000aaa',
      userId,
      isValid: false,
      rotatedAt: new Date(Date.now() - 120_000), // far beyond the claim grace
    });
    const { service, store } = build(staleClaim);
    bcrypt.compare.mockResolvedValue(true);

    await expect(
      service.refreshTokens(`${predecessorId()}.old-secret`, '127.0.0.1', 'jest'),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_REFRESH_TOKEN_INVALID });
    expect(store.invalidateByFamily).toHaveBeenCalledWith('family-1');
  });
});

function predecessorId(): string {
  return 'a0000000000000000000aaa';
}
