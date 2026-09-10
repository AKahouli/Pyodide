import { apiClient, ApiResponse } from '@/lib/api';
import type {
  AgentEvent,
  ListSessionsResponse,
  UserSearchResult,
  PersistedEventEnvelope,
} from './interfaces';
import type {
  ListSessionsParams,
  DeployStatus,
  DeployState,
  CreateSessionResponse,
  SessionPointer,
} from './interfaces';
import type { RuntimeTicketResponse } from './runtime/runtime.types';

export interface AppDataOwnerStatus {
  enabled: boolean;
  appDataId: string | null;
  workspaceId: string;
  lifecycleState: string | null;
  endUserAuthEnabled?: boolean;
  dev: { provisioned: boolean; schemaName: string | null; currentVersion: number | null };
  prod: { provisioned: boolean; schemaName: string | null; currentVersion: number | null };
}

export interface SeedResult {
  total: number;
  inserted: number;
  skipped: number;
  tables: { table: string; inserted: number; skipped: number }[];
}

export type {
  ListSessionsParams,
  DeployStatus,
  DeployState,
  CreateSessionResponse,
  SessionPointer,
  PersistedEventEnvelope,
};

function envelopeToAgentEvent(env: PersistedEventEnvelope): AgentEvent {
  return {
    type: env.type,
    event_id: env.eventId,
    timestamp: env.emittedAt,
    sequence: env.sequence,
    ...(env.payload as Record<string, unknown>),
    ...(env.modelId !== undefined ? { modelId: env.modelId } : {}),
  } as AgentEvent;
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
      /**
       * Finalized revision the turn must build from (e.g. "rev_2") — sent when
       * the user is previewing a historical version instead of the latest.
       * The backend branches a fresh revision from it before running the agent.
       */
      baseRevisionId?: string;
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
  async getFinalizedVersions(sessionId: string): Promise<{
    items: Array<{
      revisionId: string;
      title: string;
      finalizedAt: string;
      fileCount?: number;
    }>;
    latestRevisionId: string | null;
  }> {
    const res = await apiClient.get<
      ApiResponse<{
        items: Array<{
          revisionId: string;
          title: string;
          finalizedAt: string;
          fileCount?: number;
        }>;
        latestRevisionId: string | null;
      }>
    >(`/conversation-v2/sessions/${sessionId}/finalized-versions`);
    return res.data.data;
  },
  async deleteSession(sessionId: string): Promise<void> {
    await apiClient.delete(`/conversation-v2/sessions/${sessionId}`);
  },
  async deploySession(
    sessionId: string,
    options?: { title?: string; revisionId?: string },
  ): Promise<DeployState> {
    const res = await apiClient.post<ApiResponse<DeployState>>(
      `/conversation-v2/sessions/${sessionId}/deploy`,
      {
        title: options?.title || undefined,
        revisionId: options?.revisionId || undefined,
      },
      { timeout: 630_000 },
    );
    return res.data.data;
  },
  async searchUsers(query: string, limit = 8): Promise<UserSearchResult[]> {
    const res = await apiClient.get<ApiResponse<UserSearchResult[]>>('/users/search', {
      params: { q: query, limit },
    });
    return res.data.data;
  },
  async shareDeployedApp(
    sessionId: string,
    emails: string[],
  ): Promise<{ sent: number; notFound: string[]; skippedSelf: string[] }> {
    const res = await apiClient.post<
      ApiResponse<{ sent: number; notFound: string[]; skippedSelf: string[] }>
    >(`/conversation-v2/sessions/${sessionId}/share-deploy`, { emails });
    return res.data.data;
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
  async getFileSignedUrl(path: string): Promise<{ url: string }> {
    const trimmed = path?.trim();
    if (!trimmed) {
      throw new Error('This artifact has no file path to open.');
    }
    if (/^(https?:|blob:|data:)/i.test(trimmed)) {
      return { url: trimmed };
    }
    const res = await apiClient.post<ApiResponse<{ url: string }>>(
      '/conversation-v2/files/signed-url',
      { path: trimmed },
    );
    return res.data.data;
  },
  async getAppSourceUrls(
    sessionId: string,
    cephPath: string,
    paths: string[],
  ): Promise<{ items: Array<{ path: string; url: string }> }> {
    console.log('[Nodepod] [api:getAppSourceUrls:request]', {
      sessionId,
      cephPath,
      pathCount: paths.length,
      samplePaths: paths.slice(0, 5),
    });
    try {
      const res = await apiClient.post<
        ApiResponse<{ items: Array<{ path: string; url: string }> }>
      >(`/conversation-v2/sessions/${sessionId}/app-source/urls`, { cephPath, paths });
      console.log('[Nodepod] [api:getAppSourceUrls:response]', {
        itemCount: res.data.data?.items?.length ?? 0,
      });
      return res.data.data;
    } catch (err) {
      console.error('[Nodepod] [api:getAppSourceUrls:error]', err);
      throw err;
    }
  },
  /** List files for an authorized App Builder revision (starter or workspace). */
  async getRevisionFiles(
    sessionId: string,
    revisionId: string,
  ): Promise<{
    revisionId: string;
    files: Array<{ path: string; sha256: string; size: number }>;
  }> {
    const res = await apiClient.get<
      ApiResponse<{
        revisionId: string;
        files: Array<{ path: string; sha256: string; size: number }>;
      }>
    >(`/conversation-v2/sessions/${sessionId}/revisions/${encodeURIComponent(revisionId)}/files`);
    return res.data.data;
  },
  /** Presign blob reads for paths listed in an authorized revision manifest. */
  async presignRevisionFiles(
    sessionId: string,
    revisionId: string,
    paths: string[],
  ): Promise<{ items: Array<{ path: string; url: string }> }> {
    const res = await apiClient.post<
      ApiResponse<{ items: Array<{ path: string; url: string }> }>
    >(`/conversation-v2/sessions/${sessionId}/revisions/${encodeURIComponent(revisionId)}/presign`, {
      paths,
    });
    return res.data.data;
  },
  /** Persist a workspace revision snapshot to Ceph after a browser mutation. */
  async commitWorkspaceRevision(
    sessionId: string,
    body: {
      revisionId: string;
      parentRevisionId: string | null;
      files: Array<{ path: string; content: string }>;
      toolCallId?: string | null;
    },
  ): Promise<{
    revisionId: string;
    parentRevisionId: string | null;
    manifestObjectKey: string;
    fileCount: number;
  }> {
    const res = await apiClient.post<
      ApiResponse<{
        revisionId: string;
        parentRevisionId: string | null;
        manifestObjectKey: string;
        fileCount: number;
      }>
    >(`/conversation-v2/sessions/${sessionId}/revisions/commit`, body);
    return res.data.data;
  },
  async createRuntimeTicket(sessionId: string): Promise<RuntimeTicketResponse> {
    const res = await apiClient.post<ApiResponse<RuntimeTicketResponse>>(
      `/conversation-v2/sessions/${sessionId}/runtime-ticket`,
    );
    return res.data.data;
  },
  async getAppDataStatus(sessionId: string): Promise<AppDataOwnerStatus> {
    const res = await apiClient.get<ApiResponse<AppDataOwnerStatus>>(
      `/conversation-v2/sessions/${sessionId}/app-data/status`,
    );
    return res.data.data;
  },
  /** Owner-scoped App Data data ticket for the dev preview relay. */
  async getAppDataTicket(
    sessionId: string,
  ): Promise<{ ticket: string; appDataId: string; publicUrl: string | null }> {
    const res = await apiClient.get<ApiResponse<{ ticket: string; appDataId: string; publicUrl: string | null }>>(
      `/conversation-v2/sessions/${sessionId}/app-data/ticket`,
    );
    return res.data.data;
  },
  async getAppDataTables(sessionId: string, environment: 'dev' | 'prod'): Promise<{ tables: string[] }> {
    const res = await apiClient.get<ApiResponse<{ tables: string[]; environment: string; currentVersion: number }>>(
      `/conversation-v2/sessions/${sessionId}/app-data/${environment}/tables`,
    );
    return res.data.data;
  },
  async getAppDataRows(
    sessionId: string,
    environment: 'dev' | 'prod',
    table: string,
    page = 1,
  ): Promise<{ rows: Record<string, unknown>[]; total: number; page: number; pageSize: number }> {
    const res = await apiClient.get<
      ApiResponse<{ rows: Record<string, unknown>[]; total: number; page: number; pageSize: number }>
    >(`/conversation-v2/sessions/${sessionId}/app-data/${environment}/tables/${encodeURIComponent(table)}/rows`, {
      params: { page },
    });
    return res.data.data;
  },
  /** Idempotent bulk seed into DEV tables from the owner Data tab. */
  async seedAppData(
    sessionId: string,
    environment: 'dev' | 'prod',
    tables: Record<string, Record<string, unknown>[]>,
  ): Promise<SeedResult> {
    const res = await apiClient.post<ApiResponse<SeedResult>>(
      `/conversation-v2/sessions/${sessionId}/app-data/${environment}/seed`,
      { tables },
    );
    return res.data.data;
  },
};
