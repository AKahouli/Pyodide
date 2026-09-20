import 'reflect-metadata';
import { Types } from 'mongoose';
import { UserSchema } from '@modules/user/schemas/user.schema';
import { expectContract, hydrateDoc } from '../expect-contract';


/**
 * Serializer contract for the Mongo `users` collection — the parity gate the
 * PG mapper (step 1A.8) must satisfy: `id` present, `fullName` virtual,
 * password hash and one-time tokens never serialize.
 */
const wire = (): Record<string, unknown> =>
  JSON.parse(
    JSON.stringify(
      hydrateDoc(UserSchema, {
        _id: new Types.ObjectId('64b000000000000000000001'),
        email: 'jane.doe@example.com',
        passwordHash: '$2b$12$ThisIsNotARealHashThisIsNotARealHash',
        emailVerified: true,
        emailVerificationToken: 'verify-token-should-not-serialize',
        emailVerificationExpiry: new Date('2026-01-31T00:00:00Z'),
        passwordResetToken: 'reset-token-should-not-serialize',
        passwordResetExpiry: new Date('2026-01-02T00:00:00Z'),
        profile: { firstName: 'Jane', lastName: 'Doe', company: 'Acme', role: 'Engineer', description: '' },
        appearance: { colorTheme: 'yellow', language: 'en' },
        consents: { privacyPolicy: true, privacyPolicyAcceptedAt: new Date('2026-01-01T00:00:00Z'), dataSharing: false },
        profileComplete: true,
        planId: new Types.ObjectId('64b000000000000000000002'),
        planSlug: 'unlimited',
        planStartedAt: new Date('2026-01-01T00:00:00Z'),
        roles: [new Types.ObjectId('64b000000000000000000003')],
        permissionsVersion: 1,
        status: 'active',
        registrationApproval: 'approved',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-15T00:00:00Z'),
        lastLoginAt: new Date('2026-01-15T00:00:00Z'),
      }).toJSON(),
    ),
  );

describe('user serializer contract', () => {
  it('matches the recorded Mongo toJSON shape', () => {
    const body = wire();
    expectContract('user/user.serializer', body);
    expect(body.id).toBe('64b000000000000000000001');
    expect(body.fullName).toBe('Jane Doe');
    expect(body).not.toHaveProperty('passwordHash');
    expect(body).not.toHaveProperty('emailVerificationToken');
    expect(body).not.toHaveProperty('passwordResetToken');
    expect(body).not.toHaveProperty('_id');
    expect(body).not.toHaveProperty('__v');
  });
});
