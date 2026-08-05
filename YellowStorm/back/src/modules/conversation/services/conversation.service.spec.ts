import { Types } from 'mongoose';
import { ConversationService } from './conversation.service';

describe('ConversationService sticky / tagged agents', () => {
  let conversationModel: {
    findById: jest.Mock;
    findByIdAndUpdate: jest.Mock;
  };
  let logger: { setContext: jest.Mock; log: jest.Mock };
  let service: ConversationService;

  beforeEach(() => {
    conversationModel = {
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn().mockResolvedValue({}),
    };
    logger = { setContext: jest.fn(), log: jest.fn() };

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
      {} as any,
    );
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
