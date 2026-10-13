import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModelsStore } from './store';

vi.mock('./api', () => ({
  getModels: vi.fn(),
}));

vi.mock('@/modules/app-builder-studio/selectedModelStorage', () => ({
  clearSelectedModelIdFromAllSessions: vi.fn(),
}));

describe('useModelsStore.syncAppBuilderDefault', () => {
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
          __WIRE__isConversationV2Default__: true,
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
          __WIRE__isConversationV2Default__: false,
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

  it('updates App Builder default flags immediately', () => {
    useModelsStore.getState().syncAppBuilderDefault('model-b');

    const models = useModelsStore.getState().models;
    expect(models.find((m) => m.id === 'model-a')?.__WIRE__isConversationV2Default__).toBe(false);
    expect(models.find((m) => m.id === 'model-b')?.__WIRE__isConversationV2Default__).toBe(true);
  });

  it('uses the broadcast previousDefaultId when applying a remote sync', async () => {
    const { clearSelectedModelIdFromAllSessions } = await import(
      '@/modules/app-builder-studio/selectedModelStorage'
    );
    useModelsStore.getState().syncAppBuilderDefault('model-b');
    vi.mocked(clearSelectedModelIdFromAllSessions).mockClear();

    const channel = new BroadcastChannel('ym-models-sync');
    channel.postMessage({
      type: 'app-builder-default',
      modelId: 'model-a',
      previousDefaultId: 'model-b',
    });
    await vi.waitFor(() => {
      expect(clearSelectedModelIdFromAllSessions).toHaveBeenCalledWith('model-b');
    });
    channel.close();
  });
});
