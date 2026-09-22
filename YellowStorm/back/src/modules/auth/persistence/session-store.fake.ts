import { RotationConflictError, type NewSession, type RotationBookkeeping, type SessionRecord, type SessionStore } from './session.store';

const oid = (): string => [...Array(24)].map(() => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');

export function sessionRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: oid(),
    userId: oid(),
    refreshTokenHash: 'hashed-old',
    deviceInfo: {},
    ipAddress: '127.0.0.1',
    isValid: true,
    expiresAt: new Date(Date.now() + 60_000),
    lastActivityAt: new Date(),
    tokenFamily: 'family-1',
    rotatedFromSessionId: null,
    rotatedToSessionId: null,
    rotationAttemptId: null,
    rotatedAt: null,
    rotationReceiptExpiresAt: null,
    rotationReceiptCiphertext: null,
    rotationReceiptKeyId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export interface SessionStoreFake extends SessionStore {
  records: SessionRecord[];
  rotations: Array<{ predecessorId: string; newSession: NewSession; bookkeeping: RotationBookkeeping }>;
  familyInvalidations: string[];
  /** When set, rotateAtomic throws this (e.g. RotationConflictError) instead of committing. */
  rotateError?: Error;
}

/** In-memory SessionStore fake mirroring the port contract (including atomic rotation). */
export function makeSessionStoreFake(seed: SessionRecord[] = []): SessionStoreFake {
  const records = [...seed];
  const fake: SessionStoreFake = {
    records,
    rotations: [],
    familyInvalidations: [],
    rotateError: undefined,
    create: jest.fn(async (init: NewSession) => {
      const created = sessionRecord({
        id: init.id ?? oid(),
        userId: init.userId,
        refreshTokenHash: init.refreshTokenHash,
        deviceInfo: init.deviceInfo,
        ipAddress: init.ipAddress,
        expiresAt: init.expiresAt,
        tokenFamily: init.tokenFamily,
        lastActivityAt: init.lastActivityAt ?? null,
        rotatedFromSessionId: init.rotatedFromSessionId ?? null,
      });
      records.push(created);
      return created;
    }),
    findById: jest.fn(async (id: string) => records.find((r) => r.id === id) ?? null),
    findActiveByUserId: jest.fn(async (userId: string) =>
      records.filter((r) => r.userId === userId && r.isValid && r.expiresAt > new Date())),
    existsForUserAndIp: jest.fn(async () => false),
    invalidateById: jest.fn(async (id: string) => {
      const target = records.find((r) => r.id === id);
      if (target) target.isValid = false;
    }),
    invalidateByIdAndUser: jest.fn(async (userId: string, sessionId: string) => {
      const target = records.find((r) => r.id === sessionId && r.userId === userId);
      if (target) {
        target.isValid = false;
        return true;
      }
      return false;
    }),
    invalidateAllForUser: jest.fn(async (userId: string) => {
      for (const r of records) if (r.userId === userId) r.isValid = false;
    }),
    invalidateByFamily: jest.fn(async (tokenFamily: string) => {
      fake.familyInvalidations.push(tokenFamily);
      for (const r of records) if (r.tokenFamily === tokenFamily) r.isValid = false;
    }),
    deleteById: jest.fn(async (id: string) => {
      const idx = records.findIndex((r) => r.id === id);
      if (idx >= 0) records.splice(idx, 1);
    }),
    countActiveForUser: jest.fn(async (userId: string) =>
      records.filter((r) => r.userId === userId && r.isValid && r.expiresAt > new Date()).length),
    invalidateOldestBeyond: jest.fn(async (userId: string, keep: number) => {
      const valid = records
        .filter((r) => r.userId === userId && r.isValid)
        .sort((a, b) => (b.lastActivityAt?.getTime() ?? 0) - (a.lastActivityAt?.getTime() ?? 0));
      const stale = valid.slice(keep);
      for (const r of stale) r.isValid = false;
      return stale.length;
    }),
    findValidByIdWithUser: jest.fn(async (id: string) => {
      const session = records.find((r) => r.id === id);
      if (!session) return null;
      // Fake has no user table: return the session with a stub user record.
      return { session, user: { id: session.userId } as never, valid: session.isValid && session.expiresAt > new Date() };
    }),
    rotateAtomic: jest.fn(async (params: { predecessorId: string; newSession: NewSession; bookkeeping: RotationBookkeeping }) => {
      fake.rotations.push(params);
      if (fake.rotateError) throw fake.rotateError;
      const predecessor = records.find((r) => r.id === params.predecessorId);
      if (!predecessor || !predecessor.isValid) throw new RotationConflictError();
      predecessor.isValid = false;
      predecessor.rotatedAt = params.bookkeeping.rotatedAt;
      predecessor.rotatedToSessionId = params.bookkeeping.rotatedToSessionId;
      if (params.bookkeeping.rotationAttemptId) predecessor.rotationAttemptId = params.bookkeeping.rotationAttemptId;
      if (params.bookkeeping.receipt) {
        predecessor.rotationReceiptExpiresAt = params.bookkeeping.receipt.expiresAt;
        predecessor.rotationReceiptKeyId = params.bookkeeping.receipt.keyId;
        predecessor.rotationReceiptCiphertext = params.bookkeeping.receipt.ciphertext;
      }
      const successor = sessionRecord({
        id: params.newSession.id ?? oid(),
        userId: params.newSession.userId,
        refreshTokenHash: params.newSession.refreshTokenHash,
        deviceInfo: params.newSession.deviceInfo,
        ipAddress: params.newSession.ipAddress,
        expiresAt: params.newSession.expiresAt,
        tokenFamily: params.newSession.tokenFamily,
        lastActivityAt: params.newSession.lastActivityAt ?? null,
        rotatedFromSessionId: params.predecessorId,
      });
      records.push(successor);
      return successor;
    }),
  };
  return fake;
}
