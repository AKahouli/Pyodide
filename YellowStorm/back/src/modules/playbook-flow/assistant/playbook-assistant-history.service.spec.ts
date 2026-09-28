import { PlaybookAssistantHistoryService } from './playbook-assistant-history.service';

const messageRepository = (overrides: Record<string, jest.Mock> = {}) => ({
  appendOnce: jest.fn().mockResolvedValue(undefined),
  latestConversationId: jest.fn().mockResolvedValue(null),
  listConversation: jest.fn().mockResolvedValue([]),
  ...overrides,
});

describe('PlaybookAssistantHistoryService', () => {
  it('returns the requested conversation as a public ordered message contract', async () => {
    const messages = [{
      id: '64f000000000000000000001',
      messageId: 'message-1',
      requestId: 'request-1',
      conversationId: 'conversation-1',
      ownerId: 'user-1',
      playbookId: 'playbook-1',
      role: 'assistant',
      content: 'Answer',
      operationId: null,
      expiresAt: new Date(),
      createdAt: new Date('2026-08-16T00:00:00Z'),
      updatedAt: new Date('2026-08-16T00:00:00Z'),
    }];
    const repository = messageRepository({ listConversation: jest.fn().mockResolvedValue(messages) });
    const service = new PlaybookAssistantHistoryService(repository as never);

    await expect(service.list('user-1', 'playbook-1', 'conversation-1')).resolves.toEqual({
      conversationId: 'conversation-1',
      messages: [{
        messageId: 'message-1',
        role: 'assistant',
        content: 'Answer',
        operationId: null,
        createdAt: new Date('2026-08-16T00:00:00Z'),
      }],
    });
    expect(repository.listConversation).toHaveBeenCalledWith('user-1', 'playbook-1', 'conversation-1');
    expect(repository.latestConversationId).not.toHaveBeenCalled();
  });

  it('discovers the latest scoped conversation when none is supplied', async () => {
    const repository = messageRepository({ latestConversationId: jest.fn().mockResolvedValue('conversation-latest') });
    const service = new PlaybookAssistantHistoryService(repository as never);

    await expect(service.list('user-1', 'playbook-1')).resolves.toEqual({
      conversationId: 'conversation-latest',
      messages: [],
    });
    expect(repository.latestConversationId).toHaveBeenCalledWith('user-1', 'playbook-1');
    expect(repository.listConversation).toHaveBeenCalledWith('user-1', 'playbook-1', 'conversation-latest');
  });

  it('returns an empty history when the user has no scoped conversation', async () => {
    const repository = messageRepository();
    const service = new PlaybookAssistantHistoryService(repository as never);

    await expect(service.list('user-1', 'playbook-1')).resolves.toEqual({ conversationId: null, messages: [] });
    expect(repository.listConversation).not.toHaveBeenCalled();
  });

  it('appends one message per request and role, kept for thirty days', async () => {
    const repository = messageRepository();
    const service = new PlaybookAssistantHistoryService(repository as never);
    const before = Date.now();

    await service.append({
      requestId: 'request-1', conversationId: 'conversation-1', ownerId: 'user-1', playbookId: 'playbook-1',
      role: 'user', content: 'Add scoring',
    });

    const input = repository.appendOnce.mock.calls[0][0];
    expect(input).toMatchObject({
      messageId: expect.any(String), requestId: 'request-1', conversationId: 'conversation-1', ownerId: 'user-1',
      playbookId: 'playbook-1', role: 'user', content: 'Add scoring', operationId: null,
    });
    expect(input.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 30 * 24 * 60 * 60 * 1000);
  });
});
