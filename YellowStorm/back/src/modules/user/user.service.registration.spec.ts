import { Types } from 'mongoose';
import { UserService } from './user.service';
import { USER_STORE, type UserRecord, type UserStore } from './persistence/user.store';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn(),
}));

const oid = (): string => new Types.ObjectId().toString();

function record(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: oid(),
    email: 'jane@acme.io',
    passwordHash: 'hash',
    emailVerified: false,
    emailVerificationToken: null,
    emailVerificationExpiry: null,
    passwordResetToken: null,
    passwordResetExpiry: null,
    firstName: null,
    lastName: null,
    company: null,
    profileRole: '',
    description: '',
    colorTheme: 'default',
    language: 'en',
    consentPrivacyPolicy: false,
    consentPrivacyPolicyAcceptedAt: null,
    consentDataSharing: false,
    consentDataSharingAcceptedAt: null,
    profileComplete: false,
    microsoftAccountId: null,
    planId: null,
    planSlug: null,
    planStartedAt: null,
    appBuilderAiOfferId: null,
    appBuilderAiOfferStartedAt: null,
    roleIds: [],
    permissionsVersion: 1,
    status: 'inactive',
    registrationApproval: 'pending',
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Minimal in-memory UserStore fake over a record list. */
function fakeStore(seed: UserRecord[] = []): UserStore {
  const records = [...seed];
  return {
    findById: jest.fn(async (id) => records.find((r) => r.id === id) ?? null),
    findByIds: jest.fn(async (ids) => new Map(records.filter((r) => ids.includes(r.id)).map((r) => [r.id, r]))),
    findByIdWithRoles: jest.fn(async (id) => { const r = records.find((x) => x.id === id); return r ? { ...r, roles: [] } : null; }),
    findByEmail: jest.fn(async (email) => records.find((r) => r.email === email.toLowerCase()) ?? null),
    findByEmails: jest.fn(async () => new Map()),
    findByVerificationToken: jest.fn(async (token) => records.find((r) => r.emailVerificationToken === token) ?? null),
    findByResetTokenHash: jest.fn(async (hash) => records.find((r) => r.passwordResetToken === hash) ?? null),
    findByMicrosoftAccountId: jest.fn(async () => null),
    existsByEmail: jest.fn(async () => false),
    create: jest.fn(async (init) => {
      const created = record({
        email: init.email,
        passwordHash: init.passwordHash,
        emailVerified: init.emailVerified ?? false,
        emailVerificationToken: init.emailVerificationToken ?? null,
        emailVerificationExpiry: init.emailVerificationExpiry ?? null,
        firstName: init.firstName ?? null,
        lastName: init.lastName ?? null,
        profileRole: init.profileRole ?? '',
        description: init.description ?? '',
        microsoftAccountId: init.microsoftAccountId ?? null,
        profileComplete: init.profileComplete ?? false,
        status: init.status ?? 'active',
        registrationApproval: init.registrationApproval ?? null,
        roleIds: init.roleIds ?? [],
      });
      records.push(created);
      return created;
    }),
    update: jest.fn(async (id, patch) => {
      const target = records.find((r) => r.id === id);
      if (!target) return null;
      Object.assign(target, patch);
      return target;
    }),
    searchActive: jest.fn(async () => []),
    listActive: jest.fn(async () => []),
    findWithoutPlan: jest.fn(async () => []),
    listAdmin: jest.fn(async () => ({ users: [], total: 0 })),
    countByStatus: jest.fn(async () => ({ active: 0, inactive: 0, suspended: 0 })),
    findActiveByRole: jest.fn(async () => []),
    setColorThemeForAll: jest.fn(async () => undefined),
    addRole: jest.fn(async () => undefined),
    removeRole: jest.fn(async () => undefined),
    removeRoleFromAll: jest.fn(async () => undefined),
    bumpPermissionsVersion: jest.fn(async () => undefined),
    addRoleAndBump: jest.fn(async () => undefined),
    removeRoleAndBump: jest.fn(async () => undefined),
  };
}

const makeService = (store: UserStore) => {
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
  const configService = { get: jest.fn((_key: string, def: unknown) => def) };
  return new UserService(
    store,
    logger as never,
    configService as never,
    { ensureForUser: jest.fn(), syncFromProfile: jest.fn() } as never,
    { notifySuperAdminsOfRegistration: jest.fn() } as never,
  );
};

describe('UserService classic registration status', () => {
  it('creates classic users as inactive and pending approval', async () => {
    const store = fakeStore();
    const service = makeService(store);

    const user = await service.create({ email: 'jane@acme.io', password: 'Str0ng!pass' });

    expect(user.status).toBe('inactive');
    expect(user.registrationApproval).toBe('pending');
    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'inactive', registrationApproval: 'pending' }));
  });

  it('does not set inactive or pending on OAuth user creation', async () => {
    const store = fakeStore();
    const service = makeService(store);

    const user = await service.createOAuthUser({
      email: 'oauth@acme.io',
      profile: { firstName: 'OAuth' },
    });

    expect(user.status).toBe('active'); // store default
    expect(user.registrationApproval).toBeUndefined();
    expect(store.create).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'inactive' }));
  });

  it('keeps status and approval unchanged when verifying email', async () => {
    const stored = record({ emailVerified: false, emailVerificationToken: 'a'.repeat(64), emailVerificationExpiry: new Date(Date.now() + 60_000) });
    const store = fakeStore([stored]);
    const service = makeService(store);

    const verified = await service.verifyEmail('a'.repeat(64));

    expect(verified.emailVerified).toBe(true);
    expect(verified.status).toBe('inactive');
    expect(verified.registrationApproval).toBe('pending');
    expect(store.update).toHaveBeenCalledWith(stored.id, { emailVerified: true, emailVerificationExpiry: null });
  });

  it('keeps a rejected user inactive when verifying email', async () => {
    const stored = record({ emailVerified: false, emailVerificationToken: 'b'.repeat(64), emailVerificationExpiry: new Date(Date.now() + 60_000), registrationApproval: 'rejected' });
    const store = fakeStore([stored]);
    const service = makeService(store);

    const verified = await service.verifyEmail('b'.repeat(64));

    expect(verified.emailVerified).toBe(true);
    expect(verified.status).toBe('inactive');
    expect(verified.registrationApproval).toBe('rejected');
  });
});
