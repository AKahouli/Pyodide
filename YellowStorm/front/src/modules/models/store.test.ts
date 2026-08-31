import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModelsStore } from './store';

vi.mock('./api', () => ({
  getModels: vi.fn(),
}));

vi.mock('@/modules/conversation-v2/selectedModelStorage', () => ({
  clearSelectedModelIdFromAllSessions: vi.fn(),
}));

describe('useModelsStore.syncConversationV2Default', () => {
  beforeEach(() => {
    useModelsStore.setState({
      models: [
        {
          id: 'model-a',
          name: 'Model A',
          chef: 'OpenAI',
          chefSlug: 'openai',
          litellmModel: 'gpt-a',
          providers: [],
          type: 'chat',
          types: ['chat'],
          isActive: true,
          isDefault: false,
          isConversationV2Default: true,
          omitTemperature: false,
          inputModalities: ['text'],
          maxInputTokens: null,
          maxOutputTokens: null,
          supportsReasoning: false,
        },
        {
          id: 'model-b',
          name: 'Model B',
          chef: 'Anthropic',
          chefSlug: 'anthropic',
          litellmModel: 'claude-b',
          providers: [],
          type: 'chat',
          types: ['chat'],
          isActive: true,
          isDefault: false,
          isConversationV2Default: false,
          omitTemperature: false,
          inputModalities: ['text'],
          maxInputTokens: null,
          maxOutputTokens: null,
          supportsReasoning: false,
        },
      ],
      total: 2,
      isLoading: false,
      isInitialized: true,
      error: null,
      lastFetchedAt: new Date(),
    });
  });

  it('updates conversation v2 default flags immediately', () => {
    useModelsStore.getState().syncConversationV2Default('model-b');

    const models = useModelsStore.getState().models;
    expect(models.find((m) => m.id === 'model-a')?.isConversationV2Default).toBe(false);
    expect(models.find((m) => m.id === 'model-b')?.isConversationV2Default).toBe(true);
  });

  it('uses the broadcast previousDefaultId when applying a remote sync', async () => {
    const { clearSelectedModelIdFromAllSessions } = await import(
      '@/modules/conversation-v2/selectedModelStorage'
    );
    useModelsStore.getState().syncConversationV2Default('model-b');
    vi.mocked(clearSelectedModelIdFromAllSessions).mockClear();

    const channel = new BroadcastChannel('ym-models-sync');
    channel.postMessage({
      type: 'conversation-v2-default',
      modelId: 'model-a',
      previousDefaultId: 'model-b',
    });
    await vi.waitFor(() => {
      expect(clearSelectedModelIdFromAllSessions).toHaveBeenCalledWith('model-b');
    });
    channel.close();
  });
});
