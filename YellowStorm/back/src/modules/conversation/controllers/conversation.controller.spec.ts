import { ConversationController } from './conversation.controller';

describe('ConversationController active stream recovery', () => {
  it('returns the process-local snapshot for an authorized conversation route', () => {
    const getActiveStreamSnapshot = jest.fn().mockReturnValue({
      conversationId: 'conversation-1',
      messageId: 'message-1',
      revision: 3,
      components: [],
    });
    const controller = new ConversationController(
      {} as never,
      {} as never,
      { getActiveStreamSnapshot } as never,
      {} as never,
    );

    expect(controller.getActiveStream('conversation-1')).toEqual({
      conversationId: 'conversation-1',
      messageId: 'message-1',
      revision: 3,
      components: [],
    });
    expect(getActiveStreamSnapshot).toHaveBeenCalledWith('conversation-1');
  });
});
