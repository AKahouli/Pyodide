import { ForbiddenException, NotFoundException, ValidationException } from '@modules/exceptions';
import { GovernanceScopeService } from './governance-scope.service';

const actorId = '507f1f77bcf86cd799439011';
const actorEmail = 'owner@example.com';
const programId = '507f1f77bcf86cd799439012';
const scopeId = '507f1f77bcf86cd799439013';

describe('GovernanceScopeService delete authorization', () => {
  function scopeRecord(overrides: Record<string, unknown> = {}) {
    return { id: scopeId, programId, name: 'Scope', metadata: { classification: { stage: 'pilot' } }, agentIds: [], audience: { mode: 'restricted', userIds: [], groupIds: [] }, createdAt: new Date(), updatedAt: new Date(), ...overrides };
  }

  function buildService(options: { isOwner?: boolean; accessibleScopeIds?: string[]; memberships?: Record<string, unknown>[]; groupIds?: string[]; hierarchy?: { id: string; parentScopeId: string | null }[]; deployments?: Record<string, unknown>[] } = {}) {
    const scope = scopeRecord();
    const scopeStore = {
      insert: jest.fn().mockResolvedValue(scope),
      findById: jest.fn().mockResolvedValue(scope),
      findByProgramAndId: jest.fn().mockResolvedValue(scope),
      listByProgram: jest.fn().mockResolvedValue([]),
      listHierarchy: jest.fn().mockResolvedValue(options.hierarchy ?? [{ id: scopeId, parentScopeId: null }]),
      update: jest.fn().mockImplementation(async (_id: string, patch: Record<string, unknown>) => scopeRecord({ ...scope, ...patch })),
      setMetadataReviewStatus: jest.fn(),
      countByProgram: jest.fn().mockResolvedValue(0),
      deleteByIdsAndProgram: jest.fn().mockResolvedValue(undefined),
    };
    const documentStore = { clearOwnerScopes: jest.fn().mockResolvedValue(undefined), listForProgramWorkspaces: jest.fn().mockResolvedValue([]) };
    const bindingStore = { removeScopesFromProgramBindings: jest.fn().mockResolvedValue(undefined), listEnabled: jest.fn().mockResolvedValue([]) };
    const membershipStore = {
      findActiveForUser: jest.fn().mockImplementation(async (_programId: string, _userId: string, _groupIds: string[]) => {
        if (options.memberships) return options.memberships;
        const accessible = options.accessibleScopeIds ?? [scopeId];
        return accessible.includes('*') ? [{ scopeId: null, role: 'program_admin' }] : accessible.map((id) => ({ scopeId: id, role: 'scope_editor' }));
      }),
      findActiveByUser: jest.fn().mockResolvedValue([]),
      deleteByProgramAndScopeIds: jest.fn().mockResolvedValue(undefined),
    };
    const programService = {
      assertOwnedProgram: jest.fn().mockResolvedValue(undefined),
      assertProgramOwner: jest.fn().mockImplementation(async () => {
        if (!options.isOwner) throw new Error('not owner');
      }),
    };
    const deploymentStore = {
      listByProgram: jest.fn().mockResolvedValue(options.deployments ?? []),
      suspendPublished: jest.fn().mockResolvedValue(true),
      deleteByProgramAndScopeIds: jest.fn().mockResolvedValue(undefined),
    };
    const revisionStore = { deleteByDeploymentIds: jest.fn().mockResolvedValue(undefined) };
    const dryRunStore = { deleteByProgramAndScopeIds: jest.fn().mockResolvedValue(undefined) };
    const metricStore = { deleteByProgramAndScopeIds: jest.fn().mockResolvedValue(undefined) };
    const publicationAttemptStore = { deleteByProgramAndScopeIds: jest.fn().mockResolvedValue(undefined) };
    const userGroupService = { findGroupIdsForMember: jest.fn().mockResolvedValue(options.groupIds ?? []) };
    const auditLogService = { logSuccess: jest.fn() };
    const draftPreparation = { prepare: jest.fn().mockResolvedValue(undefined) };
    const tx = { run: jest.fn((fn: () => Promise<unknown>) => fn()) };
    const service = new GovernanceScopeService(scopeStore as never, documentStore as never, bindingStore as never, membershipStore as never, deploymentStore as never, revisionStore as never, dryRunStore as never, metricStore as never, publicationAttemptStore as never, programService as never, userGroupService as never, auditLogService as never, draftPreparation as never, tx as never);
    return { service, scopeStore, documentStore, bindingStore, membershipStore, deploymentStore, revisionStore, dryRunStore, metricStore, publicationAttemptStore, userGroupService, auditLogService, draftPreparation, tx };
  }

  it('allows the program owner to delete a scope', async () => {
    const { service, scopeStore } = buildService({ isOwner: true });

    await service.delete(actorId, programId, scopeId);

    expect(scopeStore.deleteByIdsAndProgram).toHaveBeenCalledWith([scopeId], programId);
  });

  it('allows a program admin to delete any accessible scope', async () => {
    const { service, scopeStore } = buildService({ accessibleScopeIds: ['*'] });

    await service.delete(actorId, programId, scopeId);

    expect(scopeStore.deleteByIdsAndProgram).toHaveBeenCalled();
  });

  it('allows a scope admin to delete their scope', async () => {
    const { service, scopeStore } = buildService({ memberships: [{ scopeId, role: 'scope_admin', status: 'active' }] });

    await service.delete(actorId, programId, scopeId);

    expect(scopeStore.deleteByIdsAndProgram).toHaveBeenCalled();
  });

  it('rejects lower scope roles even when they can access the scope', async () => {
    const { service, scopeStore } = buildService();

    await expect(service.delete(actorId, programId, scopeId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(scopeStore.deleteByIdsAndProgram).not.toHaveBeenCalled();
  });

  it('removes scope-owned governance records when deleting a scope', async () => {
    const deploymentId = '507f1f77bcf86cd799439099';
    const { service, documentStore, bindingStore, membershipStore, deploymentStore, revisionStore, dryRunStore, metricStore, publicationAttemptStore } = buildService({ isOwner: true, deployments: [{ id: deploymentId, scopeId }] });

    await service.delete(actorId, programId, scopeId);

    expect(bindingStore.removeScopesFromProgramBindings).toHaveBeenCalledWith(programId, [scopeId]);
    expect(documentStore.clearOwnerScopes).toHaveBeenCalledWith(programId, [scopeId]);
    expect(membershipStore.deleteByProgramAndScopeIds).toHaveBeenCalledWith(programId, [scopeId]);
    expect(metricStore.deleteByProgramAndScopeIds).toHaveBeenCalledWith(programId, [scopeId]);
    expect(dryRunStore.deleteByProgramAndScopeIds).toHaveBeenCalledWith(programId, [scopeId]);
    expect(publicationAttemptStore.deleteByProgramAndScopeIds).toHaveBeenCalledWith(programId, [scopeId]);
    expect(revisionStore.deleteByDeploymentIds).toHaveBeenCalledWith([deploymentId]);
    expect(deploymentStore.deleteByProgramAndScopeIds).toHaveBeenCalledWith(programId, [scopeId]);
  });

  it('deletes the whole subtree set-based in one transaction, loading deployments once', async () => {
    const childId = '507f1f77bcf86cd799439088';
    const grandChildId = '507f1f77bcf86cd799439077';
    const unrelatedId = '507f1f77bcf86cd799439066';
    const hierarchy = [
      { id: scopeId, parentScopeId: null },
      { id: childId, parentScopeId: scopeId },
      { id: grandChildId, parentScopeId: childId },
      { id: unrelatedId, parentScopeId: null },
    ];
    const deployments = [{ id: 'd-child', scopeId: childId }, { id: 'd-other', scopeId: unrelatedId }];
    const { service, scopeStore, deploymentStore, revisionStore, membershipStore, tx } = buildService({ isOwner: true, hierarchy, deployments });

    await service.delete(actorId, programId, scopeId);

    expect(tx.run).toHaveBeenCalledTimes(1);
    expect(deploymentStore.listByProgram).toHaveBeenCalledTimes(1);
    expect(revisionStore.deleteByDeploymentIds).toHaveBeenCalledWith(['d-child']);
    expect(membershipStore.deleteByProgramAndScopeIds).toHaveBeenCalledWith(programId, [scopeId, childId, grandChildId]);
    expect(scopeStore.deleteByIdsAndProgram).toHaveBeenCalledTimes(1);
    expect(scopeStore.deleteByIdsAndProgram).toHaveBeenCalledWith([scopeId, childId, grandChildId], programId);
  });

  it('terminates on a corrupted parent cycle', async () => {
    const childId = '507f1f77bcf86cd799439088';
    const hierarchy = [{ id: scopeId, parentScopeId: childId }, { id: childId, parentScopeId: scopeId }];
    const { service, scopeStore } = buildService({ isOwner: true, hierarchy });

    await service.delete(actorId, programId, scopeId);

    expect(scopeStore.deleteByIdsAndProgram).toHaveBeenCalledWith([scopeId, childId], programId);
  });

  it('suspends a published deployment when a scope is made inactive', async () => {
    const { service, deploymentStore, auditLogService } = buildService({ isOwner: true });

    await service.update(actorId, actorEmail, programId, scopeId, { status: 'inactive' });

    expect(deploymentStore.suspendPublished).toHaveBeenCalledWith(programId, scopeId);
    expect(auditLogService.logSuccess).toHaveBeenCalledWith(expect.objectContaining({ action: 'governance.deployment.suspended' }));
  });

  it('deep-merges metadata updates without removing sibling metadata', async () => {
    const { service, scopeStore } = buildService({ isOwner: true });

    await service.update(actorId, actorEmail, programId, scopeId, { metadata: { description: 'Credit risk guidance', review: { status: 'in_review' } } });

    expect(scopeStore.update).toHaveBeenCalledWith(scopeId, expect.objectContaining({
      metadata: { description: 'Credit risk guidance', classification: { stage: 'pilot' }, review: { status: 'in_review' } },
    }));
  });

  it('rejects invalid scope descriptions', async () => {
    const { service } = buildService({ isOwner: true });

    await expect(service.update(actorId, actorEmail, programId, scopeId, { metadata: { description: 'x'.repeat(2001) } })).rejects.toBeInstanceOf(ValidationException);
  });

  it('validates and normalizes scope descriptions on creation', async () => {
    const { service, scopeStore } = buildService({ isOwner: true });

    await service.create(actorId, programId, { name: 'Scope', metadata: { description: '  Credit risk guidance  ' } });
    expect(scopeStore.insert).toHaveBeenCalledWith(expect.objectContaining({ metadata: { description: 'Credit risk guidance' } }));

    await expect(service.create(actorId, programId, { name: 'Other scope', metadata: { description: 42 } })).rejects.toBeInstanceOf(ValidationException);
  });

  it('normalizes knowledge settings on creation', async () => {
    const { service, scopeStore } = buildService({ isOwner: true });

    await service.create(actorId, programId, {
      name: 'Scope',
      knowledge: { sourceMode: 'workspaces_only', webSourcesEnabled: true, webAllowedDomains: [' https://Docs.Example.com/guide ', 'repo.example.org'], webBlockedDomains: ['tracker.example.net'] },
    });

    expect(scopeStore.insert).toHaveBeenCalledWith(expect.objectContaining({
      knowledge: {
        sourceMode: 'workspaces_only',
        webSourcesEnabled: true,
        webAllowedDomains: ['docs.example.com', 'repo.example.org'],
        webBlockedDomains: ['tracker.example.net'],
      },
    }));
  });

  it('clears web domain lists when web sources are disabled', async () => {
    const { service, scopeStore } = buildService({ isOwner: true });

    await service.create(actorId, programId, {
      name: 'Scope',
      knowledge: { sourceMode: 'llm_only', webSourcesEnabled: false, webAllowedDomains: ['docs.example.com'] },
    });

    expect(scopeStore.insert).toHaveBeenCalledWith(expect.objectContaining({
      knowledge: { sourceMode: 'llm_only', webSourcesEnabled: false, webAllowedDomains: [], webBlockedDomains: [] },
    }));
  });

  it('rejects invalid web source domains', async () => {
    const { service } = buildService({ isOwner: true });

    await expect(service.update(actorId, actorEmail, programId, scopeId, {
      knowledge: { sourceMode: 'llm_only', webSourcesEnabled: true, webBlockedDomains: ['not a domain'] },
    })).rejects.toBeInstanceOf(ValidationException);
  });

  it('persists knowledge updates on the scope', async () => {
    const { service, scopeStore } = buildService({ isOwner: true });

    await service.update(actorId, actorEmail, programId, scopeId, {
      knowledge: { sourceMode: 'workspaces_only', webSourcesEnabled: true },
    });

    expect(scopeStore.update).toHaveBeenCalledWith(scopeId, expect.objectContaining({
      knowledge: { sourceMode: 'workspaces_only', webSourcesEnabled: true, webAllowedDomains: [], webBlockedDomains: [] },
    }));
  });

  it('requires scope management permission for knowledge updates', async () => {
    const { service, scopeStore } = buildService();

    await expect(service.update(actorId, actorEmail, programId, scopeId, { knowledge: { sourceMode: 'workspaces_only' } })).rejects.toBeInstanceOf(ForbiddenException);
    expect(scopeStore.update).not.toHaveBeenCalled();
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
    const { service, scopeStore } = buildService({ accessibleScopeIds: ['507f1f77bcf86cd799439099'] });

    await expect(service.update(actorId, actorEmail, programId, scopeId, { metadata: { review: { status: 'in_review' } } })).rejects.toBeInstanceOf(NotFoundException);
    expect(scopeStore.update).not.toHaveBeenCalled();
  });

  it('rejects management fields for review-only scope users', async () => {
    const { service, deploymentStore } = buildService();

    await expect(service.update(actorId, actorEmail, programId, scopeId, { status: 'inactive' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(deploymentStore.suspendPublished).not.toHaveBeenCalled();
  });

  it('allows review metadata updates for group-based scope users', async () => {
    const { service, scopeStore, userGroupService } = buildService({ groupIds: ['507f1f77bcf86cd799439098'] });

    await service.update(actorId, actorEmail, programId, scopeId, { metadata: { review: { status: 'in_review' } } });

    expect(userGroupService.findGroupIdsForMember).toHaveBeenCalledWith(actorId);
    expect(scopeStore.update).toHaveBeenCalledWith(scopeId, expect.objectContaining({
      metadata: { classification: { stage: 'pilot' }, review: { status: 'in_review' } },
    }));
  });

  it('allows review-only users to update review metadata when classification exists', async () => {
    const { service, scopeStore } = buildService();

    await service.update(actorId, actorEmail, programId, scopeId, { metadata: { review: { checklist: [{ key: 'dry_run_accepted', checked: true }] } } });

    expect(scopeStore.update).toHaveBeenCalledWith(scopeId, expect.objectContaining({
      metadata: { classification: { stage: 'pilot' }, review: { checklist: [{ key: 'dry_run_accepted', checked: true }] } },
    }));
  });
});
