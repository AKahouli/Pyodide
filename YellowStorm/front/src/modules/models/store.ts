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
 * Get the conversation-v2 default model (the one with isConversationV2Default: true)
 */
export const useConversationV2DefaultModel = () =>
  useModelsStore(useShallow((state) => state.models.find((m) => m.isConversationV2Default)));
