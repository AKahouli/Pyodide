import 'reflect-metadata';
import { AuthService } from '@modules/auth/auth.service';
import { sessionRecord, makeSessionStoreFake } from '@modules/auth/persistence/session-store.fake';
import { expectContract } from '../expect-contract';

/**
 * Wire contract for the session list (`AuthService.getUserSessions`) built from
 * a PG SessionRecord: refresh token hash, token family and all rotation
 * bookkeeping (including receipt material) must never serialize.
 */
const wire = async (): Promise<Record<string, unknown>> => {
  const store = makeSessionStoreFake([
    sessionRecord({
      id: '64b000000000000000000010',
      userId: '64b000000000000000000001',
      refreshTokenHash: 'sha256-should-not-serialize',
      deviceInfo: { userAgent: 'jest', browser: 'chrome', os: 'linux' },
      ipAddress: '127.0.0.1',
      tokenFamily: 'family-should-not-serialize',
      rotatedFromSessionId: '64b000000000000000000011',
      rotatedToSessionId: '64b000000000000000000012',
      rotationAttemptId: 'attempt-should-not-serialize',
      rotationReceiptCiphertext: 'receipt-should-not-serialize',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastActivityAt: new Date('2026-01-15T00:00:00Z'),
    }),
  ]);
  const service = Object.create(AuthService.prototype) as AuthService;
  (service as unknown as { sessionStore: unknown }).sessionStore = store;
  const [session] = await service.getUserSessions('64b000000000000000000001', '64b000000000000000000010');
  return JSON.parse(JSON.stringify(session));
};

describe('session serializer contract', () => {
  it('matches the recorded session wire shape', async () => {
    const body = await wire();
    expectContract('auth/session.serializer', body);
    expect(body.id).toBe('64b000000000000000000010');
    expect(body.isCurrent).toBe(true);
    for (const key of ['refreshTokenHash', 'tokenFamily', 'rotatedFromSessionId', 'rotatedToSessionId', 'rotationAttemptId', 'rotationReceiptCiphertext', '_id', '__v']) {
      expect(body).not.toHaveProperty(key);
    }
  });
});
