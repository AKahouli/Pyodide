import { Types } from 'mongoose';
import { RegistrationApprovalService } from './registration-approval.service';
import { EmailTemplateRenderer } from '../email';
import { RegistrationApproval, UserStatus } from './schemas/user.schema';
import { ErrorCode } from '../exceptions/constants/error-codes';

describe('RegistrationApprovalService', () => {
  const applicant = {
    userId: new Types.ObjectId().toString(),
    email: 'jane@acme.io',
    requestedAt: new Date('2026-09-02T12:00:00.000Z'),
  };
  const superAdminId = new Types.ObjectId();

  const makeService = (overrides: {
    emails?: Array<{ email: string }>;
    role?: { id: string; name: string } | null;
    emailAvailable?: boolean;
    sendResult?: { success: boolean; error?: string; attempts: number };
  } = {}) => {
    const lean = jest.fn().mockResolvedValue(overrides.emails ?? [{ email: 'sa@acme.io' }]);
    const select = jest.fn().mockReturnValue({ lean });
    const userModel = {
      find: jest.fn().mockReturnValue({ select }),
    };
    const authorizationService = {
      findRoleByName: jest.fn().mockResolvedValue(
        overrides.role === undefined
          ? { id: superAdminId.toString(), name: 'super_admin' }
          : overrides.role,
      ),
    };
    const emailService = {
      isAvailable: jest.fn().mockReturnValue(overrides.emailAvailable ?? true),
      send: jest.fn().mockResolvedValue(
        overrides.sendResult ?? { success: true, attempts: 1 },
      ),
    };
    const configService = {
      get: jest.fn((key: string, def: unknown) => {
        if (key === 'app.name') return 'YelloStorm';
        if (key === 'app.frontendUrl') return 'http://localhost:5173';
        return def;
      }),
    };
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const emailTemplateRenderer = new EmailTemplateRenderer(configService as never, logger as never);
    const service = new RegistrationApprovalService(
      userModel as never,
      authorizationService as never,
      emailService as never,
      emailTemplateRenderer as never,
      configService as never,
      logger as never,
    );
    return { service, userModel, authorizationService, emailService, logger, lean };
  };

  it('sends a review email to active super admins', async () => {
    const { service, emailService, userModel } = makeService();

    await service.notifySuperAdminsOfRegistration(applicant);

    expect(userModel.find).toHaveBeenCalledWith({
      roles: new Types.ObjectId(superAdminId.toString()),
      status: UserStatus.ACTIVE,
    });
    expect(emailService.send).toHaveBeenCalledTimes(1);
    const payload = emailService.send.mock.calls[0][0];
    expect(payload.to).toBe('sa@acme.io');
    expect(payload.subject).toContain('New registration request');
    expect(payload.html).toContain('jane@acme.io');
    expect(payload.html).toContain('http://localhost:5173/#/admin/users');
    expect(payload.html).not.toContain(applicant.userId);
    expect(payload.html).not.toContain('User ID');
    expect(payload.html).not.toContain('2026-09-02T12:00:00.000Z');
    expect(payload.html).toContain('02/09/2026 à 14:00');
    expect(payload.text).toContain('jane@acme.io');
    expect(payload.text).toContain('http://localhost:5173/#/admin/users');
  });

  it('skips sending when email service is unavailable', async () => {
    const { service, emailService, logger } = makeService({ emailAvailable: false });

    await expect(service.notifySuperAdminsOfRegistration(applicant)).resolves.toBeUndefined();
    expect(emailService.send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('skips sending when no super admin exists', async () => {
    const { service, emailService, logger } = makeService({ role: null });

    await expect(service.notifySuperAdminsOfRegistration(applicant)).resolves.toBeUndefined();
    expect(emailService.send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('skips sending when no active super admin users are found', async () => {
    const { service, emailService, logger } = makeService({ emails: [] });

    await expect(service.notifySuperAdminsOfRegistration(applicant)).resolves.toBeUndefined();
    expect(emailService.send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('does not throw when sending fails', async () => {
    const { service, logger } = makeService({
      sendResult: { success: false, error: 'smtp down', attempts: 1 },
    });

    await expect(service.notifySuperAdminsOfRegistration(applicant)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('does not throw when recipient lookup fails', async () => {
    const { service, authorizationService, logger, emailService } = makeService();
    authorizationService.findRoleByName.mockRejectedValue(new Error('db down'));

    await expect(service.notifySuperAdminsOfRegistration(applicant)).resolves.toBeUndefined();
    expect(emailService.send).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('RegistrationApprovalService decisions', () => {
  const userId = new Types.ObjectId();

  const makeUserDoc = (overrides: Record<string, unknown> = {}) => ({
    _id: userId,
    email: 'jane@acme.io',
    status: UserStatus.INACTIVE,
    registrationApproval: RegistrationApproval.PENDING,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  const makeDecisionService = (user: ReturnType<typeof makeUserDoc> | null, sendResult?: { success: boolean; error?: string; attempts: number }) => {
    const userModel = {
      find: jest.fn(),
      findById: jest.fn().mockResolvedValue(user),
    };
    const emailService = {
      isAvailable: jest.fn().mockReturnValue(true),
      send: jest.fn().mockResolvedValue(sendResult ?? { success: true, attempts: 1 }),
    };
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const configService = {
      get: jest.fn((key: string, def: unknown) => {
        if (key === 'app.name') return 'YelloStorm';
        if (key === 'app.frontendUrl') return 'http://localhost:5173';
        return def;
      }),
    };
    const emailTemplateRenderer = new EmailTemplateRenderer(configService as never, logger as never);
    const service = new RegistrationApprovalService(
      userModel as never,
      { findRoleByName: jest.fn() } as never,
      emailService as never,
      emailTemplateRenderer as never,
      configService as never,
      logger as never,
    );
    return { service, userModel, emailService, logger };
  };

  it('approves an inactive pending user and sends a confirmation email', async () => {
    const user = makeUserDoc();
    const { service, emailService } = makeDecisionService(user);

    const result = await service.approveRegistration(userId.toString());

    expect(result).toMatchObject({
      changed: true,
      email: 'jane@acme.io',
      status: UserStatus.ACTIVE,
      registrationApproval: RegistrationApproval.APPROVED,
    });
    expect(user.save).toHaveBeenCalled();
    expect(emailService.send).toHaveBeenCalledTimes(1);
    expect(emailService.send.mock.calls[0][0].to).toBe('jane@acme.io');
    expect(emailService.send.mock.calls[0][0].subject).toContain('approved');
    expect(emailService.send.mock.calls[0][0].html).toContain('http://localhost:5173/#/');
  });

  it('is a no-op when the registration is already approved', async () => {
    const user = makeUserDoc({
      status: UserStatus.ACTIVE,
      registrationApproval: RegistrationApproval.APPROVED,
    });
    const { service, emailService } = makeDecisionService(user);

    const result = await service.approveRegistration(userId.toString());

    expect(result.changed).toBe(false);
    expect(user.save).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('reactivates a rejected user and sends a confirmation email', async () => {
    const user = makeUserDoc({ registrationApproval: RegistrationApproval.REJECTED });
    const { service, emailService } = makeDecisionService(user);

    const result = await service.approveRegistration(userId.toString());

    expect(result.changed).toBe(true);
    expect(result.status).toBe(UserStatus.ACTIVE);
    expect(result.registrationApproval).toBe(RegistrationApproval.APPROVED);
    expect(emailService.send).toHaveBeenCalledTimes(1);
  });

  it('still approves when the confirmation email fails', async () => {
    const user = makeUserDoc();
    const { service, logger } = makeDecisionService(user, {
      success: false,
      error: 'smtp down',
      attempts: 1,
    });

    await expect(service.approveRegistration(userId.toString())).resolves.toMatchObject({
      changed: true,
      status: UserStatus.ACTIVE,
    });
    expect(logger.error).toHaveBeenCalled();
  });

  it('rejects an inactive pending user without sending email', async () => {
    const user = makeUserDoc();
    const { service, emailService } = makeDecisionService(user);

    const result = await service.rejectRegistration(userId.toString());

    expect(result).toMatchObject({
      changed: true,
      status: UserStatus.INACTIVE,
      registrationApproval: RegistrationApproval.REJECTED,
    });
    expect(user.save).toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('is a no-op when the registration is already rejected', async () => {
    const user = makeUserDoc({ registrationApproval: RegistrationApproval.REJECTED });
    const { service } = makeDecisionService(user);

    const result = await service.rejectRegistration(userId.toString());

    expect(result.changed).toBe(false);
    expect(user.status).toBe(UserStatus.INACTIVE);
    expect(user.save).not.toHaveBeenCalled();
  });

  it('does not approve a suspended account', async () => {
    const { service } = makeDecisionService(
      makeUserDoc({ status: UserStatus.SUSPENDED, registrationApproval: undefined }),
    );

    await expect(service.approveRegistration(userId.toString())).rejects.toMatchObject({
      code: ErrorCode.BAD_REQUEST,
    });
  });

  it('does not reject an active account', async () => {
    const { service } = makeDecisionService(
      makeUserDoc({ status: UserStatus.ACTIVE, registrationApproval: RegistrationApproval.APPROVED }),
    );

    await expect(service.rejectRegistration(userId.toString())).rejects.toMatchObject({
      code: ErrorCode.BAD_REQUEST,
    });
  });

  it('throws when the user does not exist', async () => {
    const { service } = makeDecisionService(null);

    await expect(service.approveRegistration(userId.toString())).rejects.toMatchObject({
      code: ErrorCode.USER_NOT_FOUND,
    });
  });
});

