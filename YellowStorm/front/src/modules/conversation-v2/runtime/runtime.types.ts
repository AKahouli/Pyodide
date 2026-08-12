/**
 * Browser runtime protocol types — mirrors the backend app-runtime module.
 * Keep in sync with YellowStorm/back/src/modules/app-runtime/types/app-runtime-protocol.ts
 */

export interface RuntimeCapabilities {
  filesystem: boolean;
  npm: boolean;
  previewInspection: boolean;
  nativeBinaries: boolean;
}

export interface RuntimeTicketResponse {
  runtimeSessionId: string;
  ticket: string;
  workspaceId: string;
  revisionId: string;
  expiresAt: string;
}

export interface ToolInvokePayload {
  toolCallId: string;
  workspaceId: string;
  tool: string;
  arguments: Record<string, unknown>;
  baseRevisionId: string;
  timeoutMs: number;
}

export interface ToolProgressPayload {
  toolCallId: string;
  phase?: string;
  message?: string;
}

export interface ToolCompletedPayload {
  toolCallId: string;
  result: Record<string, unknown>;
}

export interface ToolFailedPayload {
  toolCallId: string;
  error: RuntimeToolError;
}

export interface RuntimeToolError {
  code: number;
  message: string;
  data?: Record<string, unknown>;
}

export interface RuntimeRehydratePayload {
  workspaceId: string;
  expectedRevisionId: string;
  actualRevisionId: string;
}

export interface RuntimeRegisterPayload {
  runtimeSessionId: string;
  workspaceId: string;
  revisionId: string;
  capabilities: Partial<RuntimeCapabilities>;
  browserRuntimeId?: string;
}

export interface RuntimeHeartbeatPayload {
  workspaceId: string;
  revisionId?: string;
}

export type RuntimeHostStatus =
  | 'idle'
  | 'connecting'
  | 'registering'
  | 'hydrating'
  | 'installing'
  | 'starting'
  | 'ready'
  | 'error'
  | 'disconnected';

export const BrowserRuntimeEvents = {
  REGISTER: 'runtime.register',
  HEARTBEAT: 'runtime.heartbeat',
  REHYDRATE: 'runtime.rehydrate',
  TOOL_INVOKE: 'tool.invoke',
  TOOL_PROGRESS: 'tool.progress',
  TOOL_COMPLETED: 'tool.completed',
  TOOL_FAILED: 'tool.failed',
} as const;

export const RuntimeErrorCodes = {
  UNSUPPORTED_CAPABILITY: -32001,
  RUNTIME_OFFLINE: -32002,
  REVISION_CONFLICT: -32003,
  TOOL_TIMEOUT: -32005,
  TOOL_CANCELLED: -32006,
  PROCESS_FAILED: -32007,
  INTERNAL_ERROR: -32603,
} as const;
