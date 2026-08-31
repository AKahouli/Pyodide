import { MessageService } from './message.service';

describe('MessageService reliability cleanup', () => {
  it('atomically clears stale heartbeats and broadcasts the failed state', async () => {
    const updated = {
      id: 'message-1',
      conversationId: 'conversation-1',
      conversationType: 'ai',
      webSearchEnabled: false,
      isStreaming: false,
      isComplete: true,
      reliabilityEvaluation: { status: 'failed', failureCode: 'stale_pending_after_restart' },
      createdAt: new Date('2026-07-26T10:00:00.000Z'),
      updatedAt: new Date('2026-07-26T10:05:00.000Z'),
    };
    const messageStore = {
      failStaleReliability: jest.fn().mockResolvedValue([updated]),
    };
    const service = Object.create(MessageService.prototype) as MessageService;
    (service as unknown as { messageStore: unknown }).messageStore = messageStore;
    const broadcast = jest.fn().mockResolvedValue(undefined);
    (service as unknown as { broadcastMessage: typeof broadcast }).broadcastMessage = broadcast;

    await expect(service.markStaleReliabilityEvaluationsFailed(new Date('2026-07-26T10:04:00.000Z'))).resolves.toBe(1);

    expect(messageStore.failStaleReliability).toHaveBeenCalledWith(
      new Date('2026-07-26T10:04:00.000Z'),
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
