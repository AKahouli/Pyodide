import { Types } from 'mongoose';
import { AdminUserController } from './admin-user.controller';
import { UserStatus } from './schemas/user.schema';

describe('AdminUserController registration decisions', () => {
  const actor = { _id: new Types.ObjectId(), email: 'sa@acme.io' };
  const targetId = new Types.ObjectId().toString();
  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } };

  const build = () => {
    const registrationApprovalService = {
      approveRegistration: jest.fn().mockResolvedValue({
        changed: true,
        userId: targetId,
        email: 'jane@acme.io',
        status: UserStatus.ACTIVE,
        registrationApproval: 'approved',
      }),
      rejectRegistration: jest.fn().mockResolvedValue({
        changed: true,
        userId: targetId,
        email: 'jane@acme.io',
        status: UserStatus.INACTIVE,
        registrationApproval: 'rejected',
      }),
    };
    const auditLogService = { logSuccess: jest.fn() };
    const controller = new AdminUserController(
      {} as never,
      registrationApprovalService as never,
      {} as never,
      {} as never,
      auditLogService as never,
      {} as never,
    );
    return { controller, registrationApprovalService, auditLogService };
  };

  it('approves registration and writes an audit log', async () => {
    const { controller, registrationApprovalService, auditLogService } = build();

    await expect(
      controller.approveRegistration(targetId, actor as never, req as never),
    ).resolves.toEqual({ message: 'Registration approved' });

    expect(registrationApprovalService.approveRegistration).toHaveBeenCalledWith(targetId);
    expect(auditLogService.logSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'users.approve_registration',
        targetId,
        metadata: expect.objectContaining({ targetEmail: 'jane@acme.io', changed: true }),
      }),
    );
  });

  it('rejects registration and writes an audit log', async () => {
    const { controller, registrationApprovalService, auditLogService } = build();

    await expect(
      controller.rejectRegistration(targetId, actor as never, req as never),
    ).resolves.toEqual({ message: 'Registration rejected' });

    expect(registrationApprovalService.rejectRegistration).toHaveBeenCalledWith(targetId);
    expect(auditLogService.logSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'users.reject_registration',
        targetId,
      }),
    );
  });
});
