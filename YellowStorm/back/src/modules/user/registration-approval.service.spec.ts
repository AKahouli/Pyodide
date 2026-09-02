import { Types } from 'mongoose';
import { RegistrationApprovalService } from './registration-approval.service';
import { UserStatus } from './schemas/user.schema';

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
    const service = new RegistrationApprovalService(
      userModel as never,
      authorizationService as never,
      emailService as never,
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
    expect(payload.html).toContain(applicant.userId);
    expect(payload.html).toContain(`review=${applicant.userId}`);
    expect(payload.html).toContain('decision=approve');
    expect(payload.html).toContain('decision=reject');
    expect(payload.text).toContain('jane@acme.io');
    expect(payload.text).toContain(`/#/admin/users?status=inactive&review=${applicant.userId}`);
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
