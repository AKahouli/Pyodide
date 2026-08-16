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
  let agentRepository: { findActiveDefaultIdBySlugAndType: jest.Mock };
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
    agentRepository = { findActiveDefaultIdBySlugAndType: jest.fn() };

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
