import { GovernanceDeploymentService } from './governance-deployment.service';

describe('GovernanceDeploymentService', () => {
  const actorId = '507f1f77bcf86cd799439011';
  const actorEmail = 'owner@example.com';
  const deploymentId = '507f1f77bcf86cd799439012';
  const programId = '507f1f77bcf86cd799439013';
  const revisionId = '507f1f77bcf86cd799439014';
  const agentId = '507f1f77bcf86cd799439016';

  function buildService(deployment: Record<string, unknown>, revision: Record<string, unknown> | null, passedDryRun: Record<string, unknown> | null = { _id: '507f1f77bcf86cd799439017' }) {
    const deploymentModel = {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(deployment),
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(deployment) }),
      }),
    };
    const revisionModel = {
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(revision) }),
      findById: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(revision) }) }),
    };
    const dryRunModel = { findOne: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(passedDryRun) }) }) }) };
    const sourceModel = { find: jest.fn() };
    const attemptModel = { create: jest.fn().mockResolvedValue({}) };
    const programService = { assertOwnedProgram: jest.fn().mockResolvedValue(undefined) };
    const scopeService = { findById: jest.fn() };
    const accessService = { assertScopeAccess: jest.fn().mockResolvedValue(undefined), assertScopeRole: jest.fn().mockResolvedValue(undefined), getAccessibleScopeIds: jest.fn().mockResolvedValue(['*']) };
    const auditLogService = { logSuccess: jest.fn(), logFailure: jest.fn() };
    const service = new GovernanceDeploymentService(deploymentModel as never, revisionModel as never, dryRunModel as never, sourceModel as never, attemptModel as never, programService as never, scopeService as never, accessService as never, auditLogService as never);
    return { service, attemptModel, auditLogService };
  }

  it('publishes the selected draft revision as the public revision', async () => {
    const deployment = { _id: deploymentId, programId, scopeId: '507f1f77bcf86cd799439015', status: 'dry_run', currentDraftRevisionId: revisionId, currentPublishedRevisionId: undefined as string | undefined, channels: {}, save: jest.fn() };
    const revision = { _id: revisionId, agentId, status: 'draft', publishedBy: undefined, publishedAt: undefined, save: jest.fn() };
    const { service, attemptModel } = buildService(deployment, revision);

    const result = await service.publish(actorId, actorEmail, deploymentId, {});

    expect(revision.status).toBe('published');
    expect(deployment.currentPublishedRevisionId).toBe(revisionId);
    expect(attemptModel.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'success', revisionId: expect.anything() }));
    expect(result.currentPublishedRevisionId).toBe(revisionId);
  });

  it('publishes even when channel configuration is not ready', async () => {
    const deployment = { _id: deploymentId, programId, scopeId: '507f1f77bcf86cd799439015', status: 'dry_run', currentDraftRevisionId: revisionId, currentPublishedRevisionId: undefined, channels: { widget: { enabled: true, status: 'not_configured' } }, save: jest.fn() };
    const revision = { _id: revisionId, agentId, status: 'draft', save: jest.fn() };
    const { service, attemptModel, auditLogService } = buildService(deployment, revision);

    await expect(service.publish(actorId, actorEmail, deploymentId, {})).resolves.toMatchObject({ currentPublishedRevisionId: revisionId });
    expect(attemptModel.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'success', errorCode: undefined }));
    expect(auditLogService.logFailure).not.toHaveBeenCalled();
  });

  it('blocks publishing suspended deployments', async () => {
    const deployment = { _id: deploymentId, programId, scopeId: '507f1f77bcf86cd799439015', status: 'suspended', currentDraftRevisionId: revisionId, currentPublishedRevisionId: revisionId, channels: {}, save: jest.fn() };
    const revision = { _id: revisionId, agentId, status: 'published', save: jest.fn() };
    const { service } = buildService(deployment, revision);

    await expect(service.publish(actorId, actorEmail, deploymentId, {})).rejects.toMatchObject({ code: 'ERR_3670' });
  });

  it('blocks publishing rejected revisions', async () => {
    const deployment = { _id: deploymentId, programId, scopeId: '507f1f77bcf86cd799439015', status: 'dry_run', currentDraftRevisionId: revisionId, channels: {}, save: jest.fn() };
    const revision = { _id: revisionId, agentId, status: 'rejected', save: jest.fn() };
    const { service, attemptModel } = buildService(deployment, revision);

    await expect(service.publish(actorId, actorEmail, deploymentId, {})).rejects.toMatchObject({ code: 'ERR_3651' });
    expect(attemptModel.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', errorCode: 'ERR_3651' }));
  });

  it('blocks publishing when the draft revision has no passed dry-run', async () => {
    const deployment = { _id: deploymentId, programId, scopeId: '507f1f77bcf86cd799439015', status: 'dry_run', currentDraftRevisionId: revisionId, channels: {}, save: jest.fn() };
    const revision = { _id: revisionId, agentId, status: 'draft', save: jest.fn() };
    const { service, attemptModel } = buildService(deployment, revision, null);

    await expect(service.publish(actorId, actorEmail, deploymentId, {})).rejects.toMatchObject({ code: 'ERR_3670' });
    expect(attemptModel.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'blocked', errorCode: 'ERR_3670' }));
  });

  it('blocks suspend when no revision is published', async () => {
    const deployment = { _id: deploymentId, programId, scopeId: '507f1f77bcf86cd799439015', status: 'dry_run', currentPublishedRevisionId: undefined, channels: {}, save: jest.fn() };
    const { service } = buildService(deployment, null);

    await expect(service.suspend(actorId, actorEmail, deploymentId)).rejects.toMatchObject({ code: 'ERR_3653' });
  });
});
