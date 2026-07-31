import { ForbiddenException, NotFoundException, ValidationException } from '@modules/exceptions';
import { GovernanceScopeService } from './governance-scope.service';

const actorId = '507f1f77bcf86cd799439011';
const actorEmail = 'owner@example.com';
const programId = '507f1f77bcf86cd799439012';
const scopeId = '507f1f77bcf86cd799439013';

function queryResult<T>(value: T) {
  return { select: jest.fn().mockReturnThis(), lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(value) };
}

describe('GovernanceScopeService delete authorization', () => {
  function buildService(options: { isOwner?: boolean; accessibleScopeIds?: string[]; deleteMembership?: unknown; groupIds?: string[]; children?: unknown[]; deployments?: unknown[] } = {}) {
    const scope = { _id: { toString: () => scopeId }, programId: { toString: () => programId }, name: 'Scope', metadata: { classification: { stage: 'pilot' } }, save: jest.fn().mockResolvedValue(undefined) };
    const scopeModel = {
      create: jest.fn().mockResolvedValue(scope),
      findOne: jest.fn().mockReturnValue(queryResult(scope)),
      countDocuments: jest.fn().mockResolvedValue(0),
      deleteOne: jest.fn().mockResolvedValue({}),
      find: jest.fn().mockReturnValue(queryResult(options.children ?? [])),
    };
    const sourceModel = { countDocuments: jest.fn().mockResolvedValue(0), deleteMany: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({}) };
    const membershipModel = {
      find: jest.fn().mockReturnValue(queryResult((options.accessibleScopeIds ?? [scopeId]).map((id) => ({ scopeId: { toString: () => id } })))),
      findOne: jest.fn().mockReturnValue(queryResult(options.deleteMembership ?? null)),
      deleteMany: jest.fn().mockResolvedValue({}),
    };
    const programService = {
      assertOwnedProgram: jest.fn().mockResolvedValue(undefined),
      assertProgramOwner: jest.fn().mockImplementation(async () => {
        if (!options.isOwner) throw new Error('not owner');
      }),
    };
    const deploymentModel = { updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) }), find: jest.fn().mockReturnValue(queryResult(options.deployments ?? [])), deleteMany: jest.fn().mockResolvedValue({}) };
    const revisionModel = { deleteMany: jest.fn().mockResolvedValue({}) };
    const dryRunModel = { deleteMany: jest.fn().mockResolvedValue({}) };
    const metricModel = { deleteMany: jest.fn().mockResolvedValue({}) };
    const publicationAttemptModel = { deleteMany: jest.fn().mockResolvedValue({}) };
    const userGroupService = { findGroupIdsForMember: jest.fn().mockResolvedValue(options.groupIds ?? []) };
    const auditLogService = { logSuccess: jest.fn() };
    const draftPreparation = { prepare: jest.fn().mockResolvedValue(undefined) };
    const service = new GovernanceScopeService(scopeModel as never, sourceModel as never, membershipModel as never, deploymentModel as never, revisionModel as never, dryRunModel as never, metricModel as never, publicationAttemptModel as never, programService as never, userGroupService as never, auditLogService as never, draftPreparation as never);
    return { service, scope, scopeModel, sourceModel, membershipModel, deploymentModel, revisionModel, dryRunModel, metricModel, publicationAttemptModel, userGroupService, auditLogService, draftPreparation };
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

  it('removes scope-owned governance records when deleting a scope', async () => {
    const deploymentId = { toString: () => '507f1f77bcf86cd799439099' };
    const { service, sourceModel, membershipModel, deploymentModel, revisionModel, dryRunModel, metricModel, publicationAttemptModel } = buildService({ isOwner: true, deployments: [{ _id: deploymentId }] });

    await service.delete(actorId, programId, scopeId);

    expect(sourceModel.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'scope_specific' }));
    expect(sourceModel.updateMany).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'multi_scope' }), expect.objectContaining({ $pull: expect.any(Object) }));
    expect(membershipModel.deleteMany).toHaveBeenCalled();
    expect(metricModel.deleteMany).toHaveBeenCalled();
    expect(dryRunModel.deleteMany).toHaveBeenCalled();
    expect(publicationAttemptModel.deleteMany).toHaveBeenCalled();
    expect(revisionModel.deleteMany).toHaveBeenCalledWith({ deploymentId: { $in: [deploymentId] } });
    expect(deploymentModel.deleteMany).toHaveBeenCalledWith({ _id: { $in: [deploymentId] } });
  });

  it('recursively deletes child scopes', async () => {
    const childId = { toString: () => '507f1f77bcf86cd799439088' };
    const { service, scopeModel } = buildService({ isOwner: true, children: [{ _id: childId }] });
    scopeModel.find.mockReturnValueOnce(queryResult([{ _id: childId }])).mockReturnValueOnce(queryResult([]));

    await service.delete(actorId, programId, scopeId);

    expect(scopeModel.deleteOne).toHaveBeenCalledTimes(2);
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

    await service.update(actorId, actorEmail, programId, scopeId, { metadata: { description: 'Credit risk guidance', review: { status: 'in_review' } } });

    expect(scope.metadata).toEqual({ description: 'Credit risk guidance', classification: { stage: 'pilot' }, review: { status: 'in_review' } });
  });

  it('rejects invalid scope descriptions', async () => {
    const { service } = buildService({ isOwner: true });

    await expect(service.update(actorId, actorEmail, programId, scopeId, { metadata: { description: 'x'.repeat(2001) } })).rejects.toBeInstanceOf(ValidationException);
  });

  it('validates and normalizes scope descriptions on creation', async () => {
    const { service, scopeModel } = buildService({ isOwner: true });
    scopeModel.findOne.mockReturnValueOnce(queryResult(null)).mockReturnValueOnce(queryResult(null));

    await service.create(actorId, programId, { name: 'Scope', metadata: { description: '  Credit risk guidance  ' } });
    expect(scopeModel.create).toHaveBeenCalledWith(expect.objectContaining({ metadata: { description: 'Credit risk guidance' } }));

    await expect(service.create(actorId, programId, { name: 'Other scope', metadata: { description: 42 } })).rejects.toBeInstanceOf(ValidationException);
  });

  it('does not prepare a draft when only the guardrail review timestamp changes', async () => {
    const { service, draftPreparation } = buildService({ isOwner: true });

    await service.update(actorId, actorEmail, programId, scopeId, { metadata: { guardrailsReviewedAt: '2026-07-17T12:00:00.000Z' } });

    expect(draftPreparation.prepare).not.toHaveBeenCalled();
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
