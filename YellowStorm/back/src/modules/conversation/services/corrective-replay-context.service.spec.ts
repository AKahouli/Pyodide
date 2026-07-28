import { CorrectiveReplayContextService } from './corrective-replay-context.service';

describe('CorrectiveReplayContextService', () => {
  it('returns the complete persisted context for new messages', async () => {
    const replayContext = {
      content: 'Canonical question', attachedFileIds: ['file-1'], webSearchEnabled: true,
      deepSearchEnabled: true, modelId: 'model-1', agentIds: ['agent-1'], skillIds: ['skill-1'],
    };
    const service = new CorrectiveReplayContextService(
      { getMessageDocument: jest.fn().mockResolvedValue({ replayContext }) } as never,
      {} as never,
    );
    await expect(service.resolve('question-1')).resolves.toEqual({ request: replayContext, historical: false });
  });

  it('rejects unsafe historical governed reconstruction', async () => {
    const service = new CorrectiveReplayContextService(
      { getMessageDocument: jest.fn().mockResolvedValue({
        conversationId: { toString: () => 'conversation-1' }, content: 'Old question', webSearchEnabled: false,
      }) } as never,
      { getConversationDocument: jest.fn().mockResolvedValue({ runtimeMode: 'governed' }) } as never,
    );
    await expect(service.resolve('question-1')).resolves.toBeUndefined();
  });
});
