import { ConflictException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { Types } from 'mongoose';
import { GovernanceDryRunService } from './governance-dry-run.service';

describe('GovernanceDryRunService', () => {
  const actorId = '507f1f77bcf86cd799439011';
  const actorEmail = 'owner@example.com';
  const deploymentId = '507f1f77bcf86cd799439012';
  const programId = '507f1f77bcf86cd799439013';
  const scopeId = '507f1f77bcf86cd799439014';
  const revisionId = '507f1f77bcf86cd799439015';
  const agentId = '507f1f77bcf86cd799439016';
  const conversationId = '507f1f77bcf86cd799439017';
  const userMessageId = '507f1f77bcf86cd799439018';
  const aiMessageId = '507f1f77bcf86cd799439019';

  let lastCreatedDryRun: Record<string, unknown> | undefined;

  function buildService(deployment: Record<string, unknown> | null, scopeAccessError?: Error, streamError?: Error) {
    lastCreatedDryRun = undefined;
    const deploymentModel = { findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(deployment) }) };
    const revisionModel = { findById: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: revisionId, agentId, workspaceIds: [] }) }) }) };
    const dryRunModel = {
      create: jest.fn().mockImplementation(async (payload) => {
        lastCreatedDryRun = { _id: { toString: () => 'dry-run-1' }, ...payload, save: jest.fn(), createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') };
        return lastCreatedDryRun;
      }),
      find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) }) }),
    };
    const programService = { assertOwnedProgram: jest.fn().mockResolvedValue(undefined) };
    const accessService = { assertScopeAccess: jest.fn().mockImplementation(async () => { if (scopeAccessError) throw scopeAccessError; }) };
    const conversationService = { create: jest.fn().mockResolvedValue({ id: conversationId }) };
    const messageService = {
      createUserMessage: jest.fn().mockResolvedValue({ id: userMessageId }),
      createAIPlaceholder: jest.fn().mockResolvedValue({ id: aiMessageId }),
      findByConversation: jest.fn().mockResolvedValue({ messages: [] }),
      markStreamFailed: jest.fn().mockResolvedValue(undefined),
    };
    const streamService = { startStream: jest.fn().mockImplementation(async () => { if (streamError) throw streamError; }) };
    const auditLogService = { logSuccess: jest.fn() };
    return {
      service: new GovernanceDryRunService(dryRunModel as never, deploymentModel as never, revisionModel as never, programService as never, accessService as never, conversationService as never, messageService as never, streamService as never, auditLogService as never),
      dryRunModel,
      programService,
      accessService,
      conversationService,
      messageService,
      streamService,
    };
  }

  // Let the fire-and-forget stream promise (and its .then/.catch) settle.
  const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

  it('creates dry-runs against the current draft revision through the conversation runtime, non-blocking', async () => {
    const { service, dryRunModel, programService, accessService, conversationService, messageService, streamService } = buildService({ _id: deploymentId, programId, scopeId, currentDraftRevisionId: revisionId });

    const result = await service.create(actorId, actorEmail, deploymentId, { input: 'hello', simulatedChannel: 'api' });

    expect(programService.assertOwnedProgram).toHaveBeenCalledWith(actorId, programId);
    expect(accessService.assertScopeAccess).toHaveBeenCalledWith(actorId, programId, scopeId);
    expect(conversationService.create).toHaveBeenCalledWith(actorId, expect.objectContaining({ title: 'Governance dry run' }));
    expect(messageService.createUserMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'hello', agentIds: [agentId] }));
    expect(streamService.startStream).toHaveBeenCalledWith(actorId, conversationId, aiMessageId, expect.objectContaining({ content: 'hello', agentIds: [agentId] }), expect.any(String), actorEmail);
    expect(dryRunModel.create).toHaveBeenCalledWith(expect.objectContaining({ revisionId, conversationId: expect.anything(), testerId: expect.anything() }));
    expect(result.revisionId).toBe(revisionId);
    // POST returns immediately while the reply streams in the background.
    expect(result.status).toBe('running');

    // Once the background stream resolves, the record is flipped to passed.
    await flushMicrotasks();
    expect(lastCreatedDryRun?.status).toBe('passed');
    expect(lastCreatedDryRun?.save).toHaveBeenCalled();
  });

  it('tests the requested mapped agent instead of the revision primary agent', async () => {
    const { service, messageService, streamService } = buildService({ _id: deploymentId, programId, scopeId, currentDraftRevisionId: revisionId });
    const otherAgentId = '507f1f77bcf86cd7994390ff';

    await service.create(actorId, actorEmail, deploymentId, { input: 'hello', agentId: otherAgentId });

    expect(messageService.createUserMessage).toHaveBeenCalledWith(expect.objectContaining({ agentIds: [otherAgentId] }));
    expect(streamService.startStream).toHaveBeenCalledWith(actorId, conversationId, aiMessageId, expect.objectContaining({ agentIds: [otherAgentId] }), expect.any(String), actorEmail);
  });

  it('records failed dry-runs when runtime execution fails', async () => {
    const { service, messageService } = buildService({ _id: deploymentId, programId, scopeId, currentDraftRevisionId: revisionId }, undefined, new Error('grpc down'));

    const result = await service.create(actorId, actorEmail, deploymentId, { input: 'hello' });
    expect(result.status).toBe('running');

    await flushMicrotasks();
    expect(messageService.markStreamFailed).toHaveBeenCalledWith(aiMessageId);
    expect(lastCreatedDryRun?.status).toBe('failed');
    expect(lastCreatedDryRun?.checks).toEqual(expect.objectContaining({ runtime: 'failed', error: 'grpc down' }));
  });

  it('lists dry-runs by deployment ObjectId', async () => {
    const dryRun = {
      _id: { toString: () => 'dry-run-1' },
      programId: { toString: () => programId },
      scopeId: { toString: () => scopeId },
      deploymentId: { toString: () => deploymentId },
      revisionId: { toString: () => revisionId },
      testerId: { toString: () => actorId },
      status: 'passed',
      testCases: [],
      checks: {},
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    const { service, dryRunModel } = buildService({ _id: deploymentId, programId, scopeId, currentDraftRevisionId: revisionId });
    dryRunModel.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([dryRun]) }) }) });

    const result = await service.list(actorId, deploymentId);

    expect(dryRunModel.find).toHaveBeenCalledWith({ deploymentId: expect.any(Types.ObjectId) });
    expect(dryRunModel.find.mock.calls[0][0].deploymentId.toString()).toBe(deploymentId);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('passed');
  });

  it('rejects dry-runs outside the actor scope', async () => {
    const denied = Object.assign(new Error('denied'), { code: ErrorCode.GOVERNANCE_ACCESS_DENIED });
    const { service } = buildService({ _id: deploymentId, programId, scopeId, currentDraftRevisionId: revisionId }, denied);

    await expect(service.create(actorId, actorEmail, deploymentId, {})).rejects.toMatchObject({ code: ErrorCode.GOVERNANCE_ACCESS_DENIED });
  });

  it('rejects dry-runs when no draft revision exists', async () => {
    const { service } = buildService({ _id: deploymentId, programId, scopeId });

    await expect(service.create(actorId, actorEmail, deploymentId, {})).rejects.toMatchObject({ code: ErrorCode.GOVERNANCE_NO_DRAFT_REVISION });
    await expect(service.create(actorId, actorEmail, deploymentId, {})).rejects.toBeInstanceOf(ConflictException);
  });
});
