import { BadRequestException } from '@modules/exceptions';
import { GovernanceMembershipService } from './governance-membership.service';

describe('GovernanceMembershipService', () => {
  const actorId = '507f1f77bcf86cd799439011';
  const actorEmail = 'owner@example.com';
  const programId = '507f1f77bcf86cd799439012';
  const userId = '507f1f77bcf86cd799439013';
  const groupId = '507f1f77bcf86cd799439014';
  const membershipId = '507f1f77bcf86cd799439016';

  function buildService(duplicate?: Record<string, unknown>, memberships: Record<string, unknown>[] = [], isProgramOwner = true, activeScopeIds: string[] = []) {
    const exec = jest.fn().mockResolvedValue(memberships);
    const lean = jest.fn().mockReturnValue({ exec });
    const sort = jest.fn().mockReturnValue({ lean });
    const findOneExec = jest.fn().mockResolvedValue(duplicate ?? null);
    const membershipModel = {
      findOne: jest.fn().mockReturnValue({ exec: findOneExec, lean: jest.fn().mockReturnValue({ exec: findOneExec }) }),
      create: jest.fn().mockImplementation(async (payload) => ({ _id: { toString: () => 'membership-1' }, ...payload, createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') })),
      deleteOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 1 }) }),
      find: jest.fn().mockReturnValue({ populate: jest.fn().mockReturnValue({ sort }), lean }),
      findById: jest.fn().mockReturnValue({ populate: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }) }) }),
    };
    const programService = { assertOwnedProgram: jest.fn().mockResolvedValue(undefined), assertProgramOwner: jest.fn().mockImplementation(async () => { if (!isProgramOwner) throw new Error('not owner'); }) };
    const scopeService = { findById: jest.fn().mockResolvedValue({}) };
    const userGroupService = { findById: jest.fn().mockResolvedValue({ id: groupId }), findGroupIdsForMember: jest.fn().mockResolvedValue([groupId]) };
    const auditLogService = { logSuccess: jest.fn() };
    const draftPreparationService = { prepare: jest.fn().mockResolvedValue(undefined) };
    const scopeModel = { find: jest.fn().mockReturnValue({ select: () => ({ lean: () => ({ exec: jest.fn().mockResolvedValue(activeScopeIds.map((id) => ({ _id: { toString: () => id } }))) }) }) }) };
    return { service: new GovernanceMembershipService(membershipModel as never, scopeModel as never, programService as never, scopeService as never, userGroupService as never, auditLogService as never, draftPreparationService as never), membershipModel, userGroupService, auditLogService, draftPreparationService };
  }

  it('creates active memberships with role permissions', async () => {
    const { service } = buildService();

    const membership = await service.create(actorId, actorEmail, programId, { userId, role: 'scope_viewer' });

    expect(membership.userId).toBe(userId);
    expect(membership.status).toBe('active');
    expect(membership.permissions).toContain('governance.read');
  });

  it('reactivates duplicate memberships for the same program scope and user', async () => {
    const duplicate: Record<string, unknown> & { save: jest.Mock } = { _id: { toString: () => 'existing' }, userId, role: 'scope_viewer', status: 'disabled', permissions: [], save: jest.fn().mockResolvedValue(undefined) };
    const { service, membershipModel } = buildService(duplicate);

    const membership = await service.create(actorId, actorEmail, programId, { userId, role: 'scope_approver' });

    expect(membership.id).toBe('existing');
    expect(duplicate.role).toBe('scope_approver');
    expect(duplicate.status).toBe('active');
    expect(duplicate.permissions).toContain('governance.publish');
    expect(duplicate.save).toHaveBeenCalled();
    expect(membershipModel.create).not.toHaveBeenCalled();
  });

  it('reuses memberships when a duplicate key is created concurrently', async () => {
    const duplicate: Record<string, unknown> & { save: jest.Mock } = { _id: { toString: () => 'existing' }, userId, role: 'scope_viewer', status: 'disabled', permissions: [], save: jest.fn().mockResolvedValue(undefined) };
    const { service, membershipModel, auditLogService } = buildService();
    membershipModel.create.mockRejectedValueOnce({ code: 11000 });
    membershipModel.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null), lean: jest.fn() });
    membershipModel.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(duplicate), lean: jest.fn() });

    const membership = await service.create(actorId, actorEmail, programId, { userId, role: 'scope_approver' });

    expect(membership.id).toBe('existing');
    expect(duplicate.role).toBe('scope_approver');
    expect(duplicate.status).toBe('active');
    expect(duplicate.permissions).toContain('governance.publish');
    expect((duplicate.invitedBy as { toString(): string }).toString()).toBe(actorId);
    expect(duplicate.save).toHaveBeenCalled();
    expect(auditLogService.logSuccess).toHaveBeenCalledWith(expect.objectContaining({ action: 'governance.membership.updated', metadata: expect.objectContaining({ reason: 'reactivated_existing' }) }));
    expect(auditLogService.logSuccess).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'governance.membership.invited' }));
  });

  it('creates group memberships after validating group ownership', async () => {
    const { service, userGroupService } = buildService();

    const membership = await service.create(actorId, actorEmail, programId, { groupId, role: 'scope_viewer' });

    expect(userGroupService.findById).toHaveBeenCalledWith(actorId, groupId);
    expect(membership.groupId).toBe(groupId);
    expect(membership.userId).toBeUndefined();
  });

  it('prepares every active scope when a program-level ownership assignment changes', async () => {
    const scopeIds = ['507f1f77bcf86cd799439015', '507f1f77bcf86cd799439017'];
    const { service, draftPreparationService } = buildService(undefined, [], true, scopeIds);

    await service.create(actorId, actorEmail, programId, { userId, role: 'program_admin' });

    expect(draftPreparationService.prepare).toHaveBeenCalledTimes(2);
    expect(draftPreparationService.prepare).toHaveBeenCalledWith(actorId, actorEmail, programId, scopeIds[0]);
    expect(draftPreparationService.prepare).toHaveBeenCalledWith(actorId, actorEmail, programId, scopeIds[1]);
  });

  it('lists all memberships for program owners', async () => {
    const memberships = [
      { _id: { toString: () => 'membership-1' }, programId: { toString: () => programId }, userId, role: 'scope_viewer', status: 'active', permissions: [], createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') },
    ];
    const { service, membershipModel } = buildService(undefined, memberships);

    const result = await service.list(actorId, programId);

    expect(membershipModel.find).toHaveBeenCalledWith({ programId: expect.any(Object) });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('membership-1');
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

  it('definitively removes a membership when the program owner removes it', async () => {
    const membership = { _id: { toString: () => membershipId }, save: jest.fn() };
    const { service, membershipModel, auditLogService } = buildService(membership);

    await service.disable(actorId, actorEmail, programId, membershipId);

    expect(membershipModel.deleteOne).toHaveBeenCalledWith({ _id: membership._id });
    expect(membership.save).not.toHaveBeenCalled();
    expect(auditLogService.logSuccess).toHaveBeenCalledWith(expect.objectContaining({ action: 'governance.membership.deleted' }));
  });

  it('disables a membership when a delegated administrator removes it', async () => {
    const scopeId = '507f1f77bcf86cd799439015';
    const membership = { _id: { toString: () => membershipId }, scopeId: { toString: () => scopeId }, status: 'active', save: jest.fn().mockResolvedValue(undefined) };
    const { service, membershipModel, auditLogService } = buildService(membership, [{ userId: actorId, scopeId: { toString: () => scopeId }, status: 'active' }], false);

    await service.disable(actorId, actorEmail, programId, membershipId);

    expect(membershipModel.deleteOne).not.toHaveBeenCalled();
    expect(membership.status).toBe('disabled');
    expect(membership.save).toHaveBeenCalled();
    expect(auditLogService.logSuccess).toHaveBeenCalledWith(expect.objectContaining({ action: 'governance.membership.disabled' }));
  });
});
