import { apiClient, type ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type {
  ConnectedAppWithStatus,
  UserConnectionInfo,
  ConnectedAppAdminResponse,
  CreateConnectedAppDefinition,
  UpdateConnectedAppDefinition,
} from './types';

// ==================== User-facing ====================

export async function getAvailableApps(): Promise<ConnectedAppWithStatus[]> {
  const response = await apiClient.get<ApiResponse<ConnectedAppWithStatus[]>>(
    API_ENDPOINTS.connectedApps.list,
  );
  return response.data.data;
}

export async function getUserConnections(): Promise<UserConnectionInfo[]> {
  const response = await apiClient.get<ApiResponse<UserConnectionInfo[]>>(
    API_ENDPOINTS.connectedApps.connections,
  );
  return response.data.data;
}

export async function getAuthorizationUrl(appKey: string): Promise<string> {
  const response = await apiClient.get<ApiResponse<{ authorizationUrl: string }>>(
    API_ENDPOINTS.connectedApps.authorize(appKey),
  );
  return response.data.data.authorizationUrl;
}

export async function disconnectApp(appKey: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.connectedApps.disconnect(appKey));
}

// ==================== Admin ====================

export async function getAdminConnectedApps(): Promise<ConnectedAppAdminResponse[]> {
  const response = await apiClient.get<ApiResponse<ConnectedAppAdminResponse[]>>(
    API_ENDPOINTS.adminConnectedApps.list,
  );
  return response.data.data;
}

export async function getAdminConnectedApp(id: string): Promise<ConnectedAppAdminResponse> {
  const response = await apiClient.get<ApiResponse<ConnectedAppAdminResponse>>(
    API_ENDPOINTS.adminConnectedApps.byId(id),
  );
  return response.data.data;
}

export async function createConnectedAppDefinition(
  data: CreateConnectedAppDefinition,
): Promise<ConnectedAppAdminResponse> {
  const response = await apiClient.post<ApiResponse<ConnectedAppAdminResponse>>(
    API_ENDPOINTS.adminConnectedApps.list,
    data,
  );
  return response.data.data;
}

export async function updateConnectedAppDefinition(
  id: string,
  data: UpdateConnectedAppDefinition,
): Promise<ConnectedAppAdminResponse> {
  const response = await apiClient.patch<ApiResponse<ConnectedAppAdminResponse>>(
    API_ENDPOINTS.adminConnectedApps.byId(id),
    data,
  );
  return response.data.data;
}

export async function deleteConnectedAppDefinition(
  id: string,
): Promise<{ message: string; deletedConnections: number }> {
  const response = await apiClient.delete<
    ApiResponse<{ message: string; deletedConnections: number }>
  >(API_ENDPOINTS.adminConnectedApps.byId(id));
  return response.data.data;
}
