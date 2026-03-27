/**
 * Models API Functions
 */

import { apiClient, API_ENDPOINTS, ApiResponse } from '@/lib/api';
import type { Model, ModelsListResponse } from './types';

/**
 * Get all available models
 */
export async function getModels(): Promise<ModelsListResponse> {
  const response = await apiClient.get<ApiResponse<ModelsListResponse>>(
    API_ENDPOINTS.models.list,
  );
  return response.data.data;
}

/**
 * Get a model by ID
 */
export async function getModel(id: string): Promise<Model> {
  const response = await apiClient.get<ApiResponse<Model>>(
    API_ENDPOINTS.models.byId(id),
  );
  return response.data.data;
}

/**
 * Get models by chef/provider
 */
export async function getModelsByChef(chefSlug: string): Promise<ModelsListResponse> {
  const response = await apiClient.get<ApiResponse<ModelsListResponse>>(
    API_ENDPOINTS.models.byChef(chefSlug),
  );
  return response.data.data;
}
