import { ConflictException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
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

  function buildService(deployment: Record<string, unknown> | null, scopeAccessError?: Error, streamError?: Error) {
    const deploymentModel = { findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(deployment) }) };
    const revisionModel = { findById: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: revisionId, agentId, workspaceIds: [] }) }) }) };
    const dryRunModel = {
      create: jest.fn().mockImplementation(async (payload) => ({ _id: { toString: () => 'dry-run-1' }, ...payload, save: jest.fn(), createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') })),
    };
    const programService = { assertOwnedProgram: jest.fn().mockResolvedValue(undefined) };
    const accessService = { assertScopeAccess: jest.fn().mockImplementation(async () => { if (scopeAccessError) throw scopeAccessError; }) };
    const conversationService = { create: jest.fn().mockResolvedValue({ id: conversationId }) };
    const messageService = {
      createUserMessage: jest.fn().mockResolvedValue({ id: userMessageId }),
      createAIPlaceholder: jest.fn().mockResolvedValue({ id: aiMessageId }),
      findByConversation: jest.fn().mockResolvedValue({ messages: [] }),
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

  it('creates dry-runs against the current draft revision through the conversation runtime', async () => {
    const { service, dryRunModel, programService, accessService, conversationService, messageService, streamService } = buildService({ _id: deploymentId, programId, scopeId, currentDraftRevisionId: revisionId });

    const result = await service.create(actorId, actorEmail, deploymentId, { input: 'hello', simulatedChannel: 'api' });

    expect(programService.assertOwnedProgram).toHaveBeenCalledWith(actorId, programId);
    expect(accessService.assertScopeAccess).toHaveBeenCalledWith(actorId, programId, scopeId);
    expect(conversationService.create).toHaveBeenCalledWith(actorId, expect.objectContaining({ title: 'Governance dry run' }));
    expect(messageService.createUserMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'hello', agentIds: [agentId] }));
    expect(streamService.startStream).toHaveBeenCalledWith(actorId, conversationId, aiMessageId, expect.objectContaining({ content: 'hello', agentIds: [agentId] }), expect.any(String), actorEmail);
    expect(dryRunModel.create).toHaveBeenCalledWith(expect.objectContaining({ revisionId, conversationId: expect.anything(), testerId: expect.anything() }));
    expect(result.revisionId).toBe(revisionId);
    expect(result.status).toBe('passed');
  });

  it('records failed dry-runs when runtime execution fails', async () => {
    const { service } = buildService({ _id: deploymentId, programId, scopeId, currentDraftRevisionId: revisionId }, undefined, new Error('grpc down'));

    const result = await service.create(actorId, actorEmail, deploymentId, { input: 'hello' });

    expect(result.status).toBe('failed');
    expect(result.checks).toEqual(expect.objectContaining({ runtime: 'failed', error: 'grpc down' }));
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
