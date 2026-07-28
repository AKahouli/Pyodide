import { MessageService } from './message.service';

describe('MessageService reliability cleanup', () => {
  it('atomically clears stale heartbeats and broadcasts the failed state', async () => {
    const candidate = { _id: { toString: () => 'message-1' } };
    const updated = {
      ...candidate,
      conversationId: { toString: () => 'conversation-1' },
      conversationType: 'ai',
      webSearchEnabled: false,
      isStreaming: false,
      isComplete: true,
      reliabilityEvaluation: { status: 'failed', failureCode: 'stale_pending_after_restart' },
      createdAt: new Date('2026-07-26T10:00:00.000Z'),
      updatedAt: new Date('2026-07-26T10:05:00.000Z'),
    };
    const messageModel = {
      find: jest.fn(() => ({ select: () => ({ lean: () => ({ exec: async () => [candidate] }) }) })),
      findOneAndUpdate: jest.fn().mockResolvedValue(updated),
    };
    const service = Object.create(MessageService.prototype) as MessageService;
    (service as unknown as { messageModel: unknown }).messageModel = messageModel;
    const broadcast = jest.fn().mockResolvedValue(undefined);
    (service as unknown as { broadcastMessage: typeof broadcast }).broadcastMessage = broadcast;

    await expect(service.markStaleReliabilityEvaluationsFailed(new Date('2026-07-26T10:04:00.000Z'))).resolves.toBe(1);

    expect(messageModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: candidate._id, 'reliabilityEvaluation.status': 'pending' }),
      expect.objectContaining({ $unset: { reliabilityEvaluationHeartbeatAt: 1 } }),
      { new: true },
    );
    expect(broadcast).toHaveBeenCalledWith('conversation-1', expect.objectContaining({
      type: 'message_updated',
      data: expect.objectContaining({
        messageId: 'message-1',
        message: { reliabilityEvaluation: updated.reliabilityEvaluation },
      }),
    }));
  });
});
