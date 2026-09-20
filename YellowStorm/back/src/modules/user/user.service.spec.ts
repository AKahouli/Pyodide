import { Types } from 'mongoose';
import { UserService } from './user.service';
import { USER_STORE, type UserRecord, type UserStore } from './persistence/user.store';

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
    roleIds: [],
    permissionsVersion: 1,
    status: 'active',
    registrationApproval: 'pending',
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** In-memory store whose update applies patches to the stored record. */
function fakeStore(seed: UserRecord[]): UserStore {
  const records = [...seed];
  const apply = (target: UserRecord, patch: Partial<UserRecord>): UserRecord => {
    Object.assign(target, patch);
    return target;
  };
  return {
    findById: jest.fn(async (id) => records.find((r) => r.id === id) ?? null),
    findByIds: jest.fn(async () => new Map()),
    findByIdWithRoles: jest.fn(async (id) => { const r = records.find((x) => x.id === id); return r ? { ...r, roles: [] } : null; }),
    findByEmail: jest.fn(async () => null),
    findByEmails: jest.fn(async () => new Map()),
    findByVerificationToken: jest.fn(async () => null),
    findByResetTokenHash: jest.fn(async () => null),
    findByMicrosoftAccountId: jest.fn(async () => null),
    existsByEmail: jest.fn(async () => false),
    create: jest.fn(async (init) => record({ email: init.email })),
    update: jest.fn(async (id, patch) => {
      const target = records.find((r) => r.id === id);
      return target ? apply(target, patch as Partial<UserRecord>) : null;
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
  };
}

const makeService = (store: UserStore) => {
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
  const configService = { get: jest.fn((_key: string, def: unknown) => def) };
  const humainAgentService = {
    ensureForUser: jest.fn().mockResolvedValue(undefined),
    syncFromProfile: jest.fn().mockResolvedValue(undefined),
  };
  const registrationApprovalService = {
    notifySuperAdminsOfRegistration: jest.fn().mockResolvedValue(undefined),
  };
  const service = new UserService(
    store,
    logger as never,
    configService as never,
    humainAgentService as never,
    registrationApprovalService as never,
  );
  return { service, humainAgentService, registrationApprovalService, store };
};

describe('UserService human-agent sync', () => {
  it('persists role/description and syncs the human agent on completeProfile', async () => {
    const stored = record({ registrationApproval: 'pending' });
    const { service, humainAgentService, registrationApprovalService } = makeService(fakeStore([stored]));

    await service.completeProfile(stored.id, {
      firstName: 'Jane',
      lastName: 'Doe',
      company: 'Acme',
      privacyPolicy: true,
      dataSharing: false,
      role: 'Product Manager',
      description: 'Leads discovery',
    });

    expect(stored.profileRole).toBe('Product Manager');
    expect(stored.description).toBe('Leads discovery');
    expect(stored.profileComplete).toBe(true);
    expect(humainAgentService.syncFromProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: stored.id,
        email: 'jane@acme.io',
        firstName: 'Jane',
        lastName: 'Doe',
        role: 'Product Manager',
        description: 'Leads discovery',
      }),
    );
    expect(registrationApprovalService.notifySuperAdminsOfRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ userId: stored.id, email: 'jane@acme.io' }),
    );
  });

  it('does not notify super admins again when the profile is already complete', async () => {
    const stored = record({ profileComplete: true });
    const { service, registrationApprovalService } = makeService(fakeStore([stored]));

    await service.completeProfile(stored.id, {
      firstName: 'Jane',
      lastName: 'Doe',
      company: 'Acme',
      privacyPolicy: true,
      dataSharing: false,
    });

    expect(registrationApprovalService.notifySuperAdminsOfRegistration).not.toHaveBeenCalled();
  });

  it('syncs the human agent when updateProfile changes profile fields', async () => {
    const stored = record();
    const { service, humainAgentService } = makeService(fakeStore([stored]));

    await service.updateProfile(stored.id, { profile: { role: 'Designer' } });

    expect(humainAgentService.syncFromProfile).toHaveBeenCalledTimes(1);
    expect(stored.profileRole).toBe('Designer');
  });

  it('returns a plain email summary for cross-module composition', async () => {
    const stored = record();
    const store = fakeStore([stored]);
    const { service } = makeService(store);

    await expect(service.findSummaryById(stored.id)).resolves.toEqual({
      id: stored.id,
      email: 'jane@acme.io',
    });
    expect(store.findById).toHaveBeenCalledWith(stored.id);
  });
});
