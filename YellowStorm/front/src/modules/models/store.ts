/**
 * Models Store
 * Zustand store for AI models management
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { ModelsStore, ModelsState, Model } from './types';
import * as api from './api';
import { i18nInstance } from '@/modules/localization/i18nInstance';
import { clearSelectedModelIdFromAllSessions } from '@/modules/app-builder-studio/selectedModelStorage';

const MODELS_SYNC_CHANNEL = 'ym-models-sync';

type ModelsSyncMessage = {
  type: 'app-builder-default';
  modelId: string | null;
  previousDefaultId: string | null;
};

export const CONVERSATION_V2_DEFAULT_MODEL_CHANGED_EVENT =
  'app-builder:default-model-changed';

export const DEFAULT_MODEL_CHANGED_EVENT = 'models:default-model-changed';

function applyAppBuilderDefault(
  modelId: string | null,
  previousDefaultIdOverride?: string | null,
): string | null {
  const previousDefaultId =
    previousDefaultIdOverride !== undefined
      ? previousDefaultIdOverride
      : (useModelsStore.getState().models.find((m) => m.__WIRE__isConversationV2Default__)?.id ?? null);

  useModelsStore.setState((state) => ({
    models: state.models.map((m) => ({
      ...m,
      __WIRE__isConversationV2Default__: modelId !== null && m.id === modelId,
    })),
  }));

  if (previousDefaultId) {
    clearSelectedModelIdFromAllSessions(previousDefaultId);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(CONVERSATION_V2_DEFAULT_MODEL_CHANGED_EVENT, {
        detail: { previousDefaultId, newDefaultId: modelId },
      }),
    );
  }

  return previousDefaultId;
}

function broadcastAppBuilderDefaultSync(
  modelId: string | null,
  previousDefaultId: string | null,
): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(MODELS_SYNC_CHANNEL);
    channel.postMessage({
      type: 'app-builder-default',
      modelId,
      previousDefaultId,
    } satisfies ModelsSyncMessage);
    channel.close();
  } catch {
    // BroadcastChannel unavailable — same-tab CustomEvent still applies.
  }
}

function tModels(key: string, fallback: string) {
  if (i18nInstance.isInitialized) {
    return i18nInstance.t(key, { ns: 'models', defaultValue: fallback });
  }
  return fallback;
}

// ===== Initial State =====

const initialState: ModelsState = {
  models: [],
  total: 0,
  isLoading: false,
  isInitialized: false,
  error: null,
  lastFetchedAt: null,
};

// ===== Store Implementation =====

export const useModelsStore = create<ModelsStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      fetchModels: async () => {
        const state = get();

        // Skip if already loading
        if (state.isLoading) {
          return;
        }

        // Skip if already initialized and data is fresh (< 5 minutes old)
        if (
          state.isInitialized &&
          state.lastFetchedAt &&
          Date.now() - state.lastFetchedAt.getTime() < 5 * 60 * 1000
        ) {
          return;
        }

        set({ isLoading: true, error: null });

        try {
          const response = await api.getModels();

          set({
            models: response.models,
            total: response.total,
            isLoading: false,
            isInitialized: true,
            error: null,
            lastFetchedAt: new Date(),
          });
        } catch (err) {
          const errorMessage =
            err instanceof Error ? err.message : tModels('store.errors.fetchFailed', 'Failed to fetch models');

          set({
            isLoading: false,
            error: errorMessage,
          });

          throw err;
        }
      },

      getModelById: (id: string): Model | undefined => {
        const state = get();
        return state.models.find((model) => model.id === id);
      },

      getModelsByChef: (chefSlug: string): Model[] => {
        const state = get();
        return state.models.filter(
          (model) => model.chefSlug.toLowerCase() === chefSlug.toLowerCase(),
        );
      },

      getChefs: (): Array<{ slug: string; name: string }> => {
        const state = get();
        const chefsMap = new Map<string, string>();

        for (const model of state.models) {
          if (!chefsMap.has(model.chefSlug)) {
            chefsMap.set(model.chefSlug, model.chef);
          }
        }

        return Array.from(chefsMap.entries())
          .map(([slug, name]) => ({ slug, name }))
          .sort((a, b) => a.name.localeCompare(b.name));
      },

      refreshModels: async () => {
        // Force refresh by clearing lastFetchedAt
        set({ lastFetchedAt: null, isInitialized: false });
        await get().fetchModels();
      },

      syncAppBuilderDefault: (modelId) => {
        const previousDefaultId = applyAppBuilderDefault(modelId);
        broadcastAppBuilderDefaultSync(modelId, previousDefaultId);
      },

      syncDefaultModel: (modelId: string | null) => {
        const previousDefaultId =
          useModelsStore.getState().models.find((m) => m.isDefault)?.id ?? null;

        useModelsStore.setState((state) => ({
          models: state.models.map((m) => ({
            ...m,
            isDefault: modelId !== null && m.id === modelId,
          })),
        }));

        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent(DEFAULT_MODEL_CHANGED_EVENT, {
              detail: { previousDefaultId, newDefaultId: modelId },
            }),
          );
        }
      },

      reset: () => {
        set(initialState);
      },
    }),
    { name: 'models-store' },
  ),
);

// ===== Selector Hooks =====

/**
 * Get all models
 */
export const useModels = () => useModelsStore(useShallow((state) => state.models));

/**
 * Get loading state
 */
export const useModelsLoading = () => useModelsStore((state) => state.isLoading);

/**
 * Get initialization state
 */
export const useModelsInitialized = () => useModelsStore((state) => state.isInitialized);

/**
 * Get error state
 */
export const useModelsError = () => useModelsStore((state) => state.error);

/**
 * Get model by ID
 */
export const useModelById = (id: string) =>
  useModelsStore((state) => state.models.find((m) => m.id === id));

/**
 * Get models by chef
 */
export const useModelsByChef = (chefSlug: string) =>
  useModelsStore(
    useShallow((state) =>
      state.models.filter(
        (m) => m.chefSlug.toLowerCase() === chefSlug.toLowerCase(),
      ),
    ),
  );

/**
 * Get unique chefs list
 */
export const useChefs = () => {
  const models = useModelsStore(useShallow((state) => state.models));
  const chefsMap = new Map<string, string>();

  for (const model of models) {
    if (!chefsMap.has(model.chefSlug)) {
      chefsMap.set(model.chefSlug, model.chef);
    }
  }

  return Array.from(chefsMap.entries())
    .map(([slug, name]) => ({ slug, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * Get the default model (the one with isDefault: true)
 */
export const useDefaultModel = () =>
  useModelsStore(useShallow((state) => state.models.find((m) => m.isDefault)));

/**
 * Get the conversation-v2 default model (the one with __WIRE__isConversationV2Default__: true)
 */
export const useAppBuilderDefaultModel = () =>
  useModelsStore(useShallow((state) => state.models.find((m) => m.__WIRE__isConversationV2Default__)));

if (typeof window !== 'undefined') {
  try {
    const channel = new BroadcastChannel(MODELS_SYNC_CHANNEL);
    channel.onmessage = (event: MessageEvent<ModelsSyncMessage>) => {
      if (event.data?.type !== 'app-builder-default') return;
      applyAppBuilderDefault(event.data.modelId, event.data.previousDefaultId);
    };
  } catch {
    // BroadcastChannel unavailable.
  }
}
