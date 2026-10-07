import { ConversationNameService } from './conversation-name.service';

describe('ConversationNameService conversation name generation', () => {
  const buildService = (grpcError: Error | null, grpcResponse: { conversation_name: string }) => {
    const service = Object.create(ConversationNameService.prototype) as ConversationNameService;
    const updateConversationInternal = jest.fn().mockResolvedValue(undefined);
    const sendToUser = jest.fn();
    const generateName = jest.fn((_request: unknown, _metadata: unknown, _options: unknown, callback: (err: Error | null, response: { conversation_name: string }) => void) => {
      callback(grpcError, grpcResponse);
    });
    const chatbotClient = { GenerateConversationName: generateName };
    Object.assign(service as object, {
      modelsService: {
        getDefaultModel: jest.fn().mockResolvedValue({ litellmModel: 'default-model' }),
        findById: jest.fn().mockResolvedValue(null),
      },
      conversationSettings: {
        getSettings: jest.fn().mockResolvedValue({ conversationName: { modelId: null } }),
      },
      conversationService: { updateConversationInternal },
      streamGateway: { sendToUser },
      configService: { get: jest.fn((_key: string, fallback: unknown) => fallback) },
      logger: { log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
    return { service, chatbotClient, updateConversationInternal, sendToUser, generateName };
  };

  it('resolves the default model even when the request carries no modelId (governed conversations)', async () => {
    const { service, chatbotClient, generateName, updateConversationInternal, sendToUser } = buildService(null, {
      conversation_name: 'Excel classification guide',
    });

    await (service as any).generateConversationName('user-1', 'conversation-1', 'hello', 'user@example.com', chatbotClient);

    expect(generateName).toHaveBeenCalledWith(expect.objectContaining({ query: 'hello', model: 'default-model' }), expect.anything(), expect.anything(), expect.any(Function));
    expect(updateConversationInternal).toHaveBeenCalledWith('conversation-1', {
      title: 'Excel classification guide',
    });
    expect(sendToUser).toHaveBeenCalledWith('user-1', {
      type: 'conversation_name_generated',
      data: { conversationId: 'conversation-1', name: 'Excel classification guide' },
    });
  });

  it('uses the admin-configured naming model when one is set', async () => {
    const { service, chatbotClient, generateName } = buildService(null, { conversation_name: 'Some title' });
    Object.assign(service as object, {
      modelsService: {
        getDefaultModel: jest.fn().mockResolvedValue({ litellmModel: 'default-model' }),
        // Chosen model: id is the proxy alias; litellmModel is the provider-prefixed target.
        findById: jest.fn().mockResolvedValue({ id: 'gemma3:4b', litellmModel: 'ollama/gemma3:4b' }),
      },
      conversationSettings: {
        getSettings: jest.fn().mockResolvedValue({ conversationName: { modelId: 'gemma3:4b' } }),
      },
    });

    await (service as any).generateConversationName('user-1', 'conversation-1', 'hello', 'user@example.com', chatbotClient);

    // Routed via the proxy alias, not the provider-prefixed litellmModel.
    expect(generateName).toHaveBeenCalledWith(expect.objectContaining({ model: 'litellm_proxy/gemma3:4b' }), expect.anything(), expect.anything(), expect.any(Function));
  });

  it('keeps the default title when name generation fails', async () => {
    const { service, chatbotClient, updateConversationInternal, sendToUser } = buildService(new Error('model is required'), { conversation_name: '' });

    await expect((service as any).generateConversationName('user-1', 'conversation-1', 'hello', undefined, chatbotClient)).resolves.toBeUndefined();

    expect(updateConversationInternal).not.toHaveBeenCalled();
    expect(sendToUser).not.toHaveBeenCalled();
  });
});
