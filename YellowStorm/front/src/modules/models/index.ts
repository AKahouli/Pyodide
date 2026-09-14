/**
 * Models Module
 * Provides AI models data and management
 */

// Types
export type { Model, ModelsListResponse, ModelsState, ModelsStore } from './types';

// API functions
export { getModels, getModel, getModelsByChef } from './api';

// Store and hooks
export {
  useModelsStore,
  useModels,
  useModelsLoading,
  useModelsInitialized,
  useModelsError,
  useModelById,
  useModelsByChef,
  useChefs,
  useDefaultModel,
  useConversationV2DefaultModel,
  CONVERSATION_V2_DEFAULT_MODEL_CHANGED_EVENT,
  DEFAULT_MODEL_CHANGED_EVENT,
} from './store';
