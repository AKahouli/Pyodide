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

export interface GetAgentMemoriesParams {
  /** 1-based page number. */
  page?: number;
  /** Rows per page (10, 20, 30 or 50). */
  pageSize?: number;
  /** Free-text search across every field except id. */
  search?: string;
}

export interface AgentMemoriesPage {
  memories: MemoryCard[];
  total: number;
}

export async function getAgentMemories(
  agentId: string,
  params: GetAgentMemoriesParams = {},
): Promise<AgentMemoriesPage> {
  const { page, pageSize, search } = params;
  const query: Record<string, string | number> = { agentId };
  if (page) query.page = page;
  if (pageSize) query.pageSize = pageSize;
  if (search) query.search = search;

  const response = await apiClient.get<ApiResponse<AgentMemoriesPage>>(
    API_ENDPOINTS.memoryCards.base,
    { params: query },
  );
  return response.data.data;
}

export async function deleteAgentMemories(agentId: string, ids: string[]): Promise<number> {
  const response = await apiClient.delete<ApiResponse<{ deleted: number }>>(
    API_ENDPOINTS.memoryCards.base,
    { params: { agentId }, data: { ids } },
  );
  return response.data.data.deleted;
}
