import axios from 'axios';
import { ComposerSuggestionsService } from './composer-suggestions.service';

describe('ComposerSuggestionsService temperature forwarding', () => {
  const agent = {
    id: 'agent-1',
    name: 'Suggestions',
    model: 'model-1',
    agentType: { name: 'Composer' },
    isDefault: false,
    ignorePrePrompt: false,
  } as any;

  const createService = (): ComposerSuggestionsService => new ComposerSuggestionsService(
    { get: jest.fn((key: string) => key === 'indexing.adkApiKey' ? 'adk-key' : 'http://adk') } as any,
    { findById: jest.fn(), getDefaultModel: jest.fn() } as any,
    { setContext: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
    {} as any,
    {} as any,
  );

  afterEach(() => jest.restoreAllMocks());

  it('sends null temperature for an omit-enabled agent model', async () => {
    const service = createService();
    jest.spyOn(service as any, 'getAgentForComposer').mockResolvedValue(agent);
    jest.spyOn(service as any, 'buildAgentPrompt').mockResolvedValue('Prompt');
    jest.spyOn((service as any).modelsService, 'findById').mockResolvedValue({
      id: 'model-1', omitTemperature: true,
    });
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { content: 'Suggestion' } });

    await expect(service.fetchSuggestions('Continue')).resolves.toEqual({ content: 'Suggestion' });

    expect(post).toHaveBeenCalledWith(
      'http://adk/chatbots/chat_completion',
      expect.objectContaining({ model: 'model-1', temperature: null }),
      expect.any(Object),
    );
  });

  it('preserves zero temperature for a model that does not omit it', async () => {
    const service = createService();
    jest.spyOn(service as any, 'getAgentForComposer').mockResolvedValue(agent);
    jest.spyOn(service as any, 'buildAgentPrompt').mockResolvedValue('Prompt');
    jest.spyOn((service as any).modelsService, 'findById').mockResolvedValue({
      id: 'model-1', omitTemperature: false,
    });
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { content: 'Suggestion' } });

    await service.fetchSuggestions('Continue');

    expect(post).toHaveBeenCalledWith(
      'http://adk/chatbots/chat_completion',
      expect.objectContaining({ model: 'model-1', temperature: 0 }),
      expect.any(Object),
    );
  });

  it('sends null temperature for an omit-enabled default model', async () => {
    const service = createService();
    jest.spyOn(service as any, 'getAgentForComposer').mockResolvedValue({ ...agent, model: '' });
    jest.spyOn(service as any, 'buildAgentPrompt').mockResolvedValue('Prompt');
    jest.spyOn((service as any).modelsService, 'getDefaultModel').mockResolvedValue({
      id: 'default-model', litellmModel: 'azure/gpt-5.4-mini', omitTemperature: true,
    });
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { content: 'Suggestion' } });

    await service.fetchSuggestions('Continue');

    expect(post).toHaveBeenCalledWith(
      'http://adk/chatbots/chat_completion',
      expect.objectContaining({ model: 'azure/gpt-5.4-mini', temperature: null }),
      expect.any(Object),
    );
  });
});
