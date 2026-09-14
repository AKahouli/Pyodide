import { Types } from 'mongoose';
import { AuthService } from './auth.service';
import { ConflictException, ServiceUnavailableException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { RotationReceiptCrypto } from './utils/rotation-receipt.crypto';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-new'),
  compare: jest.fn(),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const bcrypt = require('bcrypt') as { compare: jest.Mock };

describe('AuthService.refreshTokens atomic rotation (F03)', () => {
  const predecessorId = new Types.ObjectId();
  const successorId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  const receiptKey = Buffer.alloc(32, 7).toString('base64');

  const makePredecessor = (overrides: Record<string, unknown> = {}) => ({
    _id: predecessorId,
    userId,
    isValid: true,
    expiresAt: new Date(Date.now() + 60_000),
    tokenFamily: 'family-1',
    refreshTokenHash: 'hashed-old',
    ...overrides,
  });

  const makeSuccessorDoc = () => ({
    _id: successorId,
    userId,
    isValid: true,
    expiresAt: new Date(Date.now() + 60_000),
    tokenFamily: 'family-1',
    save: jest.fn().mockResolvedValue(undefined),
  });

  interface TxRecorder {
    savedDocs: unknown[];
    conditionalFilter: unknown;
    conditionalUpdate: unknown;
    conditionalResult: { _id: Types.ObjectId } | null;
    failWith?: Error;
  }

  const makeSessionModel = (predecessor: Record<string, unknown>, tx: TxRecorder) => {
    const created: Record<string, unknown> = { _id: successorId, save: jest.fn().mockImplementation(async function (this: Record<string, unknown>, opts: unknown) {
      tx.savedDocs.push({ doc: this, opts });
    }) };
    const model: any = jest.fn().mockImplementation(() => created);
    model.findById = jest.fn().mockResolvedValue(predecessor);
    model.findOneAndUpdate = jest.fn().mockImplementation((filter: unknown, update: unknown, opts: unknown) => {
      tx.conditionalFilter = filter;
      tx.conditionalUpdate = update;
      return Promise.resolve(tx.conditionalResult);
    });
    model.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    model.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });
    model.db = {
      startSession: jest.fn().mockResolvedValue({
        withTransaction: async (fn: () => Promise<void>) => {
          try {
            await fn();
          } catch (error) {
            if (tx.failWith && error instanceof Error === false) {
              throw tx.failWith;
            }
            throw error;
          }
          if (tx.failWith) {
            throw tx.failWith;
          }
        },
        endSession: jest.fn().mockResolvedValue(undefined),
      }),
    };
    return model;
  };

  const build = (predecessor: Record<string, unknown>, tx: TxRecorder) => {
    const sessionModel = makeSessionModel(predecessor, tx);
    const user = {
      _id: userId,
      email: 'jane@acme.io',
      status: 'active',
      roles: [],
      permissionsVersion: 1,
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
      sessionModel as never,
      { findById: jest.fn().mockResolvedValue(user) } as never,
      jwtService as never,
      configService as never,
      logger as never,
      {} as never, // emailService
      {} as never, // emailTemplateRenderer
      {} as never, // usageService
      { getUserPermissions: jest.fn().mockResolvedValue(['p']), getUserRoleNames: jest.fn().mockResolvedValue(['r']) } as never, // authorizationService
      { getLoginSettingsSync: () => ({ accessExpiry: '15m', refreshExpiry: '7d' }) } as never, // systemService
      {} as never, // workspaceInitializer
      { ensureForUser: jest.fn() } as never, // humainAgentService
    );
    return { service, sessionModel, logger, jwtService };
  };

  beforeEach(() => {
    bcrypt.compare.mockReset();
  });

  it('commits successor + predecessor invalidation in one transaction with a conditional update', async () => {
    const tx: TxRecorder = { savedDocs: [], conditionalFilter: null, conditionalUpdate: null, conditionalResult: { _id: successorId } };
    const { service, sessionModel, jwtService } = build(makePredecessor(), tx);
    bcrypt.compare.mockResolvedValue(true);

    const result = await service.refreshTokens(`${predecessorId}.old-secret`, '127.0.0.1', 'jest');

    expect(result.refreshToken).toContain(successorId.toString());
    expect(sessionModel.db.startSession).toHaveBeenCalled();
    expect(tx.savedDocs).toHaveLength(1);
    expect(tx.conditionalFilter).toEqual({ _id: predecessorId, isValid: true });
    expect((tx.conditionalUpdate as { $set: Record<string, unknown> }).$set.isValid).toBe(false);
    expect(jwtService.sign).toHaveBeenCalledWith(expect.anything(), { expiresIn: 900 });
  });

  it('seals the rotation receipt when an attempt id is supplied', async () => {
    const tx: TxRecorder = { savedDocs: [], conditionalFilter: null, conditionalUpdate: null, conditionalResult: { _id: successorId } };
    const { service } = build(makePredecessor(), tx);
    bcrypt.compare.mockResolvedValue(true);

    await service.refreshTokens(`${predecessorId}.old-secret`, '127.0.0.1', 'jest', 'attempt-12345678');

    const $set = (tx.conditionalUpdate as { $set: Record<string, unknown> }).$set;
    expect($set.rotationAttemptId).toBe('attempt-12345678');
    expect(typeof $set.rotationReceiptCiphertext).toBe('string');
    expect($set.rotationReceiptCiphertext).not.toContain('old-secret');
    // Receipt lifetime is fixed at commit time
    expect(($set.rotationReceiptExpiresAt as Date).getTime()).toBeLessThanOrEqual(Date.now() + 121_000);
  });

  it('aborts the whole rotation when the predecessor was consumed concurrently', async () => {
    const tx: TxRecorder = { savedDocs: [], conditionalFilter: null, conditionalUpdate: null, conditionalResult: null };
    const { service, sessionModel } = build(makePredecessor(), tx);
    bcrypt.compare.mockResolvedValue(true);

    await expect(
      service.refreshTokens(`${predecessorId}.old-secret`, '127.0.0.1', 'jest'),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_ROTATION_CONFLICT });
    // successor insert must not survive the abort
    expect(tx.savedDocs).toHaveLength(1);
    expect(sessionModel.updateMany).not.toHaveBeenCalled(); // no family invalidation
  });

  it('falls back to ordered single-document rotation when transactions are unsupported', async () => {
    const tx: TxRecorder = { savedDocs: [], conditionalFilter: null, conditionalUpdate: null, conditionalResult: { _id: successorId } };
    const { service, sessionModel } = build(makePredecessor(), tx);
    bcrypt.compare.mockResolvedValue(true);
    sessionModel.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    // First conditional claim (standalone step 1) succeeds.
    let findOneAndUpdateCalls = 0;
    sessionModel.findOneAndUpdate.mockImplementation(() => {
      findOneAndUpdateCalls += 1;
      return Promise.resolve({ _id: predecessorId });
    });
    (service as unknown as { sessionModel: { db: { startSession: jest.Mock } } }).sessionModel.db.startSession
      = jest.fn().mockResolvedValue({
        withTransaction: async () => {
          const err = new Error('Transaction numbers are only allowed on a replica set member or mongos');
          err.name = 'MongoTransactionError';
          throw err;
        },
        endSession: jest.fn(),
      });

    const result = await service.refreshTokens(`${predecessorId}.old-secret`, '127.0.0.1', 'jest');

    // Refresh still succeeds on standalone MongoDB, with a single successor.
    expect(result.refreshToken).toContain(successorId.toString());
    expect(sessionModel.db.startSession).toHaveBeenCalledTimes(1);
    // Second refresh skips the doomed transaction path entirely.
    sessionModel.findById = jest.fn().mockResolvedValue(makePredecessor());
    await service.refreshTokens(`${predecessorId}.old-secret`, '127.0.0.1', 'jest');
    expect(sessionModel.db.startSession).toHaveBeenCalledTimes(1);
    // The standalone path claims the predecessor before creating the successor.
    expect(findOneAndUpdateCalls).toBeGreaterThanOrEqual(2);
  });

  it('standalone fallback conflicts when the predecessor was claimed concurrently', async () => {
    const tx: TxRecorder = { savedDocs: [], conditionalFilter: null, conditionalUpdate: null, conditionalResult: null };
    const { service, sessionModel } = build(makePredecessor(), tx);
    bcrypt.compare.mockResolvedValue(true);
    sessionModel.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    (service as unknown as { sessionModel: { db: { startSession: jest.Mock } } }).sessionModel.db.startSession
      = jest.fn().mockResolvedValue({
        withTransaction: async () => {
          const err = new Error('Transaction numbers are only allowed on a replica set member or mongos');
          err.name = 'MongoTransactionError';
          throw err;
        },
        endSession: jest.fn(),
      });
    sessionModel.findOneAndUpdate = jest.fn().mockResolvedValue(null); // claim lost

    await expect(
      service.refreshTokens(`${predecessorId}.old-secret`, '127.0.0.1', 'jest'),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_ROTATION_CONFLICT });
  });

  it('standalone fallback treats a duplicate successor link as a conflict, never a second successor', async () => {
    const tx: TxRecorder = { savedDocs: [], conditionalFilter: null, conditionalUpdate: null, conditionalResult: null };
    const { service, sessionModel } = build(makePredecessor(), tx);
    bcrypt.compare.mockResolvedValue(true);
    sessionModel.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    sessionModel.findOneAndUpdate = jest.fn().mockResolvedValue({ _id: predecessorId }); // claim won
    const duplicateKeyError = Object.assign(new Error('E11000 duplicate key'), { name: 'MongoServerError', code: 11000 });
    (service as unknown as { sessionModel: jest.Mock }).sessionModel.mockImplementation(() => ({
      save: jest.fn().mockRejectedValue(duplicateKeyError),
      _id: successorId,
    }));
    (service as unknown as { sessionModel: { db: { startSession: jest.Mock } } }).sessionModel.db.startSession
      = jest.fn().mockResolvedValue({
        withTransaction: async () => {
          const err = new Error('Transaction numbers are only allowed on a replica set member or mongos');
          err.name = 'MongoTransactionError';
          throw err;
        },
        endSession: jest.fn(),
      });

    await expect(
      service.refreshTokens(`${predecessorId}.old-secret`, '127.0.0.1', 'jest'),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_ROTATION_CONFLICT });
  });

  it('recovers the same successor from the receipt for a repeated attempt', async () => {
    const receiptCrypto = new RotationReceiptCrypto(receiptKey, 'test-receipt-v1');
    const receiptExpiresAt = new Date(Date.now() + 60_000);
    const ciphertext = receiptCrypto.seal('new-secret-xyz', {
      predecessorSessionId: predecessorId.toString(),
      successorSessionId: successorId.toString(),
      tokenFamily: 'family-1',
      rotationAttemptId: 'attempt-12345678',
      receiptExpiresAt: receiptExpiresAt.getTime(),
    });
    const consumed = makePredecessor({
      isValid: false,
      rotatedToSessionId: successorId,
      rotationAttemptId: 'attempt-12345678',
      rotationReceiptCiphertext: ciphertext,
      rotationReceiptKeyId: 'test-receipt-v1',
      rotationReceiptExpiresAt: receiptExpiresAt,
    });
    const tx: TxRecorder = { savedDocs: [], conditionalFilter: null, conditionalUpdate: null, conditionalResult: { _id: successorId } };
    const { service, sessionModel } = build(consumed, tx);
    const successorDoc = makeSuccessorDoc();
    sessionModel.findById = jest
      .fn()
      .mockResolvedValueOnce(consumed) // predecessor lookup
      .mockResolvedValueOnce(successorDoc); // successor lookup
    bcrypt.compare.mockResolvedValue(true);

    const result = await service.refreshTokens(`${predecessorId}.old-secret`, '127.0.0.1', 'jest', 'attempt-12345678');

    expect(result.refreshToken).toBe(`${successorId}.new-secret-xyz`);
    expect(sessionModel.updateMany).not.toHaveBeenCalled(); // no family invalidation
    expect(sessionModel.findOneAndUpdate).not.toHaveBeenCalled(); // no second rotation
  });

  it('returns a retryable conflict (not reuse) inside the window with a different attempt id', async () => {
    const consumed = makePredecessor({
      isValid: false,
      rotatedToSessionId: successorId,
      rotationAttemptId: 'other-attempt-9999',
      rotationReceiptExpiresAt: new Date(Date.now() + 60_000),
    });
    const tx: TxRecorder = { savedDocs: [], conditionalFilter: null, conditionalUpdate: null, conditionalResult: { _id: successorId } };
    const { service } = build(consumed, tx);
    bcrypt.compare.mockResolvedValue(true); // presented token matches predecessor

    await expect(
      service.refreshTokens(`${predecessorId}.old-secret`, '127.0.0.1', 'jest', 'different-id-0001'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('applies the reuse policy (family invalidation) outside the receipt window', async () => {
    const consumed = makePredecessor({
      isValid: false,
      rotatedToSessionId: successorId,
      rotationAttemptId: 'attempt-12345678',
      rotationReceiptExpiresAt: new Date(Date.now() - 60_000), // expired window
    });
    const tx: TxRecorder = { savedDocs: [], conditionalFilter: null, conditionalUpdate: null, conditionalResult: { _id: successorId } };
    const { service, sessionModel } = build(consumed, tx);
    bcrypt.compare.mockResolvedValue(true);

    await expect(
      service.refreshTokens(`${predecessorId}.old-secret`, '127.0.0.1', 'jest', 'attempt-12345678'),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_REFRESH_TOKEN_INVALID });
    expect(sessionModel.updateMany).toHaveBeenCalledWith(
      { tokenFamily: 'family-1' },
      { $set: { isValid: false } },
    );
  });

  it('returns a retryable conflict, never family invalidation, inside the claimed-but-unattached window', async () => {
    // Standalone fallback: predecessor claimed (isValid=false, rotatedAt set)
    // but the successor link/receipt is not attached yet — a concurrent racer
    // with the correct credential must NOT nuke the token family.
    const claimedButUnattached = makePredecessor({
      isValid: false,
      rotatedAt: new Date(Date.now() - 200), // fresh claim
    });
    const tx: TxRecorder = { savedDocs: [], conditionalFilter: null, conditionalUpdate: null, conditionalResult: null };
    const { service, sessionModel } = build(claimedButUnattached, tx);
    bcrypt.compare.mockResolvedValue(true); // correct predecessor credential

    await expect(
      service.refreshTokens(`${predecessorId}.old-secret`, '127.0.0.1', 'jest'),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_ROTATION_CONFLICT });
    expect(sessionModel.updateMany).not.toHaveBeenCalled();
  });

  it('treats a STALE claimed-but-unattached rotation as dead and applies the reuse policy', async () => {
    // Crash mid-rotation long ago: the rotation is unrecoverable; the family
    // invalidation (re-login) is the reviewed outcome.
    const staleClaim = makePredecessor({
      isValid: false,
      rotatedAt: new Date(Date.now() - 120_000), // far beyond the claim grace
    });
    const tx: TxRecorder = { savedDocs: [], conditionalFilter: null, conditionalUpdate: null, conditionalResult: null };
    const { service, sessionModel } = build(staleClaim, tx);
    bcrypt.compare.mockResolvedValue(true);

    await expect(
      service.refreshTokens(`${predecessorId}.old-secret`, '127.0.0.1', 'jest'),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_REFRESH_TOKEN_INVALID });
    expect(sessionModel.updateMany).toHaveBeenCalledWith(
      { tokenFamily: 'family-1' },
      { $set: { isValid: false } },
    );
  });
});
