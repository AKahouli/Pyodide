import { Types } from 'mongoose';
import { AdminUserController } from './admin-user.controller';
import { UserStatus } from './user.types';
import { ErrorCode } from '../exceptions/constants/error-codes';

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

describe('AdminUserController.inviteUser', () => {
  const actor = { _id: new Types.ObjectId(), email: 'sa@acme.io' };
  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } };
  const expiresAt = new Date('2026-10-15T12:00:00.000Z');

  const build = (existing: { id: string } | null = null) => {
    const userStore = { findByEmail: jest.fn().mockResolvedValue(existing) };
    const userInvitationService = {
      invite: jest
        .fn()
        .mockResolvedValue({ email: 'jane@acme.io', expiresAt }),
    };
    const auditLogService = { logSuccess: jest.fn() };
    const controller = new AdminUserController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      auditLogService as never,
      userInvitationService as never,
      userStore as never,
    );
    return { controller, userStore, userInvitationService, auditLogService };
  };

  it('invites a new email and writes an audit log', async () => {
    const { controller, userStore, userInvitationService, auditLogService } = build();

    const result = await controller.inviteUser(
      { email: ' Jane@Acme.io ' } as never,
      actor as never,
      req as never,
    );

    // Email is normalized before lookup and invitation.
    expect(userStore.findByEmail).toHaveBeenCalledWith('jane@acme.io');
    expect(userInvitationService.invite).toHaveBeenCalledWith({
      email: 'jane@acme.io',
      invitedById: actor._id.toString(),
    });
    expect(result).toEqual({
      message: 'Invitation sent successfully',
      email: 'jane@acme.io',
      expiresAt,
    });
    expect(auditLogService.logSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'users.invite',
        targetType: 'User',
        metadata: expect.objectContaining({ targetEmail: 'jane@acme.io' }),
      }),
    );
  });

  it('refuses to invite an already-registered email', async () => {
    const { controller, userInvitationService, auditLogService } = build({ id: 'u1' });

    await expect(
      controller.inviteUser({ email: 'jane@acme.io' } as never, actor as never, req as never),
    ).rejects.toMatchObject({ code: ErrorCode.USER_ALREADY_EXISTS });

    expect(userInvitationService.invite).not.toHaveBeenCalled();
    expect(auditLogService.logSuccess).not.toHaveBeenCalled();
  });
});
