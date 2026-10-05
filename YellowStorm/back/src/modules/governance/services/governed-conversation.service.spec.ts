import { ConflictException, NotFoundException } from '@modules/exceptions';
import { CreateGovernedConversationDto } from '../dto';
import { GovernedConversationService } from './governed-conversation.service';
import { newRootExecutionPolicy } from '@modules/agent/interfaces/root-execution-policy.interface';
import { sealRootWork } from './governance-root-snapshot';

const userId = '507f1f77bcf86cd799439011';
const programId = '507f1f77bcf86cd799439012';
const scopeId = '507f1f77bcf86cd799439013';
const deploymentId = '507f1f77bcf86cd799439014';
const revisionId = '507f1f77bcf86cd799439015';
const primaryAgentId = '507f1f77bcf86cd799439016';

describe('GovernedConversationService create', () => {
  function buildService(options: { scope?: unknown | null; deployment?: unknown; revision?: unknown } = {}) {
    const scope = options.scope === undefined ? { id: scopeId, programId, name: 'Municipal credit scope', status: 'active' } : options.scope;
    const deployment = options.deployment ?? { id: deploymentId, scopeId, status: 'published', currentPublishedRevisionId: revisionId };
    const revision = options.revision ?? { id: revisionId, deploymentId, status: 'published', revisionNumber: 3, agentId: primaryAgentId, allowedAgentIds: [], workspaceIds: [] };
    const scopeStore = { findById: jest.fn().mockResolvedValue(scope) };
    const deploymentStore = { listPublishedByScopes: jest.fn().mockResolvedValue(deployment ? [deployment] : []) };
    const revisionStore = { findByDeploymentAndId: jest.fn().mockResolvedValue(revision) };
    const agentRepository = { findByIds: jest.fn().mockResolvedValue([]) };
    const audienceService = { assertUserAuthorized: jest.fn().mockResolvedValue(undefined) };
    const conversationService = { createGoverned: jest.fn().mockResolvedValue({ id: 'conversation-1' }) };
    const featureVisibility = { isEnabled: jest.fn().mockReturnValue(true) };
    const service = new GovernedConversationService(
      scopeStore as never,
      deploymentStore as never,
      revisionStore as never,
      agentRepository as never,
      audienceService as never,
      conversationService as never,
      featureVisibility as never,
      { get: jest.fn().mockReturnValue('test-only-secret') } as never,
    );
    return { service, conversationService };
  }

  const dto = { scopeId, requestId: '8d0f0f2a-1b2c-4d3e-8f4a-5b6c7d8e9f0a' } as CreateGovernedConversationDto;

  it('creates the governed conversation without inheriting the scope name as title', async () => {
    const { service, conversationService } = buildService();

    await service.create(userId, dto);

    expect(conversationService.createGoverned).toHaveBeenCalledTimes(1);
    const payload = conversationService.createGoverned.mock.calls[0][1];
    expect(payload.title).toBeUndefined();
    expect(payload.rootAgentId).toBeUndefined();
    expect(payload).toEqual(expect.objectContaining({ requestId: dto.requestId, scopeId, deploymentId, revisionId, revisionNumber: 3 }));
  });

  it('binds only a server-published enrolled Root to a new governed conversation', async () => {
    const { service, conversationService } = buildService({ revision: { id: revisionId, deploymentId,
      status: 'published', revisionNumber: 3, agentId: primaryAgentId, allowedAgentIds: [primaryAgentId], workspaceIds: [],
      agentSnapshot: { rootWork: sealRootWork({ version: 1, pool: { rootAgentId: primaryAgentId, rootSnapshotDigest: 'frozen',
        policy: newRootExecutionPolicy(), entries: [] } as never }, revisionId, 'test-only-secret') } } });
    await service.create(userId, dto);
    expect(conversationService.createGoverned.mock.calls[0][1].rootAgentId).toBe(primaryAgentId);
  });

  it('rejects unknown scopes', async () => {
    const { service, conversationService } = buildService({ scope: null });

    await expect(service.create(userId, dto)).rejects.toBeInstanceOf(NotFoundException);
    expect(conversationService.createGoverned).not.toHaveBeenCalled();
  });

  it('rejects scopes without a published revision', async () => {
    const { service, conversationService } = buildService({ deployment: { id: deploymentId, scopeId, status: 'published' } });

    await expect(service.create(userId, dto)).rejects.toBeInstanceOf(ConflictException);
    expect(conversationService.createGoverned).not.toHaveBeenCalled();
  });
});
