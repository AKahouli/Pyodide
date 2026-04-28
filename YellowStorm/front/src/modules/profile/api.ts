/**
 * Profile API Functions
 */

import { apiClient, API_ENDPOINTS, ApiResponse } from '@/lib/api';
import type { Session, UpdateProfileData, HealthCheckResult, HealthHistoryResponse, HealthHistoryStats } from './types';
import type { User } from '@/modules/auth';

/**
 * Update user profile
 */
export async function updateProfile(data: UpdateProfileData): Promise<User> {
  const response = await apiClient.put<ApiResponse<User>>(
    API_ENDPOINTS.users.me,
    data
  );
  return response.data.data;
}

/**
 * Update user appearance preferences
 */
export async function updateAppearance(colorTheme: 'default' | 'yellow' | 'orange' | 'blue'): Promise<User> {
  const response = await apiClient.put<ApiResponse<User>>(API_ENDPOINTS.users.me, {
    appearance: { colorTheme },
  });
  return response.data.data;
}

/**
 * Get active sessions
 */
export async function getSessions(): Promise<Session[]> {
  const response = await apiClient.get<ApiResponse<Session[]>>(
    API_ENDPOINTS.auth.sessions
  );
  return response.data.data;
}

/**
 * Revoke a session
 */
export async function revokeSession(sessionId: string): Promise<void> {
  await apiClient.delete(`${API_ENDPOINTS.auth.sessions}/${sessionId}`);
}

/**
 * Update data sharing preference
 */
export async function updateDataSharing(enabled: boolean): Promise<void> {
  await apiClient.put(API_ENDPOINTS.users.me, {
    dataSharing: enabled,
  });
}

/**
 * Export user data
 */
export async function exportData(): Promise<Blob> {
  const response = await apiClient.get(`${API_ENDPOINTS.users.me}/export`, {
    responseType: 'blob',
  });
  return response.data;
}

/**
 * Delete user account
 */
export async function deleteAccount(): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.users.me);
}

/**
 * Get system health status
 * Note: Returns data even on 503 (unhealthy) status
 */
export async function getHealthStatus(): Promise<HealthCheckResult> {
  const response = await apiClient.get<ApiResponse<HealthCheckResult>>(
    API_ENDPOINTS.health.check,
    {
      // Accept 200 (healthy) and 503 (unhealthy) as valid responses
      validateStatus: (status) => status === 200 || status === 503,
    }
  );
  return response.data.data;
}

/**
 * Get health history
 */
export async function getHealthHistory(params?: {
  minutes?: number;
  status?: 'healthy' | 'unhealthy' | 'degraded';
  limit?: number;
  skip?: number;
}): Promise<HealthHistoryResponse> {
  const response = await apiClient.get<ApiResponse<HealthHistoryResponse>>(
    API_ENDPOINTS.health.history,
    { params }
  );
  return response.data.data;
}

/**
 * Get health stats
 */
export async function getHealthStats(minutes?: number): Promise<HealthHistoryStats> {
  const response = await apiClient.get<ApiResponse<HealthHistoryStats>>(
    API_ENDPOINTS.health.stats,
    { params: minutes ? { minutes } : undefined }
  );
  return response.data.data;
}
