import 'reflect-metadata';
import { expectContract } from '../expect-contract';
import { toUserWire, toAuthUser } from '@modules/user/persistence/user-record.mapper';
import type { UserRecord } from '@modules/user/persistence/user.store';

/**
 * Acceptance gate for the PG user mapper (plan 1A.8) against the SAME wire
 * fixture recorded from the Mongo schema toJSON. The mapper output must stay
 * byte-compatible across the cutover.
 */
const record: UserRecord = {
  id: '64b000000000000000000001',
  email: 'jane.doe@example.com',
  passwordHash: '$2b$12$ThisIsNotARealHashThisIsNotARealHash',
  emailVerified: true,
  emailVerificationToken: 'verify-token-should-not-serialize',
  emailVerificationExpiry: new Date('2026-01-31T00:00:00Z'),
  passwordResetToken: 'reset-token-should-not-serialize',
  passwordResetExpiry: new Date('2026-01-02T00:00:00Z'),
  firstName: 'Jane',
  lastName: 'Doe',
  company: 'Acme',
  profileRole: 'Engineer',
  description: '',
  colorTheme: 'yellow',
  language: 'en',
  consentPrivacyPolicy: true,
  consentPrivacyPolicyAcceptedAt: new Date('2026-01-01T00:00:00Z'),
  consentDataSharing: false,
  consentDataSharingAcceptedAt: null,
  profileComplete: true,
  microsoftAccountId: null,
  planId: '64b000000000000000000002',
  planSlug: 'unlimited',
  planStartedAt: new Date('2026-01-01T00:00:00Z'),
  appBuilderAiOfferId: null,
  appBuilderAiOfferStartedAt: null,
  roleIds: ['64b000000000000000000003'],
  permissionsVersion: 1,
  status: 'active',
  registrationApproval: 'approved',
  lastLoginAt: new Date('2026-01-15T00:00:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-15T00:00:00Z'),
};

describe('user-record mapper contract', () => {
  it('toUserWire matches the Mongo toJSON fixture', () => {
    const body = JSON.parse(JSON.stringify(toUserWire(record)));
    expectContract('user/user.serializer', body);
    expect(body.id).toBe(record.id);
    expect(body.fullName).toBe('Jane Doe');
    expect(body).not.toHaveProperty('passwordHash');
    expect(body).not.toHaveProperty('emailVerificationToken');
    expect(body).not.toHaveProperty('passwordResetToken');
    expect(body).not.toHaveProperty('_id');
  });

  it('toUserWire omits unset optional columns instead of emitting nulls', () => {
    const wire = toUserWire({ ...record, planId: null, planSlug: null, planStartedAt: null, lastLoginAt: null, microsoftAccountId: null, registrationApproval: null });
    expect(wire).not.toHaveProperty('planId');
    expect(wire).not.toHaveProperty('planSlug');
    expect(wire).not.toHaveProperty('planStartedAt');
    expect(wire).not.toHaveProperty('lastLoginAt');
    expect(wire).not.toHaveProperty('microsoftAccountId');
    expect(wire).not.toHaveProperty('registrationApproval');
  });

  it('toAuthUser returns the AuthUser shape with string ids and claims', () => {
    const authUser = toAuthUser(record, { permissions: ['users.read'], roleNames: ['super_admin'] });
    expect(authUser._id).toBe(record.id);
    expect(authUser.id).toBe(record.id);
    expect(authUser.roles).toEqual(record.roleIds);
    expect(authUser.permissions).toEqual(['users.read']);
    expect(authUser.roleNames).toEqual(['super_admin']);
    expect(authUser.appearance).toEqual({ colorTheme: 'yellow', language: 'en' });
    expect(authUser).not.toHaveProperty('passwordHash');
  });
});
