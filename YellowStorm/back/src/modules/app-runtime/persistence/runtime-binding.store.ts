/**
 * Store port for app_runtime.bindings (P8 Mongo cutover).
 */

export type RuntimeBindingStatus =
  | 'created'
  | 'waiting_for_browser'
  | 'browser_active'
  | 'paused'
  | 'failed';

export interface RuntimeBindingRecord {
  bindingId: string;
  workspaceId: string;
  conversationSessionId: string;
  userId: string;
  status: RuntimeBindingStatus;
  latestRevisionId: string;
  mcpTokenHash: string;
  browserRuntimeId: string | null;
  browserCapabilities: Record<string, unknown> | null;
  lastHeartbeatAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertBindingData {
  workspaceId: string;
  conversationSessionId: string;
  userId: string;
  /** null → do not touch mcpTokenHash on update; empty string on insert. */
  mcpTokenHash: string | null;
  bindingId: string;
  status: RuntimeBindingStatus;
  latestRevisionId: string;
}

export interface RuntimeBindingStore {
  upsertByWorkspaceId(data: UpsertBindingData): Promise<RuntimeBindingRecord | null>;
  findByWorkspaceId(workspaceId: string): Promise<RuntimeBindingRecord | null>;
  findByMcpTokenHash(mcpTokenHash: string): Promise<RuntimeBindingRecord | null>;
  updateStatus(workspaceId: string, fromStatus: RuntimeBindingStatus | null, toStatus: RuntimeBindingStatus, extra?: Partial<Pick<RuntimeBindingRecord, 'browserRuntimeId' | 'browserCapabilities' | 'lastHeartbeatAt'>>): Promise<void>;
  updateHeartbeat(workspaceId: string, at: Date): Promise<void>;
  updateRevision(workspaceId: string, revisionId: string): Promise<void>;
}
