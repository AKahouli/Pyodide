import { Types } from 'mongoose';
import { ConversationService } from './conversation.service';

describe('ConversationService sticky / tagged agents', () => {
  let conversationModel: {
    findById: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
  };
  let logger: { setContext: jest.Mock; log: jest.Mock };
  let agentRepository: { findActiveDefaultIdBySlugAndType: jest.Mock; existsActiveDefault: jest.Mock };
  let copilotSettings: { getSettings: jest.Mock };
  let service: ConversationService;

  beforeEach(() => {
    conversationModel = {
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn().mockResolvedValue({}),
      findOne: jest.fn(),
      create: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    logger = { setContext: jest.fn(), log: jest.fn() };
    agentRepository = {
      findActiveDefaultIdBySlugAndType: jest.fn(),
      existsActiveDefault: jest.fn().mockResolvedValue(false),
    };
    copilotSettings = { getSettings: jest.fn().mockResolvedValue({ agentId: null }) };

    service = new ConversationService(
      conversationModel as any,
      {} as any,
      {} as any,
      {} as any,
      logger as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      agentRepository as any,
      copilotSettings as any,
    );
  });

  describe('platform copilot pinning', () => {
    it('resolves only the active default my-second-brain platform copilot', async () => {
      const agentId = new Types.ObjectId().toString();
      agentRepository.findActiveDefaultIdBySlugAndType.mockResolvedValue(agentId);

      await expect(service.assertPlatformCopilotAgent(new Types.ObjectId(agentId))).resolves.toBe(agentId);
      expect(agentRepository.findActiveDefaultIdBySlugAndType).toHaveBeenCalledWith('my-second-brain', 'platform_copilot');
    });

    it('fails closed when the stored pin no longer matches the active agent', async () => {
      agentRepository.findActiveDefaultIdBySlugAndType.mockResolvedValue(new Types.ObjectId().toString());
      await expect(service.assertPlatformCopilotAgent(new Types.ObjectId())).rejects.toThrow('Yellowmind is currently unavailable');
    });

    it('resolves the admin-mapped copilot assistant agent when it is an active default', async () => {
      const configuredAgentId = new Types.ObjectId().toString();
      copilotSettings.getSettings.mockResolvedValue({ agentId: configuredAgentId });
      agentRepository.existsActiveDefault.mockResolvedValue(true);

      await expect(service.assertPlatformCopilotAgent(new Types.ObjectId(configuredAgentId))).resolves.toBe(configuredAgentId);
      expect(agentRepository.findActiveDefaultIdBySlugAndType).not.toHaveBeenCalled();
    });

    it('falls back to the active Yellowmind heuristic when the mapped agent is no longer an active default', async () => {
      const configuredAgentId = new Types.ObjectId().toString();
      const heuristicAgentId = new Types.ObjectId().toString();
      copilotSettings.getSettings.mockResolvedValue({ agentId: configuredAgentId });
      agentRepository.existsActiveDefault.mockResolvedValue(false);
      agentRepository.findActiveDefaultIdBySlugAndType.mockResolvedValue(heuristicAgentId);

      await expect(service.assertPlatformCopilotAgent(new Types.ObjectId(heuristicAgentId))).resolves.toBe(heuristicAgentId);
      expect(agentRepository.findActiveDefaultIdBySlugAndType).toHaveBeenCalledWith('my-second-brain', 'platform_copilot');
    });

    it('repairs a stale pin when the mapped copilot assistant agent changes', async () => {
      const configuredAgentId = new Types.ObjectId().toString();
      const stalePin = new Types.ObjectId();
      const conversation = {
        _id: new Types.ObjectId(),
        pinnedAgentId: stalePin,
        taggedAgentIds: [stalePin],
      };
      copilotSettings.getSettings.mockResolvedValue({ agentId: configuredAgentId });
      agentRepository.existsActiveDefault.mockResolvedValue(true);

      await expect(service.resolvePlatformCopilotAgent(conversation)).resolves.toBe(configuredAgentId);
      expect(conversation.pinnedAgentId.toString()).toBe(configuredAgentId);
      expect(conversationModel.findByIdAndUpdate).toHaveBeenCalledWith(conversation._id, {
        $set: {
          pinnedAgentId: expect.any(Types.ObjectId),
          taggedAgentIds: [expect.any(Types.ObjectId)],
        },
      });
    });

    it('creates distinct conversations idempotently by creation request', async () => {
      const ownerId = new Types.ObjectId();
      const agentId = new Types.ObjectId();
      const requestId = '927ea1f2-5e0b-4a23-a352-b29fe8d33e0c';
      conversationModel.findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(null) }) });
      agentRepository.findActiveDefaultIdBySlugAndType.mockResolvedValue(agentId.toString());
      conversationModel.create.mockImplementation(async (data) => ({
        ...data,
        _id: new Types.ObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      await service.create(ownerId.toString(), { runtimePurpose: 'platform_copilot', creationRequestId: requestId });

      expect(conversationModel.findOne).toHaveBeenCalledWith(expect.objectContaining({
        createdBy: ownerId,
        runtimePurpose: 'platform_copilot',
        platformCopilotCreationRequestId: requestId,
      }));
      expect(conversationModel.create).toHaveBeenCalledWith(expect.objectContaining({
        platformCopilotCreationRequestId: requestId,
        pinnedAgentId: agentId,
      }));
    });

    it('replays an existing explicit creation request without creating again', async () => {
      const ownerId = new Types.ObjectId();
      const agentId = new Types.ObjectId();
      const existing = {
        _id: new Types.ObjectId(),
        title: 'Yellowmind',
        createdBy: ownerId,
        runtimePurpose: 'platform_copilot',
        pinnedAgentId: agentId,
        workspaces: [], selectedSkills: [], taggedAgentIds: [], messageCount: 0,
        isArchived: false, isShared: false, createdAt: new Date(), updatedAt: new Date(),
      };
      conversationModel.findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(existing) }) });
      agentRepository.findActiveDefaultIdBySlugAndType.mockResolvedValue(agentId.toString());

      const result = await service.create(ownerId.toString(), {
        runtimePurpose: 'platform_copilot',
        creationRequestId: '927ea1f2-5e0b-4a23-a352-b29fe8d33e0c',
      });

      expect(result.id).toBe(existing._id.toString());
      expect(conversationModel.create).not.toHaveBeenCalled();
      expect(conversationModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('repairs a stale pin when an existing conversation still points at a retired agent', async () => {
      const ownerId = new Types.ObjectId();
      const staleAgentId = new Types.ObjectId();
      const activeAgentId = new Types.ObjectId();
      const existing = {
        _id: new Types.ObjectId(),
        title: 'Yellowmind',
        createdBy: ownerId,
        runtimePurpose: 'platform_copilot',
        pinnedAgentId: staleAgentId,
        taggedAgentIds: [staleAgentId],
        workspaces: [], selectedSkills: [], messageCount: 0,
        isArchived: false, isShared: false, createdAt: new Date(), updatedAt: new Date(),
      };
      conversationModel.findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(existing) }) });
      conversationModel.findByIdAndUpdate.mockResolvedValue({});
      agentRepository.findActiveDefaultIdBySlugAndType.mockResolvedValue(activeAgentId.toString());

      const result = await service.create(ownerId.toString(), { runtimePurpose: 'platform_copilot' });

      expect(conversationModel.findByIdAndUpdate).toHaveBeenCalledWith(
        existing._id,
        {
          $set: {
            pinnedAgentId: activeAgentId,
            taggedAgentIds: [activeAgentId],
          },
        },
      );
      expect(result.id).toBe(existing._id.toString());
      expect(result.pinnedAgentId).toBe(activeAgentId.toString());
      expect(result.taggedAgentIds).toEqual([activeAgentId.toString()]);
      expect(conversationModel.create).not.toHaveBeenCalled();
    });

    it('keeps a valid pin untouched when reusing an existing conversation', async () => {
      const ownerId = new Types.ObjectId();
      const agentId = new Types.ObjectId();
      const existing = {
        _id: new Types.ObjectId(),
        title: 'Yellowmind',
        createdBy: ownerId,
        runtimePurpose: 'platform_copilot',
        pinnedAgentId: agentId,
        taggedAgentIds: [agentId],
        workspaces: [], selectedSkills: [], messageCount: 0,
        isArchived: false, isShared: false, createdAt: new Date(), updatedAt: new Date(),
      };
      conversationModel.findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(existing) }) });
      agentRepository.findActiveDefaultIdBySlugAndType.mockResolvedValue(agentId.toString());

      const result = await service.create(ownerId.toString(), { runtimePurpose: 'platform_copilot' });

      expect(conversationModel.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(result.pinnedAgentId).toBe(agentId.toString());
    });

    it('resolvePlatformCopilotAgent repoints a stale pin in place', async () => {
      const conversationId = new Types.ObjectId();
      const staleAgentId = new Types.ObjectId();
      const activeAgentId = new Types.ObjectId();
      const conversation = {
        _id: conversationId,
        pinnedAgentId: staleAgentId,
        taggedAgentIds: [staleAgentId],
      };
      conversationModel.findByIdAndUpdate.mockResolvedValue({});
      agentRepository.findActiveDefaultIdBySlugAndType.mockResolvedValue(activeAgentId.toString());

      const resolved = await service.resolvePlatformCopilotAgent(conversation);

      expect(resolved).toBe(activeAgentId.toString());
      expect(conversation.pinnedAgentId.toString()).toBe(activeAgentId.toString());
      expect(conversation.taggedAgentIds.map((id: Types.ObjectId) => id.toString())).toEqual([activeAgentId.toString()]);
      expect(conversationModel.findByIdAndUpdate).toHaveBeenCalledWith(
        conversationId,
        { $set: { pinnedAgentId: activeAgentId, taggedAgentIds: [activeAgentId] } },
      );
    });

    it('lists platform-copilot history for its owner only', async () => {
      const ownerId = new Types.ObjectId();
      let capturedQuery: Record<string, unknown> | undefined;
      conversationModel.find.mockImplementation((query) => {
        capturedQuery = query;
        return {
          sort: () => ({
            skip: () => ({
              limit: () => ({ lean: () => ({ exec: jest.fn().mockResolvedValue([]) }) }),
            }),
          }),
        };
      });

      await service.findAllByUser(ownerId.toString(), { runtimePurpose: 'platform_copilot' });

      expect(capturedQuery).toEqual(expect.objectContaining({
        createdBy: ownerId,
        runtimePurpose: 'platform_copilot',
      }));
      expect(capturedQuery).not.toHaveProperty('$or');
    });
  });

  describe('replaceTaggedAgentIds', () => {
    it('no-ops when agentIds is empty', async () => {
      await service.replaceTaggedAgentIds(new Types.ObjectId().toString(), []);
      expect(conversationModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('sets taggedAgentIds with a full replace ($set)', async () => {
      const conversationId = new Types.ObjectId().toString();
      const agentA = new Types.ObjectId().toString();
      const agentB = new Types.ObjectId().toString();

      await service.replaceTaggedAgentIds(conversationId, [agentA, agentB]);

      expect(conversationModel.findByIdAndUpdate).toHaveBeenCalledWith(
        conversationId,
        {
          $set: {
            taggedAgentIds: [
              expect.any(Types.ObjectId),
              expect.any(Types.ObjectId),
            ],
          },
        },
      );
      const setArg = conversationModel.findByIdAndUpdate.mock.calls[0][1].$set
        .taggedAgentIds as Types.ObjectId[];
      expect(setArg.map((id) => id.toString())).toEqual([agentA, agentB]);
    });
  });

  describe('updateTaggedAgents', () => {
    it('no-ops for non-group conversations', async () => {
      conversationModel.findById.mockResolvedValue({
        groupMeta: { isGroup: false, taggedAgents: [] },
      });

      await service.updateTaggedAgents(new Types.ObjectId().toString(), [
        new Types.ObjectId().toString(),
      ]);

      expect(conversationModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('addToSets new agents for group conversations', async () => {
      const conversationId = new Types.ObjectId().toString();
      const existing = new Types.ObjectId();
      const next = new Types.ObjectId();
      conversationModel.findById.mockResolvedValue({
        groupMeta: {
          isGroup: true,
          taggedAgents: [existing],
        },
      });

      await service.updateTaggedAgents(conversationId, [
        existing.toString(),
        next.toString(),
      ]);

      expect(conversationModel.findByIdAndUpdate).toHaveBeenCalledWith(
        conversationId,
        {
          $addToSet: {
            'groupMeta.taggedAgents': {
              $each: [expect.any(Types.ObjectId)],
            },
          },
        },
      );
      const each = conversationModel.findByIdAndUpdate.mock.calls[0][1].$addToSet[
        'groupMeta.taggedAgents'
      ].$each as Types.ObjectId[];
      expect(each.map((id) => id.toString())).toEqual([next.toString()]);
    });
  });
});
