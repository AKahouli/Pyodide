import { apiClient, ApiResponse } from '@/lib/api';
import type { AgentEvent, ListSessionsResponse } from './types';

export interface ListSessionsParams { limit?: number; cursor?: string | null; q?: string }

export interface SessionPointer {
  sessionId: string;
  title: string;
  status: string;
  isShared: boolean;
  workspaceIds: string[];
  selectedSkillIds: string[];
  lastEventAt: string;
  eventCount: number;
  systemWorkspaceId: string | null;
}

export interface PersistedEventEnvelope {
  sessionId: string;
  sequence: number;
  eventId: string;
  type: AgentEvent['type'];
  emittedAt: number;
  payload: Record<string, unknown>;
  modelId?: string | null;
}

function envelopeToAgentEvent(env: PersistedEventEnvelope): AgentEvent {
  // Re-flatten the persisted envelope into the on-the-wire AgentEvent shape
  // the rest of the frontend consumes (type at the top, event_id/timestamp
  // and the payload's own fields all merged onto the object).
  return {
    type: env.type,
    event_id: env.eventId,
    timestamp: env.emittedAt,
    sequence: env.sequence,
    ...(env.payload as Record<string, unknown>),
    ...(env.modelId !== undefined ? { modelId: env.modelId } : {}),
  } as AgentEvent;
}

export interface CreateSessionResponse {
  sessionId: string;
  workspaceIds: string[];
}

export const conversationV2Api = {
  async createSession(workspaceIds: string[] = []): Promise<CreateSessionResponse> {
    const res = await apiClient.post<ApiResponse<CreateSessionResponse>>(
      '/conversation-v2/sessions',
      { workspaceIds },
    );
    return res.data.data;
  },
  async getSession(sessionId: string): Promise<SessionPointer> {
    const res = await apiClient.get<ApiResponse<SessionPointer>>(
      `/conversation-v2/sessions/${sessionId}`,
    );
    return res.data.data;
  },
  async listEvents(
    sessionId: string,
    since: number,
    limit = 200,
  ): Promise<{ items: AgentEvent[]; nextSince: number }> {
    const res = await apiClient.get<ApiResponse<{
      items: PersistedEventEnvelope[];
      nextSince: number;
    }>>(`/conversation-v2/sessions/${sessionId}/events`, {
      params: { since, limit },
    });
    return {
      items: res.data.data.items.map(envelopeToAgentEvent),
      nextSince: res.data.data.nextSince,
    };
  },
  /**
   * Send a message and kick off the AI response. Returns immediately — the
   * resulting events arrive on the persistent per-user SSE pipe
   * (`/conversation-v2/stream`), not this request. Replaces the old
   * EventSource-per-message flow.
   */
  async sendMessage(
    sessionId: string,
    body: {
      message: string;
      model?: string;
      clientEventId?: string;
      connectorId?: string;
      connectorName?: string;
      connectorRepoId?: string;
      connectorRepoName?: string;
      connectorRepoUrl?: string;
      skillIds?: string[];
      connectorIds?: string[];
    },
  ): Promise<void> {
    await apiClient.post(`/conversation-v2/sessions/${sessionId}/message`, body);
  },
  async stopSession(sessionId: string): Promise<void> {
    await apiClient.post(`/conversation-v2/sessions/${sessionId}/stop`, {});
  },
  async pauseSession(sessionId: string): Promise<void> {
    await apiClient.post(`/conversation-v2/sessions/${sessionId}/pause`, {});
  },
  async resumeSession(sessionId: string): Promise<void> {
    await apiClient.post(`/conversation-v2/sessions/${sessionId}/resume`, {});
  },
  async listSessions(params: ListSessionsParams = {}): Promise<ListSessionsResponse> {
    const res = await apiClient.get<ApiResponse<ListSessionsResponse>>(
      '/conversation-v2/sessions',
      { params: { limit: params.limit ?? 20, cursor: params.cursor ?? undefined, q: params.q || undefined } },
    );
    return res.data.data;
  },
  async patchSession(
    sessionId: string,
    body: { title?: string; isShared?: boolean },
  ): Promise<{ title?: string; isShared?: boolean; shareToken?: string | null }> {
    const res = await apiClient.patch<ApiResponse<{ title?: string; isShared?: boolean; shareToken?: string | null }>>(
      `/conversation-v2/sessions/${sessionId}`,
      body,
    );
    return res.data.data;
  },
  async deleteSession(sessionId: string): Promise<void> {
    await apiClient.delete(`/conversation-v2/sessions/${sessionId}`);
  },
  async listWorkspaceDocuments(
    sessionId: string,
    params: { page?: number; limit?: number } = {},
  ): Promise<{
    documents: Array<Record<string, unknown>>;
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const res = await apiClient.get<ApiResponse<{
      documents: Array<Record<string, unknown>>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>>(`/conversation-v2/sessions/${sessionId}/workspace-documents`, {
      params: { page: params.page ?? 1, limit: params.limit ?? 10 },
    });
    return res.data.data;
  },
  async getShared(token: string): Promise<{ session: SessionPointer; events: AgentEvent[] }> {
    const res = await apiClient.get<ApiResponse<{
      session: SessionPointer;
      events: PersistedEventEnvelope[];
    }>>(`/conversation-v2/share/v2/${token}`);
    return {
      session: res.data.data.session,
      events: res.data.data.events.map(envelopeToAgentEvent),
    };
  },
  async getVncSignedUrl(sessionId: string): Promise<{ url: string; expiresAt: number }> {
    const res = await apiClient.get<ApiResponse<{ url: string; expiresAt: number }>>(
      `/conversation-v2/sessions/${sessionId}/vnc/signed-url`,
    );
    return res.data.data;
  },
  /**
   * Exchange a message-attachment Ceph object key for a short-lived presigned
   * read URL. Backend access-checks the path's owning workspace before signing.
   *
   * Some artifacts (e.g. ones whose content is a URL) carry no Ceph object key,
   * or already carry a directly-openable URL instead of a key. We must never
   * POST those to the signing endpoint: an empty/undefined path serializes to an
   * empty body, and the DTO's `@MaxLength(4096)` then rejects the non-string
   * value with a misleading "path must be shorter than 4096" 400 (class-validator
   * returns false for any non-string). An already-absolute URL needs no signing.
   */
  async getFileSignedUrl(path: string): Promise<{ url: string }> {
    const trimmed = path?.trim();
    if (!trimmed) {
      throw new Error('This artifact has no file path to open.');
    }
    // http(s)/blob/data URLs are already resolvable — return them as-is.
    if (/^(https?:|blob:|data:)/i.test(trimmed)) {
      return { url: trimmed };
    }
    const res = await apiClient.post<ApiResponse<{ url: string }>>(
      '/conversation-v2/files/signed-url',
      { path: trimmed },
    );
    return res.data.data;
  },
};
