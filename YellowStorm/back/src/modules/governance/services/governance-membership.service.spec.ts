import { BadRequestException } from '@modules/exceptions';
import { GovernanceMembershipService } from './governance-membership.service';

describe('GovernanceMembershipService', () => {
  const actorId = '507f1f77bcf86cd799439011';
  const actorEmail = 'owner@example.com';
  const programId = '507f1f77bcf86cd799439012';
  const userId = '507f1f77bcf86cd799439013';
  const groupId = '507f1f77bcf86cd799439014';

  function buildService(duplicate?: Record<string, unknown>, memberships: Record<string, unknown>[] = []) {
    const exec = jest.fn().mockResolvedValue(memberships);
    const lean = jest.fn().mockReturnValue({ exec });
    const populate = jest.fn().mockReturnValue({ lean });
    const findOneExec = jest.fn().mockResolvedValue(duplicate ?? null);
    const membershipModel = {
      findOne: jest.fn().mockReturnValue({ exec: findOneExec, lean: jest.fn().mockReturnValue({ exec: findOneExec }) }),
      create: jest.fn().mockImplementation(async (payload) => ({ _id: { toString: () => 'membership-1' }, ...payload, createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') })),
      find: jest.fn().mockReturnValue({ populate, lean }),
      findById: jest.fn().mockReturnValue({ populate: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }) }) }),
    };
    const programService = { assertOwnedProgram: jest.fn().mockResolvedValue(undefined), assertProgramOwner: jest.fn().mockResolvedValue(undefined) };
    const scopeService = { findById: jest.fn().mockResolvedValue({}) };
    const userGroupService = { findById: jest.fn().mockResolvedValue({ id: groupId }), findGroupIdsForMember: jest.fn().mockResolvedValue([groupId]) };
    const auditLogService = { logSuccess: jest.fn() };
    return { service: new GovernanceMembershipService(membershipModel as never, programService as never, scopeService as never, userGroupService as never, auditLogService as never), membershipModel, userGroupService };
  }

  it('creates active memberships with role permissions', async () => {
    const { service } = buildService();

    const membership = await service.create(actorId, actorEmail, programId, { userId, role: 'scope_viewer' });

    expect(membership.userId).toBe(userId);
    expect(membership.status).toBe('active');
    expect(membership.permissions).toContain('governance.read');
  });

  it('reactivates duplicate memberships for the same program scope and user', async () => {
    const duplicate = { _id: { toString: () => 'existing' }, userId, role: 'scope_viewer', status: 'disabled', permissions: [], save: jest.fn().mockResolvedValue(undefined) };
    const { service, membershipModel } = buildService(duplicate);

    const membership = await service.create(actorId, actorEmail, programId, { userId, role: 'scope_approver' });

    expect(membership.id).toBe('existing');
    expect(duplicate.role).toBe('scope_approver');
    expect(duplicate.status).toBe('active');
    expect(duplicate.save).toHaveBeenCalled();
    expect(membershipModel.create).not.toHaveBeenCalled();
  });

  it('creates group memberships after validating group ownership', async () => {
    const { service, userGroupService } = buildService();

    const membership = await service.create(actorId, actorEmail, programId, { groupId, role: 'scope_viewer' });

    expect(userGroupService.findById).toHaveBeenCalledWith(actorId, groupId);
    expect(membership.groupId).toBe(groupId);
    expect(membership.userId).toBeUndefined();
  });

  it('rejects missing or ambiguous membership targets', async () => {
    const { service } = buildService();

    await expect(service.create(actorId, actorEmail, programId, { role: 'scope_viewer' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(actorId, actorEmail, programId, { userId, groupId, role: 'scope_viewer' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('includes group memberships when resolving accessible scopes', async () => {
    const scopeId = '507f1f77bcf86cd799439015';
    const { service, membershipModel } = buildService(undefined, [{ groupId, scopeId: { toString: () => scopeId }, status: 'active' }]);

    const scopes = await service.getAccessibleScopeIds(userId, programId);

    expect(membershipModel.find).toHaveBeenCalledWith(expect.objectContaining({ $or: expect.arrayContaining([expect.objectContaining({ groupId: expect.any(Object) })]) }));
    expect(scopes).toEqual([scopeId]);
  });
});
