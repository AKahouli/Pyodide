import { Types } from 'mongoose';
import { UserService } from './user.service';

describe('UserService human-agent sync', () => {
  const makeUserDoc = (overrides: Record<string, unknown> = {}) => ({
    _id: new Types.ObjectId(),
    email: 'jane@acme.io',
    profile: {} as Record<string, unknown>,
    consents: {} as Record<string, unknown>,
    profileComplete: false,
    appearance: {},
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  const makeService = (userDoc: unknown) => {
    const userModel = { findById: jest.fn().mockResolvedValue(userDoc) };
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
      userModel as never,
      logger as never,
      configService as never,
      humainAgentService as never,
      registrationApprovalService as never,
    );
    return { service, humainAgentService, registrationApprovalService };
  };

  it('persists role/description and syncs the human agent on completeProfile', async () => {
    const userDoc = makeUserDoc();
    const { service, humainAgentService, registrationApprovalService } = makeService(userDoc);

    await service.completeProfile(userDoc._id.toString(), {
      firstName: 'Jane',
      lastName: 'Doe',
      company: 'Acme',
      privacyPolicy: true,
      dataSharing: false,
      role: 'Product Manager',
      description: 'Leads discovery',
    });

    expect(userDoc.profile.role).toBe('Product Manager');
    expect(userDoc.profile.description).toBe('Leads discovery');
    expect(humainAgentService.syncFromProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: userDoc._id.toString(),
        email: 'jane@acme.io',
        firstName: 'Jane',
        lastName: 'Doe',
        role: 'Product Manager',
        description: 'Leads discovery',
      }),
    );
    expect(registrationApprovalService.notifySuperAdminsOfRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ userId: userDoc._id.toString(), email: 'jane@acme.io' }),
    );
  });

  it('does not notify super admins again when the profile is already complete', async () => {
    const userDoc = makeUserDoc({ profileComplete: true });
    const { service, registrationApprovalService } = makeService(userDoc);

    await service.completeProfile(userDoc._id.toString(), {
      firstName: 'Jane',
      lastName: 'Doe',
      company: 'Acme',
      privacyPolicy: true,
      dataSharing: false,
    });

    expect(registrationApprovalService.notifySuperAdminsOfRegistration).not.toHaveBeenCalled();
  });

  it('syncs the human agent when updateProfile changes profile fields', async () => {
    const userDoc = makeUserDoc();
    const { service, humainAgentService } = makeService(userDoc);

    await service.updateProfile(userDoc._id.toString(), { profile: { role: 'Designer' } });

    expect(humainAgentService.syncFromProfile).toHaveBeenCalledTimes(1);
  });

  it('returns a plain email summary for cross-module composition', async () => {
    const userDoc = makeUserDoc();
    const exec = jest.fn().mockResolvedValue(userDoc);
    const lean = jest.fn(() => ({ exec }));
    const select = jest.fn(() => ({ lean }));
    const userModel = { findById: jest.fn(() => ({ select })) };
    const logger = { setContext: jest.fn() };
    const configService = { get: jest.fn((_key: string, def: unknown) => def) };
    const service = new UserService(
      userModel as never,
      logger as never,
      configService as never,
      {} as never,
      {} as never,
    );

    await expect(service.findSummaryById(userDoc._id.toString())).resolves.toEqual({
      id: userDoc._id.toString(),
      email: 'jane@acme.io',
    });
    expect(select).toHaveBeenCalledWith('email');
  });
});
