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
  AgentWhatsAppEnabledInput,
  AgentWhatsAppIntegration,
  AgentWhatsAppPairingResponse,
  CreateAgentData,
  UpdateAgentData,
  SkillOption,
  ConnectorActionOption,
  A2APublishResult,
  A2ARotateKeyResult,
  A2ARevokeResult,
  WidgetTokenResponse,
  ShareAgentData,
  AgentShareEntry,
  AgentPermissionLevel,
  UserSearchResult,
} from './types';

type AgentDataInput<T> = T & { reasoningEffort?: string };

function serializeAgentData<T extends CreateAgentData | UpdateAgentData>(data: AgentDataInput<T>): T {
  const { reasoningEffort, ...payload } = data;
  return {
    ...payload,
    ...(reasoningEffort !== undefined ? { reasoning_effort: reasoningEffort } : {}),
  } as T;
}

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

export async function createAgent(data: AgentDataInput<CreateAgentData>): Promise<Agent> {
  const response = await apiClient.post<ApiResponse<Agent>>(
    API_ENDPOINTS.agents.list,
    serializeAgentData(data)
  );
  return response.data.data;
}

export async function updateAgent(id: string, data: AgentDataInput<UpdateAgentData>): Promise<Agent> {
  const response = await apiClient.patch<ApiResponse<Agent>>(
    API_ENDPOINTS.agents.byId(id),
    serializeAgentData(data)
  );
  return response.data.data;
}

export async function deleteAgent(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.agents.byId(id));
}

/**
 * Update a default (admin-created) agent.
 *
 * The user-facing `PATCH /agents/:id` rejects default agents with
 * CUSTOM_AGENT_DEFAULT_READONLY, so admins holding `agents.update` go through
 * the admin endpoint instead. Permission enforcement stays on the backend.
 */
export async function updateDefaultAgent(id: string, data: AgentDataInput<UpdateAgentData>): Promise<Agent> {
  const response = await apiClient.patch<ApiResponse<Agent>>(
    API_ENDPOINTS.adminAgents.byId(id),
    serializeAgentData(data)
  );
  return response.data.data;
}

/**
 * Delete a default (admin-created) agent via the admin endpoint.
 * Requires the caller to hold `agents.delete` (enforced server-side).
 */
export async function deleteDefaultAgent(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.adminAgents.byId(id));
}

// ===== Agent sharing =====

/** Share an agent with one or more users by email, at one permission level. */
export async function shareAgent(agentId: string, data: ShareAgentData): Promise<AgentShareEntry[]> {
  const response = await apiClient.post<ApiResponse<AgentShareEntry[]>>(
    API_ENDPOINTS.agents.shares(agentId),
    data,
  );
  return response.data.data;
}

/** List everyone an agent is shared with (owner only). */
export async function getAgentShares(agentId: string): Promise<AgentShareEntry[]> {
  const response = await apiClient.get<ApiResponse<AgentShareEntry[]>>(
    API_ENDPOINTS.agents.shares(agentId),
  );
  return response.data.data;
}

/** Change a share's permission level (owner only). */
export async function updateAgentSharePermission(
  agentId: string,
  shareId: string,
  permission: AgentPermissionLevel,
): Promise<AgentShareEntry> {
  const response = await apiClient.patch<ApiResponse<AgentShareEntry>>(
    API_ENDPOINTS.agents.shareById(agentId, shareId),
    { permission },
  );
  return response.data.data;
}

/** Revoke a share (owner only). */
export async function removeAgentShare(agentId: string, shareId: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.agents.shareById(agentId, shareId));
}

/** Remove an agent that was shared with the current user from their own list. */
export async function unshareAgent(agentId: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.agents.unshare(agentId));
}

/** Autocomplete search for users to share an agent with. */
export async function searchUsers(query: string, limit = 10): Promise<UserSearchResult[]> {
  const response = await apiClient.get<ApiResponse<UserSearchResult[]>>(
    API_ENDPOINTS.users.search,
    { params: { q: query, limit } },
  );
  return response.data.data;
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

export async function updateAgentWhatsAppEnabled(
  agentId: string,
  payload: AgentWhatsAppEnabledInput,
): Promise<AgentWhatsAppIntegration> {
  const response = await apiClient.patch<ApiResponse<AgentWhatsAppIntegration>>(
    API_ENDPOINTS.agents.whatsappEnabled(agentId),
    payload,
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

export async function notifyAgentWhatsAppAutoRecover(
  agentId: string,
): Promise<AgentWhatsAppIntegration> {
  const response = await apiClient.post<ApiResponse<AgentWhatsAppIntegration>>(
    API_ENDPOINTS.agents.whatsappAutoRecover(agentId),
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

export async function createWidgetToken(agentId: string): Promise<WidgetTokenResponse> {
  const response = await apiClient.post<ApiResponse<WidgetTokenResponse>>(
    API_ENDPOINTS.widgetTokens.create(agentId),
  );
  return response.data.data;
}

/** Default (admin-owned) agents are read-only on the user widget-token endpoint; use the admin one instead. */
export async function createAdminWidgetToken(agentId: string): Promise<WidgetTokenResponse> {
  const response = await apiClient.post<ApiResponse<WidgetTokenResponse>>(
    API_ENDPOINTS.adminWidgetTokens.create(agentId),
  );
  return response.data.data;
}

// Re-export evaluation API functions
export * from './evaluation-api';
