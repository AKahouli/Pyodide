import { apiClient, type ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type {
  ConnectedAppWithStatus,
  UserConnectionInfo,
  ConnectedAppAdminResponse,
  CreateConnectedAppDefinition,
  UpdateConnectedAppDefinition,
  MailboxCapability,
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

export async function getMailboxCapability(): Promise<MailboxCapability> {
  const response = await apiClient.get<ApiResponse<MailboxCapability>>(
    API_ENDPOINTS.connectedApps.mailboxCapability,
  );
  return response.data.data;
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

export async function getOAuthPresets(): Promise<
  Array<{
    key: string;
    displayName: string;
    appKey: string;
    authorizationUrl: string;
    tokenUrl: string;
    revokeUrl?: string;
    scopes: string[];
    pkceEnabled: boolean;
    iconKey: string;
  }>
> {
  const response = await apiClient.get<ApiResponse<any[]>>('/admin/connected-apps/presets');
  return response.data.data;
}

export async function validateAppKey(
  appKey: string,
): Promise<{ valid: boolean; exists: boolean; suggestion?: string }> {
  const response = await apiClient.get<ApiResponse<{ valid: boolean; exists: boolean; suggestion?: string }>>(
    '/admin/connected-apps/validate-appkey',
    { params: { appKey } }
  );
  return response.data.data;
}

export async function suggestAppKey(displayName: string): Promise<{ appKey: string }> {
  const response = await apiClient.get<ApiResponse<{ appKey: string }>>(
    '/admin/connected-apps/suggest-appkey',
    { params: { displayName } }
  );
  return response.data.data;
}

export async function generateCallbackUrl(appKey: string, backendUrl?: string): Promise<{ callbackUrl: string }> {
  const response = await apiClient.get<ApiResponse<{ callbackUrl: string }>>(
    '/admin/connected-apps/callback-url',
    { params: { appKey, backendUrl } }
  );
  return response.data.data;
}
