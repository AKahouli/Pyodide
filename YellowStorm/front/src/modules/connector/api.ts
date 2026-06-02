import apiClient, { type ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';

export interface ConnectorRepository {
  id: string;
  name: string;
  description: string;
  url: string;
  private: boolean;
  language: string;
  updatedAt: string;
}

export interface ConnectorRepositoriesResponse {
  repositories: ConnectorRepository[];
  total: number;
  page: number;
  limit: number;
}

export interface ConnectorRepositoriesParams {
  appKey: string;
  search?: string;
  page?: number;
  limit?: number;
}

export async function getConnectorRepositories(params: ConnectorRepositoriesParams): Promise<ConnectorRepositoriesResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set('appKey', params.appKey);
  if (params.search) searchParams.set('search', params.search);
  if (params.page) searchParams.set('page', params.page.toString());
  if (params.limit) searchParams.set('limit', params.limit.toString());

  const queryString = searchParams.toString();
  const response = await apiClient.get<ApiResponse<ConnectorRepositoriesResponse>>(
    `${API_ENDPOINTS.connectors.repositories}${queryString ? `?${queryString}` : ''}`
  );
  return response.data.data;
}
