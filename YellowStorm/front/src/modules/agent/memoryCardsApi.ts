import apiClient, { type ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';

export interface MemoryCard {
  id: string;
  title: string;
  summary: string;
  content: string;
  type: string;
  keywords: string[];
  valid_from: string | null;
  valid_until: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export async function getAgentMemories(agentId: string): Promise<MemoryCard[]> {
  const response = await apiClient.get<ApiResponse<{ memories: MemoryCard[]; total: number }>>(
    API_ENDPOINTS.memoryCards.base,
    { params: { agentId } },
  );
  return response.data.data.memories;
}

export async function deleteAgentMemories(agentId: string, ids: string[]): Promise<number> {
  const response = await apiClient.delete<ApiResponse<{ deleted: number }>>(
    API_ENDPOINTS.memoryCards.base,
    { params: { agentId }, data: { ids } },
  );
  return response.data.data.deleted;
}
