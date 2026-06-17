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
  AgentWhatsAppConnectResponse,
  AgentWhatsAppIntegration,
  AgentWhatsAppPairingResponse,
  CreateAgentData,
  UpdateAgentData,
  SkillOption,
  ConnectorActionOption,
  A2APublishResult,
  A2ARotateKeyResult,
  A2ARevokeResult,
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

/**
 * Publish an agent over the A2A protocol. Returns the message endpoint, agent
 * card URL, and the API key — the key is only returned once.
 */
export async function publishAgentToA2A(id: string): Promise<A2APublishResult> {
  const response = await apiClient.post<ApiResponse<A2APublishResult>>(
    API_ENDPOINTS.agents.a2aPublish(id),
  );
  return response.data.data;
}

/**
 * Rotate the A2A API key for an already-published agent. Returns the new key once.
 */
export async function rotateAgentA2AKey(id: string): Promise<A2ARotateKeyResult> {
  const response = await apiClient.post<ApiResponse<A2ARotateKeyResult>>(
    API_ENDPOINTS.agents.a2aRotateKey(id),
  );
  return response.data.data;
}

/**
 * Revoke a published A2A agent. Its card and message endpoint stop serving and
 * the agent returns to the unpublished state.
 */
export async function revokeAgentA2A(id: string): Promise<A2ARevokeResult> {
  const response = await apiClient.post<ApiResponse<A2ARevokeResult>>(
    API_ENDPOINTS.agents.a2aRevoke(id),
  );
  return response.data.data;
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
  /** Presentation + auth metadata returned by GET /connectors (optional for backward compat). */
  slug?: string;
  icon?: string;
  color?: string;
  iconColor?: 'light' | 'dark';
  authType?: string;
  authSourceType?: string;
  categoryId?: string | null;
  /** Resolved category name; used to exclude "System" connectors. */
  categoryName?: string | null;
  actions?: ConnectorActionOption[];
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

export async function getAgentWhatsAppIntegration(
  agentId: string,
): Promise<AgentWhatsAppIntegration | null> {
  const response = await apiClient.get<ApiResponse<AgentWhatsAppIntegration | null>>(
    API_ENDPOINTS.agents.whatsappIntegration(agentId),
  );
  return response.data.data;
}

export async function connectAgentWhatsApp(
  agentId: string,
): Promise<AgentWhatsAppConnectResponse> {
  const response = await apiClient.post<ApiResponse<AgentWhatsAppConnectResponse>>(
    API_ENDPOINTS.agents.whatsappConnect(agentId),
  );
  return response.data.data;
}

export async function getAgentWhatsAppPairing(
  agentId: string,
  sessionId: string,
): Promise<AgentWhatsAppPairingResponse> {
  const response = await apiClient.get<ApiResponse<AgentWhatsAppPairingResponse>>(
    API_ENDPOINTS.agents.whatsappPairing(agentId, sessionId),
  );
  return response.data.data;
}

export async function reconnectAgentWhatsApp(
  agentId: string,
  sessionId: string,
): Promise<AgentWhatsAppIntegration> {
  const response = await apiClient.post<ApiResponse<AgentWhatsAppIntegration>>(
    API_ENDPOINTS.agents.whatsappReconnect(agentId, sessionId),
  );
  return response.data.data;
}

export async function disconnectAgentWhatsAppSession(
  agentId: string,
  sessionId: string,
): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.agents.whatsappSession(agentId, sessionId));
}

export async function deleteAgentWhatsAppIntegration(agentId: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.agents.whatsappIntegration(agentId));
}


// Re-export evaluation API functions
export * from './evaluation-api';
