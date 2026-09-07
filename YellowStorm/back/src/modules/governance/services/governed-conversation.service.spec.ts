import { ConflictException, NotFoundException } from '@modules/exceptions';
import { CreateGovernedConversationDto } from '../dto';
import { GovernedConversationService } from './governed-conversation.service';

const userId = '507f1f77bcf86cd799439011';
const programId = '507f1f77bcf86cd799439012';
const scopeId = '507f1f77bcf86cd799439013';
const deploymentId = '507f1f77bcf86cd799439014';
const revisionId = '507f1f77bcf86cd799439015';

function queryResult<T>(value: T) {
  return { lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(value) }) };
}

describe('GovernedConversationService create', () => {
  function buildService(options: { scope?: unknown | null; deployment?: unknown; revision?: unknown } = {}) {
    const scope = options.scope === undefined ? { _id: { toString: () => scopeId }, programId: { toString: () => programId }, name: 'Municipal credit scope', status: 'active' } : options.scope;
    const deployment = options.deployment ?? { _id: { toString: () => deploymentId }, status: 'published', currentPublishedRevisionId: { toString: () => revisionId } };
    const revision = options.revision ?? { _id: { toString: () => revisionId }, deploymentId: { toString: () => deploymentId }, status: 'published', revisionNumber: 3, agentId: { toString: () => '507f1f77bcf86cd799439016' }, allowedAgentIds: [], workspaceIds: [] };
    const scopeModel = { findOne: jest.fn().mockReturnValue(queryResult(scope)) };
    const deploymentModel = { findOne: jest.fn().mockReturnValue(queryResult(deployment)) };
    const revisionModel = { findOne: jest.fn().mockReturnValue(queryResult(revision)) };
    const agentRepository = { findByIds: jest.fn().mockResolvedValue([]) };
    const audienceService = { assertUserAuthorized: jest.fn().mockResolvedValue(undefined) };
    const conversationService = { createGoverned: jest.fn().mockResolvedValue({ id: 'conversation-1' }) };
    const configService = { get: jest.fn().mockReturnValue(true) };
    const service = new GovernedConversationService(
      scopeModel as never,
      deploymentModel as never,
      revisionModel as never,
      agentRepository as never,
      audienceService as never,
      conversationService as never,
      configService as never,
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
    expect(payload).toEqual(expect.objectContaining({ requestId: dto.requestId, scopeId, deploymentId, revisionId, revisionNumber: 3 }));
  });

  it('rejects unknown scopes', async () => {
    const { service, conversationService } = buildService({ scope: null });

    await expect(service.create(userId, dto)).rejects.toBeInstanceOf(NotFoundException);
    expect(conversationService.createGoverned).not.toHaveBeenCalled();
  });

  it('rejects scopes without a published revision', async () => {
    const { service, conversationService } = buildService({ deployment: { _id: { toString: () => deploymentId }, status: 'published' } });

    await expect(service.create(userId, dto)).rejects.toBeInstanceOf(ConflictException);
    expect(conversationService.createGoverned).not.toHaveBeenCalled();
  });
});
