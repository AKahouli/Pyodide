import { Types } from 'mongoose';
import { AdminUserController } from './admin-user.controller';
import { UserStatus } from '../user.types';
import { ErrorCode } from '../../exceptions/constants/error-codes';

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

  const build = (options: {
    existing?: { id: string } | null;
    activeRoles?: { id: string; name: string }[];
  } = {}) => {
    const userStore = { findByEmail: jest.fn().mockResolvedValue(options.existing ?? null) };
    const userInvitationService = {
      invite: jest
        .fn()
        .mockResolvedValue({ email: 'jane@acme.io', expiresAt }),
    };
    const usageService = {
      getPlanById: jest.fn().mockResolvedValue({ id: 'plan-9', slug: 'pro' }),
    };
    const authorizationService = {
      findActiveRoles: jest
        .fn()
        .mockResolvedValue(options.activeRoles ?? [{ id: 'role-1', name: 'Member' }]),
    };
    const auditLogService = { logSuccess: jest.fn() };
    const controller = new AdminUserController(
      {} as never,
      {} as never,
      usageService as never,
      authorizationService as never,
      auditLogService as never,
      userInvitationService as never,
      userStore as never,
    );
    return { controller, userStore, userInvitationService, usageService, authorizationService, auditLogService };
  };

  it('invites a new email without grants and writes an audit log', async () => {
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
      roleIds: [],
      planId: null,
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
        metadata: expect.objectContaining({ targetEmail: 'jane@acme.io', roleIds: [], planId: null }),
      }),
    );
  });

  it('carries the chosen roles and plan onto the invitation', async () => {
    const { controller, userInvitationService, usageService, auditLogService } = build({
      activeRoles: [
        { id: 'role-1', name: 'Member' },
        { id: 'role-2', name: 'Editor' },
      ],
    });

    await controller.inviteUser(
      { email: 'jane@acme.io', roleIds: ['role-1', 'role-2', 'role-1'], planId: 'plan-9' } as never,
      actor as never,
      req as never,
    );

    expect(usageService.getPlanById).toHaveBeenCalledWith('plan-9');
    // Role ids are deduplicated before they are persisted.
    expect(userInvitationService.invite).toHaveBeenCalledWith({
      email: 'jane@acme.io',
      invitedById: actor._id.toString(),
      roleIds: ['role-1', 'role-2'],
      planId: 'plan-9',
    });
    expect(auditLogService.logSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ roleIds: ['role-1', 'role-2'], planId: 'plan-9' }),
      }),
    );
  });

  it('rejects an unknown or inactive role', async () => {
    const { controller, userInvitationService } = build({ activeRoles: [{ id: 'role-1', name: 'Member' }] });

    await expect(
      controller.inviteUser(
        { email: 'jane@acme.io', roleIds: ['role-x'] } as never,
        actor as never,
        req as never,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });

    expect(userInvitationService.invite).not.toHaveBeenCalled();
  });

  it('refuses to invite an already-registered email', async () => {
    const { controller, userInvitationService, auditLogService } = build({ existing: { id: 'u1' } });

    await expect(
      controller.inviteUser({ email: 'jane@acme.io' } as never, actor as never, req as never),
    ).rejects.toMatchObject({ code: ErrorCode.USER_ALREADY_EXISTS });

    expect(userInvitationService.invite).not.toHaveBeenCalled();
    expect(auditLogService.logSuccess).not.toHaveBeenCalled();
  });
});
