/**
 * Agent API Functions (User-facing)
 */

import apiClient, { type ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type {
  Agent,
  AgentType,
  AgentTelegramIntegration,
  AgentTelegramIntegrationInput,
  CreateAgentData,
  UpdateAgentData,
  SkillOption,
} from './types';

export async function getAllAgents(): Promise<Agent[]> {
  const response = await apiClient.get<ApiResponse<Agent[]>>(
    API_ENDPOINTS.agents.all
  );
  return response.data.data;
}

export async function getAgentTypes(): Promise<AgentType[]> {
  const response = await apiClient.get<ApiResponse<AgentType[]>>(
    API_ENDPOINTS.agentTypes.active
  );
  return response.data.data;
}

export async function createAgent(data: CreateAgentData): Promise<Agent> {
  const response = await apiClient.post<ApiResponse<Agent>>(
    API_ENDPOINTS.agents.list,
    data
  );
  return response.data.data;
}

export async function updateAgent(id: string, data: UpdateAgentData): Promise<Agent> {
  const response = await apiClient.patch<ApiResponse<Agent>>(
    API_ENDPOINTS.agents.byId(id),
    data
  );
  return response.data.data;
}

export async function deleteAgent(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.agents.byId(id));
}

export interface ToolOption {
  id: string;
  name: string;
  description: string;
  defaultAgentTypes: string[];
}

export async function getActiveTools(): Promise<ToolOption[]> {
  const response = await apiClient.get<ApiResponse<ToolOption[]>>(
    API_ENDPOINTS.tools.active
  );
  return response.data.data;
}



export async function getActiveSkills(): Promise<SkillOption[]> {
  const response = await apiClient.get<ApiResponse<SkillOption[]>>(
    API_ENDPOINTS.skills.active
  );
  return response.data.data;
}

export interface ConnectorOption {
  id: string;
  name: string;
  description: string;
  connectedAppKey: string;
}

export async function getActiveConnectors(): Promise<ConnectorOption[]> {
  const response = await apiClient.get<ApiResponse<ConnectorOption[]>>(
    API_ENDPOINTS.connectors.list
  );
  return response.data.data;
}

export async function getAgentTelegramIntegration(
  agentId: string,
): Promise<AgentTelegramIntegration | null> {
  const response = await apiClient.get<ApiResponse<AgentTelegramIntegration | null>>(
    API_ENDPOINTS.agents.telegramIntegration(agentId),
  );
  return response.data.data;
}

export async function upsertAgentTelegramIntegration(
  agentId: string,
  payload: AgentTelegramIntegrationInput,
): Promise<AgentTelegramIntegration> {
  const response = await apiClient.put<ApiResponse<AgentTelegramIntegration>>(
    API_ENDPOINTS.agents.telegramIntegration(agentId),
    payload,
  );
  return response.data.data;
}

export async function deleteAgentTelegramIntegration(agentId: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.agents.telegramIntegration(agentId));
}

export interface WidgetTokenResponse {
  id: string;
  token: string;
  agentId: string;
}

export async function createWidgetToken(agentId: string): Promise<WidgetTokenResponse> {
  const response = await apiClient.post<ApiResponse<WidgetTokenResponse>>(
    API_ENDPOINTS.widgetTokens.create(agentId),
  );
  return response.data.data;
}


// Re-export evaluation API functions
export * from './evaluation-api';