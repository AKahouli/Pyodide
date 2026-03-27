/**
 * Usage API Functions
 */

import { apiClient, API_ENDPOINTS, ApiResponse } from '@/lib/api';
import type {
  UsageStatus,
  Plan,
  UsageHistoryResponse,
  UsageHistoryParams,
} from './types';

/**
 * Get current usage status
 */
export async function getUsageStatus(): Promise<UsageStatus> {
  const response = await apiClient.get<ApiResponse<UsageStatus>>(
    API_ENDPOINTS.usage.status
  );
  return response.data.data;
}

/**
 * Get user's current plan
 */
export async function getCurrentPlan(): Promise<Plan> {
  const response = await apiClient.get<ApiResponse<Plan>>(
    API_ENDPOINTS.usage.plan
  );
  return response.data.data;
}

/**
 * Get all available plans
 */
export async function getPlans(): Promise<Plan[]> {
  const response = await apiClient.get<ApiResponse<Plan[]>>(
    API_ENDPOINTS.usage.plans
  );
  return response.data.data;
}

/**
 * Get usage history
 */
export async function getUsageHistory(
  params?: UsageHistoryParams
): Promise<UsageHistoryResponse> {
  const response = await apiClient.get<ApiResponse<UsageHistoryResponse>>(
    API_ENDPOINTS.usage.history,
    { params }
  );
  return response.data.data;
}
