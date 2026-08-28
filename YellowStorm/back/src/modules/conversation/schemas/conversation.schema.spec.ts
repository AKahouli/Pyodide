import { ConversationSchema } from './conversation.schema';

describe('ConversationSchema platform-copilot creation index', () => {
  it('allows multiple transcripts while making each creation request idempotent', () => {
    const index = ConversationSchema.indexes().find(([, options]) =>
      options.name === 'platform_copilot_creation_request_unique');

    expect(index).toEqual([
      { createdBy: 1, platformCopilotCreationRequestId: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });
});
