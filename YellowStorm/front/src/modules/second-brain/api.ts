import apiClient, { type ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type { SecondBrainPageContext, SecondBrainTurnResponse } from './types';

const SECOND_BRAIN_TIMEOUT_MS = 5 * 60 * 1000;

export async function runSecondBrainTurn(input: {
  message: string;
  conversationId?: string;
  pageContext: SecondBrainPageContext;
}): Promise<SecondBrainTurnResponse> {
  const response = await apiClient.post<ApiResponse<SecondBrainTurnResponse>>(
    API_ENDPOINTS.secondBrain.turns,
    input,
    { timeout: SECOND_BRAIN_TIMEOUT_MS },
  );
  return response.data.data;
}

export async function confirmSecondBrainAction(confirmationId: string): Promise<SecondBrainTurnResponse> {
  const response = await apiClient.post<ApiResponse<SecondBrainTurnResponse>>(
    API_ENDPOINTS.secondBrain.confirm(confirmationId),
    undefined,
    { timeout: SECOND_BRAIN_TIMEOUT_MS },
  );
  return response.data.data;
}

export async function rejectSecondBrainAction(confirmationId: string): Promise<{ rejected: true }> {
  const response = await apiClient.post<ApiResponse<{ rejected: true }>>(API_ENDPOINTS.secondBrain.reject(confirmationId));
  return response.data.data;
}
