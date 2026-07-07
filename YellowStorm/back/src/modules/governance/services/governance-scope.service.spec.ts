import { ForbiddenException, NotFoundException } from '@modules/exceptions';
import { GovernanceScopeService } from './governance-scope.service';

const actorId = '507f1f77bcf86cd799439011';
const actorEmail = 'owner@example.com';
const programId = '507f1f77bcf86cd799439012';
const scopeId = '507f1f77bcf86cd799439013';

function queryResult<T>(value: T) {
  return { select: jest.fn().mockReturnThis(), lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(value) };
}

describe('GovernanceScopeService delete authorization', () => {
  function buildService(options: { isOwner?: boolean; accessibleScopeIds?: string[]; deleteMembership?: unknown; groupIds?: string[] } = {}) {
    const scope = { _id: { toString: () => scopeId }, programId: { toString: () => programId }, name: 'Scope', metadata: { classification: { stage: 'pilot' } }, save: jest.fn().mockResolvedValue(undefined) };
    const scopeModel = {
      findOne: jest.fn().mockReturnValue(queryResult(scope)),
      countDocuments: jest.fn().mockResolvedValue(0),
      deleteOne: jest.fn().mockResolvedValue({}),
    };
    const sourceModel = { countDocuments: jest.fn().mockResolvedValue(0) };
    const membershipModel = {
      find: jest.fn().mockReturnValue(queryResult((options.accessibleScopeIds ?? [scopeId]).map((id) => ({ scopeId: { toString: () => id } })))),
      findOne: jest.fn().mockReturnValue(queryResult(options.deleteMembership ?? null)),
    };
    const programService = {
      assertOwnedProgram: jest.fn().mockResolvedValue(undefined),
      assertProgramOwner: jest.fn().mockImplementation(async () => {
        if (!options.isOwner) throw new Error('not owner');
      }),
    };
    const deploymentModel = { updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) }) };
    const userGroupService = { findGroupIdsForMember: jest.fn().mockResolvedValue(options.groupIds ?? []) };
    const auditLogService = { logSuccess: jest.fn() };
    const service = new GovernanceScopeService(scopeModel as never, sourceModel as never, membershipModel as never, deploymentModel as never, programService as never, userGroupService as never, auditLogService as never);
    return { service, scope, scopeModel, deploymentModel, userGroupService, auditLogService };
  }

  it('allows the program owner to delete a scope', async () => {
    const { service, scopeModel } = buildService({ isOwner: true });

    await service.delete(actorId, programId, scopeId);

    expect(scopeModel.deleteOne).toHaveBeenCalled();
  });

  it('allows a program admin to delete any accessible scope', async () => {
    const { service, scopeModel } = buildService({ accessibleScopeIds: ['*'], deleteMembership: { _id: 'membership-1' } });

    await service.delete(actorId, programId, scopeId);

    expect(scopeModel.deleteOne).toHaveBeenCalled();
  });

  it('allows a scope admin to delete their scope', async () => {
    const { service, scopeModel } = buildService({ deleteMembership: { _id: 'membership-1' } });

    await service.delete(actorId, programId, scopeId);

    expect(scopeModel.deleteOne).toHaveBeenCalled();
  });

  it('rejects lower scope roles even when they can access the scope', async () => {
    const { service, scopeModel } = buildService();

    await expect(service.delete(actorId, programId, scopeId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(scopeModel.deleteOne).not.toHaveBeenCalled();
  });

  it('suspends a published deployment when a scope is made inactive', async () => {
    const { service, deploymentModel, auditLogService } = buildService({ isOwner: true });

    await service.update(actorId, actorEmail, programId, scopeId, { status: 'inactive' });

    expect(deploymentModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'published' }),
      { $set: { status: 'suspended' } },
    );
    expect(auditLogService.logSuccess).toHaveBeenCalledWith(expect.objectContaining({ action: 'governance.deployment.suspended' }));
  });

  it('deep-merges metadata updates without removing sibling metadata', async () => {
    const { service, scope } = buildService({ isOwner: true });

    await service.update(actorId, actorEmail, programId, scopeId, { metadata: { review: { status: 'in_review' } } });

    expect(scope.metadata).toEqual({ classification: { stage: 'pilot' }, review: { status: 'in_review' } });
  });

  it('rejects direct approved review metadata writes', async () => {
    const { service } = buildService({ isOwner: true });

    await expect(service.update(actorId, actorEmail, programId, scopeId, { metadata: { review: { status: 'approved' } } })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects updating a sibling scope without scope access', async () => {
    const { service, scopeModel } = buildService({ accessibleScopeIds: ['507f1f77bcf86cd799439099'] });

    await expect(service.update(actorId, actorEmail, programId, scopeId, { metadata: { review: { status: 'in_review' } } })).rejects.toBeInstanceOf(NotFoundException);
    expect(scopeModel.findOne).toHaveBeenCalledTimes(0);
  });

  it('rejects management fields for review-only scope users', async () => {
    const { service, deploymentModel } = buildService();

    await expect(service.update(actorId, actorEmail, programId, scopeId, { status: 'inactive' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(deploymentModel.updateOne).not.toHaveBeenCalled();
  });

  it('allows review metadata updates for group-based scope users', async () => {
    const { service, scope, userGroupService } = buildService({ groupIds: ['507f1f77bcf86cd799439098'] });

    await service.update(actorId, actorEmail, programId, scopeId, { metadata: { review: { status: 'in_review' } } });

    expect(userGroupService.findGroupIdsForMember).toHaveBeenCalledWith(actorId);
    expect(scope.metadata).toEqual({ classification: { stage: 'pilot' }, review: { status: 'in_review' } });
  });

  it('allows review-only users to update review metadata when classification exists', async () => {
    const { service, scope } = buildService();

    await service.update(actorId, actorEmail, programId, scopeId, { metadata: { review: { checklist: [{ key: 'dry_run_accepted', checked: true }] } } });

    expect(scope.metadata).toEqual({ classification: { stage: 'pilot' }, review: { checklist: [{ key: 'dry_run_accepted', checked: true }] } });
  });
});
