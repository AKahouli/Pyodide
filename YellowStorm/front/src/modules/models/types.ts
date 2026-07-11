/**
 * Models Module Types
 * Mirrors backend interfaces for type safety
 */

// ===== Model Types =====

export interface Model {
  id: string;
  name: string;
  chef: string;
  chefSlug: string;
  litellmModel: string;
  providers: string[];
  type: string;
  types: string[];
  isActive: boolean;
  isDefault: boolean;
}

export interface ModelsListResponse {
  models: Model[];
  total: number;
}

// ===== Store Types =====

export interface ModelsState {
  // Data
  models: Model[];
  total: number;

  // Loading states
  isLoading: boolean;
  isInitialized: boolean;

  // Error state
  error: string | null;

  // Last fetched timestamp
  lastFetchedAt: Date | null;
}

export interface ModelsActions {
  // Fetch all models
  fetchModels: () => Promise<void>;

  // Get model by ID (from local cache)
  getModelById: (id: string) => Model | undefined;

  // Get models by chef/provider
  getModelsByChef: (chefSlug: string) => Model[];

  // Get unique chefs
  getChefs: () => Array<{ slug: string; name: string }>;

  // Refresh models (force fetch)
  refreshModels: () => Promise<void>;

  // Clear store
  reset: () => void;
}

export type ModelsStore = ModelsState & ModelsActions;
