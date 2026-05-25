import { apiClient, ApiResponse } from '@/lib/api';
import type { SessionPayload, AgentEvent, ListSessionsResponse } from './types';

export interface ListSessionsParams { limit?: number; cursor?: string | null; q?: string }

/**
 * The backend returns persisted events as `{ type, payload: {...} }` envelopes;
 * the SSE stream and the rest of the frontend use a flat `{ type, ...payload }`
 * shape. Normalise on read so consumers see one shape.
 */
function flattenEvent(raw: unknown): AgentEvent {
  if (raw && typeof raw === 'object' && 'type' in raw && 'payload' in raw) {
    const r = raw as { type: string; payload: Record<string, unknown> };
    return { type: r.type, ...r.payload } as AgentEvent;
  }
  return raw as AgentEvent;
}

interface RawSession {
  sessionId: string;
  title: string;
  status: string;
  isShared: boolean;
  events: unknown[];
}

function normaliseSession(raw: RawSession): SessionPayload {
  return { ...raw, events: (raw.events ?? []).map(flattenEvent) };
}

export const conversationV2Api = {
  async createSession(): Promise<{ sessionId: string }> {
    const res = await apiClient.post<ApiResponse<{ sessionId: string }>>('/conversation-v2/sessions', {});
    return res.data.data;
  },
  async getSession(sessionId: string): Promise<SessionPayload> {
    const res = await apiClient.get<ApiResponse<RawSession>>(
      `/conversation-v2/sessions/${sessionId}`,
    );
    return normaliseSession(res.data.data);
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
  async getShared(token: string): Promise<SessionPayload> {
    const res = await apiClient.get<ApiResponse<RawSession>>(`/conversation-v2/share/v2/${token}`);
    return normaliseSession(res.data.data);
  },
  async getVncSignedUrl(sessionId: string): Promise<{ url: string; expiresAt: number }> {
    const res = await apiClient.get<ApiResponse<{ url: string; expiresAt: number }>>(
      `/conversation-v2/sessions/${sessionId}/vnc/signed-url`,
    );
    return res.data.data;
  },
};

export { flattenEvent };
