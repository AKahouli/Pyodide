import { BadRequestException } from '@modules/exceptions';
import { DuplicateKeyError } from '../persistence/governance-records';
import { GovernanceMembershipService } from './governance-membership.service';

describe('GovernanceMembershipService', () => {
  const actorId = '507f1f77bcf86cd799439011';
  const actorEmail = 'owner@example.com';
  const programId = '507f1f77bcf86cd799439012';
  const userId = '507f1f77bcf86cd799439013';
  const groupId = '507f1f77bcf86cd799439014';
  const membershipId = '507f1f77bcf86cd799439016';

  function membershipRecord(overrides: Record<string, unknown> = {}) {
    return { id: 'membership-1', programId, invitedBy: actorId, createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'), ...overrides };
  }

  function buildService(options: { duplicate?: Record<string, unknown> | null; memberships?: Record<string, unknown>[]; isProgramOwner?: boolean; insertError?: unknown } = {}) {
    let stored: Record<string, unknown> | null = null;
    const membershipStore = {
      findDuplicate: jest.fn().mockResolvedValue(options.duplicate ?? null),
      insert: jest.fn(options.insertError ? (() => Promise.reject(options.insertError)) : async (payload: Record<string, unknown>) => {
        stored = membershipRecord({ ...payload });
        return stored;
      }),
      findById: jest.fn(async () => stored ?? options.duplicate ?? membershipRecord({})),
      findByIdAndProgram: jest.fn(async () => options.duplicate ?? stored ?? membershipRecord({ id: membershipId })),
      findActiveForUser: jest.fn().mockResolvedValue(options.memberships ?? []),
      findActiveByUser: jest.fn().mockResolvedValue([]),
      listByProgram: jest.fn().mockResolvedValue(options.memberships ?? []),
      update: jest.fn(async (_id: string, patch: Record<string, unknown>) => membershipRecord({ id: 'existing', userId, ...patch })),
      deleteById: jest.fn().mockResolvedValue(undefined),
    };
    const userLookup = { byId: jest.fn(), byIds: jest.fn().mockResolvedValue(new Map()) };
    const groupLookup = { summariesByIds: jest.fn().mockResolvedValue(new Map()) };
    const programService = { assertOwnedProgram: jest.fn().mockResolvedValue(undefined), assertProgramOwner: jest.fn().mockImplementation(async () => { if (options.isProgramOwner === false) throw new Error('not owner'); }) };
    const scopeService = { findById: jest.fn().mockResolvedValue({}) };
    const userGroupService = { findById: jest.fn().mockResolvedValue({ id: groupId }), findGroupIdsForMember: jest.fn().mockResolvedValue([groupId]) };
    const auditLogService = { logSuccess: jest.fn() };
    const service = new GovernanceMembershipService(membershipStore as never, userLookup as never, groupLookup as never, programService as never, scopeService as never, userGroupService as never, auditLogService as never);
    return { service, membershipStore, userGroupService, auditLogService };
  }

  it('creates active memberships with role permissions', async () => {
    const { service } = buildService();

    const membership = await service.create(actorId, actorEmail, programId, { userId, role: 'scope_viewer' });

    expect(membership.userId).toBe(userId);
    expect(membership.status).toBe('active');
    expect(membership.permissions).toContain('governance.read');
  });

  it('reactivates duplicate memberships for the same program scope and user', async () => {
    const { service, membershipStore } = buildService({ duplicate: membershipRecord({ id: 'existing', userId, role: 'scope_viewer', status: 'disabled', permissions: [] }) });

    const membership = await service.create(actorId, actorEmail, programId, { userId, role: 'scope_approver' });

    expect(membership.id).toBe('existing');
    expect(membership.role).toBe('scope_approver');
    expect(membership.status).toBe('active');
    expect(membership.permissions).toContain('governance.publish');
    expect(membershipStore.insert).not.toHaveBeenCalled();
  });

  it('reuses memberships when a duplicate key is created concurrently', async () => {
    const { service, membershipStore, auditLogService } = buildService({ insertError: new DuplicateKeyError(), duplicate: membershipRecord({ id: 'existing', userId, role: 'scope_viewer', status: 'disabled', permissions: [] }) });

    const membership = await service.create(actorId, actorEmail, programId, { userId, role: 'scope_approver' });

    expect(membership.id).toBe('existing');
    expect(membership.role).toBe('scope_approver');
    expect(membership.status).toBe('active');
    expect(membership.invitedBy).toBe(actorId);
    expect(auditLogService.logSuccess).toHaveBeenCalledWith(expect.objectContaining({ action: 'governance.membership.updated', metadata: expect.objectContaining({ reason: 'reactivated_existing' }) }));
    expect(auditLogService.logSuccess).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'governance.membership.invited' }));
    // The pre-check short-circuits; insert only runs when no duplicate existed.
  });

  it('creates group memberships after validating group ownership', async () => {
    const { service, userGroupService } = buildService();

    const membership = await service.create(actorId, actorEmail, programId, { groupId, role: 'scope_viewer' });

    expect(userGroupService.findById).toHaveBeenCalledWith(actorId, groupId);
    expect(membership.groupId).toBe(groupId);
    expect(membership.userId).toBeUndefined();
  });

  it('lists all memberships for program owners', async () => {
    const memberships = [membershipRecord({ id: 'membership-1', userId, role: 'scope_viewer', status: 'active', permissions: [] })];
    const { service, membershipStore } = buildService({ memberships });

    const result = await service.list(actorId, programId);

    expect(membershipStore.listByProgram).toHaveBeenCalledWith(programId);
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
    const { service } = buildService({ memberships: [{ groupId, scopeId, status: 'active' }] });

    const scopes = await service.getAccessibleScopeIds(userId, programId);

    expect(scopes).toEqual([scopeId]);
  });

  it('definitively removes a membership when the program owner removes it', async () => {
    const membership = membershipRecord({ id: membershipId });
    const { service, membershipStore, auditLogService } = buildService({ duplicate: membership });

    await service.disable(actorId, actorEmail, programId, membershipId);

    expect(membershipStore.deleteById).toHaveBeenCalledWith(membershipId);
    expect(auditLogService.logSuccess).toHaveBeenCalledWith(expect.objectContaining({ action: 'governance.membership.deleted' }));
  });

  it('disables a membership when a delegated administrator removes it', async () => {
    const scopeId = '507f1f77bcf86cd799439015';
    const membership = membershipRecord({ id: membershipId, scopeId, status: 'active' });
    const { service, membershipStore, auditLogService } = buildService({ duplicate: membership, memberships: [{ userId: actorId, scopeId, status: 'active' }], isProgramOwner: false });

    await service.disable(actorId, actorEmail, programId, membershipId);

    expect(membershipStore.deleteById).not.toHaveBeenCalled();
    expect(membershipStore.update).toHaveBeenCalledWith(membershipId, { status: 'disabled' });
    expect(auditLogService.logSuccess).toHaveBeenCalledWith(expect.objectContaining({ action: 'governance.membership.disabled' }));
  });

  it('resolves user and group summaries through the lookup ports instead of populates', async () => {
    const userLookup = { byId: jest.fn(), byIds: jest.fn().mockResolvedValue(new Map([[userId, { id: userId, email: 'user@example.test', firstName: 'U', lastName: 'S' }]])) };
    const groupLookup = { summariesByIds: jest.fn().mockResolvedValue(new Map([[groupId, { id: groupId, name: 'Planners', memberCount: 3 }]])) };
    const membershipStore = {
      findDuplicate: jest.fn().mockResolvedValue(null),
      insert: jest.fn(),
      findById: jest.fn(),
      findActiveForUser: jest.fn().mockResolvedValue([]),
      findActiveByUser: jest.fn().mockResolvedValue([]),
      listByProgram: jest.fn().mockResolvedValue([membershipRecord({ id: 'membership-1', userId, groupId, role: 'scope_viewer', status: 'active', permissions: [] })]),
      update: jest.fn(),
      deleteById: jest.fn(),
    };
    const service = new GovernanceMembershipService(membershipStore as never, userLookup as never, groupLookup as never, { assertOwnedProgram: jest.fn(), assertProgramOwner: jest.fn().mockResolvedValue(undefined) } as never, {} as never, { findById: jest.fn(), findGroupIdsForMember: jest.fn().mockResolvedValue([]) } as never, { logSuccess: jest.fn() } as never);

    const result = await service.list(actorId, programId);
    expect(userLookup.byIds).toHaveBeenCalledWith([userId]);
    expect(groupLookup.summariesByIds).toHaveBeenCalledWith([groupId]);
    expect(result[0].user).toEqual({ id: userId, email: 'user@example.test', firstName: 'U', lastName: 'S' });
    expect(result[0].group).toEqual({ id: groupId, name: 'Planners', memberCount: 3 });
  });
});
