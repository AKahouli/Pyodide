import { MessageSchema } from './message.schema';

describe('MessageSchema request idempotency index', () => {
  it('scopes duplicate request IDs to the sender within a conversation', () => {
    const index = MessageSchema.indexes().find(([, options]) =>
      options.name === 'conversation_sender_type_request_unique');

    expect(index).toEqual([
      { conversationId: 1, senderId: 1, conversationType: 1, requestId: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });
});
