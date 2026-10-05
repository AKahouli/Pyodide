import { GovernanceDeploymentService } from './governance-deployment.service';

describe('GovernanceDeploymentService', () => {
  const actorId = '507f1f77bcf86cd799439011';
  const actorEmail = 'owner@example.com';
  const deploymentId = '507f1f77bcf86cd799439012';
  const programId = '507f1f77bcf86cd799439013';
  const scopeId = '507f1f77bcf86cd799439015';
  const revisionId = '507f1f77bcf86cd799439014';
  const agentId = '507f1f77bcf86cd799439016';

  function buildService(deployment: Record<string, unknown>, revision: Record<string, unknown> | null, passedDryRun: Record<string, unknown> | null = { id: '507f1f77bcf86cd799439017' }, scopeRoleError?: Error) {
    const deploymentStore = {
      findById: jest.fn().mockResolvedValue(deployment),
      findByProgramAndScope: jest.fn().mockResolvedValue(null),
      listByProgramScopes: jest.fn().mockResolvedValue([deployment]),
      update: jest.fn().mockResolvedValue(deployment),
      publishGuarded: jest.fn().mockImplementation(async (_id: string, draftRevisionId: string, targetRevisionId: string) => {
        if (!revision || deployment.currentDraftRevisionId !== revision.id) return null;
        deployment.currentPublishedRevisionId = targetRevisionId;
        deployment.status = 'published';
        return deployment;
      }),
    };
    const revisionStore = {
      findByDeploymentAndId: jest.fn().mockResolvedValue(revision),
      findById: jest.fn().mockResolvedValue(revision),
      update: jest.fn().mockImplementation(async (_id: string, patch: Record<string, unknown>) => Object.assign(revision ?? {}, patch)),
    };
    const dryRunStore = { findPassedByDeploymentAndRevision: jest.fn().mockResolvedValue(passedDryRun) };
    const bindingStore = { filterWorkspaceIdsBoundToScope: jest.fn().mockResolvedValue([]) };
    const attemptStore = { insert: jest.fn().mockResolvedValue({}) };
    const programService = { assertOwnedProgram: jest.fn().mockResolvedValue(undefined) };
    const scopeService = { findById: jest.fn().mockResolvedValue({ status: 'active', agentIds: [agentId] }) };
    const accessService = { assertScopeAccess: jest.fn().mockResolvedValue(undefined), assertScopeRole: scopeRoleError ? jest.fn().mockRejectedValue(scopeRoleError) : jest.fn().mockResolvedValue(undefined), getAccessibleScopeIds: jest.fn().mockResolvedValue(['*']) };
    const auditLogService = { logSuccess: jest.fn(), logFailure: jest.fn() };
    const draftPreparationService = { prepare: jest.fn().mockResolvedValue(undefined) };
    // Simulated transaction: snapshot the in-memory revision and restore it when fn throws (rollback).
    const tx = {
      run: jest.fn(async (fn: () => Promise<unknown>) => {
        const snapshot = revision ? { ...revision } : null;
        try {
          return await fn();
        } catch (error) {
          if (revision && snapshot) {
            for (const key of Object.keys(revision)) delete revision[key];
            Object.assign(revision, snapshot);
          }
          throw error;
        }
      }),
    };
    const rootPublication = { capture: jest.fn().mockResolvedValue(undefined), assertUnchanged: jest.fn().mockResolvedValue(undefined) };
    const service = new GovernanceDeploymentService(deploymentStore as never, revisionStore as never, dryRunStore as never, bindingStore as never, attemptStore as never, programService as never, scopeService as never, accessService as never, auditLogService as never, draftPreparationService as never, tx as never, rootPublication as never);
    return { tx, service, attemptStore, revisionStore, deploymentStore, auditLogService, accessService, scopeService, draftPreparationService, rootPublication };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function deploymentRecord(overrides: Record<string, unknown> = {}): any {
    return { id: deploymentId, programId, scopeId, name: 'Public scope', status: 'dry_run', currentDraftRevisionId: revisionId, channels: {}, createdAt: new Date(), updatedAt: new Date(), ...overrides };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function revisionRecord(overrides: Record<string, unknown> = {}): any {
    return { id: revisionId, deploymentId, revisionNumber: 1, agentId, allowedAgentIds: [agentId], workspaceIds: [], status: 'draft', snapshots: {}, createdBy: actorId, createdAt: new Date(), updatedAt: new Date(), ...overrides };
  }

  it('prepares the authoritative first draft after creating a deployment', async () => {
    const deploymentStore = {
      insert: jest.fn().mockResolvedValue(deploymentRecord({ status: 'draft' })),
      findByProgramAndScope: jest.fn().mockResolvedValue(null),
    };
    const scopeService = { findById: jest.fn().mockResolvedValue({ id: scopeId, agentIds: [agentId] }) };
    const accessService = { assertScopeAccess: jest.fn().mockResolvedValue(undefined) };
    const auditLogService = { logSuccess: jest.fn() };
    const draftPreparationService = { prepare: jest.fn().mockResolvedValue(undefined) };
    const service = new GovernanceDeploymentService(deploymentStore as never, {} as never, {} as never, {} as never, {} as never, {} as never, scopeService as never, accessService as never, auditLogService as never, draftPreparationService as never);

    await service.create(actorId, actorEmail, programId, { scopeId, name: ' Public scope ' });

    expect(draftPreparationService.prepare).toHaveBeenCalledWith(actorId, actorEmail, programId, scopeId);
  });

  it('publishes the selected draft revision as the public revision', async () => {
    const deployment = deploymentRecord();
    const revision = revisionRecord();
    const { service, attemptStore } = buildService(deployment, revision);

    const result = await service.publish(actorId, actorEmail, deploymentId, {});

    expect(revision.status).toBe('published');
    expect(deployment.currentPublishedRevisionId).toBe(revisionId);
    expect(attemptStore.insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'success', revisionId }));
    expect(result.currentPublishedRevisionId).toBe(revisionId);
  });

  it('rejects client Root enrollment on both draft mutation routes', async () => {
    const { service, revisionStore } = buildService(deploymentRecord(), revisionRecord());
    await expect(service.createRevision(actorId, actorEmail, deploymentId, { agentId, agentSnapshot: { rootWork: {} } }))
      .rejects.toMatchObject({ code: 'ERR_3670' });
    await expect(service.updateRevision(actorId, deploymentId, revisionId, { agentSnapshot: { rootWork: {} } }))
      .rejects.toMatchObject({ code: 'ERR_3670' });
    expect(revisionStore.update).not.toHaveBeenCalled();
  });

  it('captures server Root policy atomically and does not bypass its recheck with allowPartial', async () => {
    const revision = revisionRecord({ agentSnapshot: { legacy: true, rootWork: { client: true } } });
    const { service, rootPublication, revisionStore } = buildService(deploymentRecord(), revision);
    const frozen = { version: 1, pool: { rootAgentId: agentId } };
    rootPublication.capture.mockResolvedValue(frozen as never);
    await service.publish(actorId, actorEmail, deploymentId, {});
    expect(revision.agentSnapshot).toEqual({ legacy: true, rootWork: frozen });
    const second = buildService(deploymentRecord(), revisionRecord());
    second.rootPublication.assertUnchanged.mockRejectedValue(new Error('profile drift'));
    await expect(second.service.publish(actorId, actorEmail, deploymentId, { allowPartial: true })).rejects.toThrow('profile drift');
    expect(second.revisionStore.update).not.toHaveBeenCalled();
    expect(revisionStore.update).toHaveBeenCalledTimes(1);
  });

  it('does not move the published pointer when the draft changes after capture', async () => {
    const h = buildService(deploymentRecord(), revisionRecord());
    h.revisionStore.update.mockResolvedValueOnce(null as never);
    await expect(h.service.publish(actorId, actorEmail, deploymentId, {})).rejects.toMatchObject({ code: 'ERR_3670' });
    expect(h.deploymentStore.publishGuarded).not.toHaveBeenCalled();
  });

  it('publishes even when channel configuration is not ready', async () => {
    const deployment = deploymentRecord({ channels: { widget: { enabled: true, status: 'not_configured' } } });
    const revision = revisionRecord();
    const { service, attemptStore, auditLogService } = buildService(deployment, revision);

    await expect(service.publish(actorId, actorEmail, deploymentId, {})).resolves.toMatchObject({ currentPublishedRevisionId: revisionId });
    expect(attemptStore.insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'success', errorCode: undefined }));
    expect(auditLogService.logFailure).not.toHaveBeenCalled();
  });

  it('blocks publishing archived deployments', async () => {
    const deployment = deploymentRecord({ status: 'archived', currentPublishedRevisionId: revisionId });
    const revision = revisionRecord({ status: 'published' });
    const { service } = buildService(deployment, revision);

    await expect(service.publish(actorId, actorEmail, deploymentId, {})).rejects.toMatchObject({ code: 'ERR_3670' });
  });

  it('blocks publishing rejected revisions', async () => {
    const deployment = deploymentRecord();
    const revision = revisionRecord({ status: 'rejected' });
    const { service, attemptStore } = buildService(deployment, revision);

    await expect(service.publish(actorId, actorEmail, deploymentId, {})).rejects.toMatchObject({ code: 'ERR_3651' });
    expect(attemptStore.insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', errorCode: 'ERR_3651' }));
  });

  it('publishes a reviewed suspended deployment when its scope is active', async () => {
    const deployment = deploymentRecord({ status: 'suspended', currentPublishedRevisionId: '507f1f77bcf86cd799439099' });
    const revision = revisionRecord();
    const { service } = buildService(deployment, revision);
    await expect(service.publish(actorId, actorEmail, deploymentId, {})).resolves.toMatchObject({ status: 'published', currentPublishedRevisionId: revisionId });
  });

  it('blocks a suspended deployment while its scope is inactive', async () => {
    const deployment = deploymentRecord({ status: 'suspended', currentPublishedRevisionId: '507f1f77bcf86cd799439099' });
    const revision = revisionRecord();
    const { service, scopeService } = buildService(deployment, revision);
    scopeService.findById.mockResolvedValue({ status: 'inactive', agentIds: [agentId] });
    await expect(service.publish(actorId, actorEmail, deploymentId, {})).rejects.toMatchObject({ code: 'ERR_3670' });
  });

  it('blocks a non-suspended deployment while its scope is inactive', async () => {
    const deployment = deploymentRecord();
    const revision = revisionRecord();
    const { service, scopeService } = buildService(deployment, revision);
    scopeService.findById.mockResolvedValue({ status: 'inactive', agentIds: [agentId] });
    await expect(service.publish(actorId, actorEmail, deploymentId, { allowPartial: true })).rejects.toMatchObject({ code: 'ERR_3670' });
  });

  it('blocks publishing when the draft revision has no passed dry-run', async () => {
    const deployment = deploymentRecord();
    const revision = revisionRecord();
    const { service, attemptStore } = buildService(deployment, revision, null);

    await expect(service.publish(actorId, actorEmail, deploymentId, {})).rejects.toMatchObject({ code: 'ERR_3670' });
    expect(attemptStore.insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'blocked', errorCode: 'ERR_3670' }));
  });

  it('blocks publishing when the actor is not a scope approver', async () => {
    const deployment = deploymentRecord();
    const revision = revisionRecord();
    const { service, accessService, attemptStore } = buildService(deployment, revision, { id: '507f1f77bcf86cd799439017' }, new Error('forbidden'));

    await expect(service.publish(actorId, actorEmail, deploymentId, {})).rejects.toThrow('forbidden');
    expect(accessService.assertScopeRole).toHaveBeenCalledWith(actorId, programId, scopeId, ['scope_approver']);
    expect(revision.status).toBe('draft');
    expect(attemptStore.insert).not.toHaveBeenCalled();
  });

  it('rolls back the failed publish when the guarded deployment swap loses the race', async () => {
    const deployment = deploymentRecord();
    const revision = revisionRecord();
    const service = buildService(deployment, revision);
    service.deploymentStore.publishGuarded.mockResolvedValue(null);
    service.deploymentStore.findById.mockResolvedValue({ ...deployment, currentPublishedRevisionId: '507f1f77bcf86cd799439099' });

    await expect(service.service.publish(actorId, actorEmail, deploymentId, {})).rejects.toMatchObject({ code: 'ERR_3670' });
    expect(service.tx.run).toHaveBeenCalled();
    expect(revision.status).toBe('draft');
    expect(revision.publishedBy).toBeFalsy();
    expect(revision.publishedAt).toBeFalsy();
  });

  it('blocks suspend when no revision is published', async () => {
    const deployment = deploymentRecord({ status: 'dry_run', currentPublishedRevisionId: undefined });
    const { service } = buildService(deployment, null);

    await expect(service.suspend(actorId, actorEmail, deploymentId)).rejects.toMatchObject({ code: 'ERR_3653' });
  });
});
