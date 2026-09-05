import { PlaybookAssistantHistoryService } from './playbook-assistant-history.service';

function queryResult<T>(result: T) {
  const query: any = {
    sort: jest.fn(() => query),
    select: jest.fn(() => query),
    lean: jest.fn(() => query),
    exec: jest.fn().mockResolvedValue(result),
  };
  return query;
}

describe('PlaybookAssistantHistoryService', () => {
  it('returns the requested conversation as a public ordered message contract', async () => {
    const messages = [{
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
    }];
    const findQuery = queryResult(messages);
    const model = { find: jest.fn(() => findQuery), findOne: jest.fn() };
    const service = new PlaybookAssistantHistoryService(model as any);

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
    expect(model.find).toHaveBeenCalledWith({ ownerId: 'user-1', playbookId: 'playbook-1', conversationId: 'conversation-1' });
    expect(findQuery.sort).toHaveBeenCalledWith({ createdAt: 1 });
  });

  it('discovers the latest scoped conversation when none is supplied', async () => {
    const latestQuery = queryResult({ conversationId: 'conversation-latest' });
    const findQuery = queryResult([]);
    const model = {
      findOne: jest.fn(() => latestQuery),
      find: jest.fn(() => findQuery),
    };
    const service = new PlaybookAssistantHistoryService(model as any);

    await expect(service.list('user-1', 'playbook-1')).resolves.toEqual({
      conversationId: 'conversation-latest',
      messages: [],
    });
    expect(model.findOne).toHaveBeenCalledWith({ ownerId: 'user-1', playbookId: 'playbook-1' });
    expect(latestQuery.sort).toHaveBeenCalledWith({ createdAt: -1 });
  });

  it('returns an empty history when the user has no scoped conversation', async () => {
    const model = {
      findOne: jest.fn(() => queryResult(null)),
      find: jest.fn(),
    };
    const service = new PlaybookAssistantHistoryService(model as any);

    await expect(service.list('user-1', 'playbook-1')).resolves.toEqual({ conversationId: null, messages: [] });
    expect(model.find).not.toHaveBeenCalled();
  });
});
