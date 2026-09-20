import 'reflect-metadata';
import { Types } from 'mongoose';
import { SessionSchema } from '@modules/auth/schemas/session.schema';
import { expectContract, hydrateDoc } from '../expect-contract';


/**
 * Serializer contract for Mongo `sessions` — the PG session mapper (step 1A)
 * must reproduce the exact masking: refresh token hash, token family and all
 * rotation bookkeeping (including receipt material) never serialize.
 */
const wire = (): Record<string, unknown> =>
  JSON.parse(
    JSON.stringify(
      hydrateDoc(SessionSchema, {
        _id: new Types.ObjectId('64b000000000000000000010'),
        userId: new Types.ObjectId('64b000000000000000000001'),
        refreshTokenHash: 'sha256-should-not-serialize',
        deviceInfo: { userAgent: 'jest', browser: 'chrome', os: 'linux' },
        ipAddress: '127.0.0.1',
        isValid: true,
        expiresAt: new Date('2026-02-01T00:00:00Z'),
        lastActivityAt: new Date('2026-01-15T00:00:00Z'),
        tokenFamily: 'family-should-not-serialize',
        rotatedFromSessionId: new Types.ObjectId('64b000000000000000000011'),
        rotationAttemptId: 'attempt-should-not-serialize',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-15T00:00:00Z'),
      }).toJSON(),
    ),
  );

describe('session serializer contract', () => {
  it('matches the recorded Mongo toJSON shape', () => {
    const body = wire();
    expectContract('auth/session.serializer', body);
    expect(body.id).toBe('64b000000000000000000010');
    expect(body).not.toHaveProperty('refreshTokenHash');
    expect(body).not.toHaveProperty('tokenFamily');
    expect(body).not.toHaveProperty('rotatedFromSessionId');
    expect(body).not.toHaveProperty('rotatedToSessionId');
    expect(body).not.toHaveProperty('rotationAttemptId');
    expect(body).not.toHaveProperty('rotationReceiptCiphertext');
    expect(body).not.toHaveProperty('_id');
    expect(body).not.toHaveProperty('__v');
  });
});
