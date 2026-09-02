import { Types } from 'mongoose';
import { UserService } from './user.service';
import { RegistrationApproval, UserStatus } from './schemas/user.schema';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn(),
}));

describe('UserService classic registration status', () => {
  const makeCreateModel = () => {
    const docs: Array<Record<string, unknown>> = [];

    class MockUserModel {
      _id = new Types.ObjectId();
      save = jest.fn().mockResolvedValue(this);

      constructor(data: Record<string, unknown>) {
        Object.assign(this, data);
        docs.push(this as unknown as Record<string, unknown>);
      }

      static findOne = jest.fn().mockResolvedValue(null);
    }

    return { MockUserModel, docs };
  };

  const makeService = (userModel: unknown) => {
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
    const configService = { get: jest.fn((_key: string, def: unknown) => def) };
    return new UserService(
      userModel as never,
      logger as never,
      configService as never,
      { ensureForUser: jest.fn(), syncFromProfile: jest.fn() } as never,
    );
  };

  it('creates classic users as inactive and pending approval', async () => {
    const { MockUserModel, docs } = makeCreateModel();
    const service = makeService(MockUserModel);

    const user = await service.create({ email: 'jane@acme.io', password: 'Str0ng!pass' });

    expect(user.status).toBe(UserStatus.INACTIVE);
    expect(user.registrationApproval).toBe(RegistrationApproval.PENDING);
    expect(docs[0]).toMatchObject({
      status: UserStatus.INACTIVE,
      registrationApproval: RegistrationApproval.PENDING,
    });
  });

  it('does not set inactive or pending on OAuth user creation', async () => {
    const { MockUserModel, docs } = makeCreateModel();
    const service = makeService(MockUserModel);

    const user = await service.createOAuthUser({
      email: 'oauth@acme.io',
      profile: { firstName: 'OAuth' },
    });

    expect(user.status).toBeUndefined();
    expect(user.registrationApproval).toBeUndefined();
    expect(docs[0]).not.toHaveProperty('status', UserStatus.INACTIVE);
    expect(docs[0]).not.toHaveProperty('registrationApproval');
  });

  it('keeps status and approval unchanged when verifying email', async () => {
    const userDoc = {
      _id: new Types.ObjectId(),
      emailVerified: false,
      emailVerificationExpiry: new Date(Date.now() + 60_000),
      status: UserStatus.INACTIVE,
      registrationApproval: RegistrationApproval.PENDING,
      save: jest.fn().mockResolvedValue(undefined),
    };
    const userModel = {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue(userDoc),
      }),
    };
    const service = makeService(userModel);

    const verified = await service.verifyEmail('a'.repeat(64));

    expect(verified.emailVerified).toBe(true);
    expect(verified.status).toBe(UserStatus.INACTIVE);
    expect(verified.registrationApproval).toBe(RegistrationApproval.PENDING);
  });

  it('keeps a rejected user inactive when verifying email', async () => {
    const userDoc = {
      _id: new Types.ObjectId(),
      emailVerified: false,
      emailVerificationExpiry: new Date(Date.now() + 60_000),
      status: UserStatus.INACTIVE,
      registrationApproval: RegistrationApproval.REJECTED,
      save: jest.fn().mockResolvedValue(undefined),
    };
    const userModel = {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue(userDoc),
      }),
    };
    const service = makeService(userModel);

    const verified = await service.verifyEmail('b'.repeat(64));

    expect(verified.emailVerified).toBe(true);
    expect(verified.status).toBe(UserStatus.INACTIVE);
    expect(verified.registrationApproval).toBe(RegistrationApproval.REJECTED);
  });
});
