import type { RuntimeCapabilities } from '../constants/app-runtime-capabilities';

/** Socket.IO namespace served by `AppRuntimeGateway`. */
export const APP_RUNTIME_NAMESPACE = '/app-runtime';

export const AppRuntimeEvents = {
  REGISTER: 'runtime.register',
  HEARTBEAT: 'runtime.heartbeat',
  REHYDRATE: 'runtime.rehydrate',
  TOOL_INVOKE: 'tool.invoke',
  TOOL_PROGRESS: 'tool.progress',
  TOOL_COMPLETED: 'tool.completed',
  TOOL_FAILED: 'tool.failed',
} as const;

export interface AppRuntimeSocketData {
  runtimeSessionId: string;
  bindingId: string;
  workspaceId: string;
  userId: string;
  registered: boolean;
}

/** Browser -> server. */
export interface RuntimeRegisterPayload {
  runtimeSessionId: string;
  workspaceId: string;
  revisionId: string;
  capabilities: Partial<RuntimeCapabilities>;
  browserRuntimeId?: string;
}

/** Browser -> server. */
export interface RuntimeHeartbeatPayload {
  workspaceId: string;
  revisionId?: string;
}

/** Server -> browser. */
export interface ToolInvokePayload {
  toolCallId: string;
  workspaceId: string;
  tool: string;
  arguments: Record<string, unknown>;
  baseRevisionId: string;
  timeoutMs: number;
}

/** Browser -> server. */
export interface ToolProgressPayload {
  toolCallId: string;
  phase?: string;
  message?: string;
}

/** Browser -> server. */
export interface ToolCompletedPayload {
  toolCallId: string;
  result: Record<string, unknown>;
}

export interface RuntimeToolError {
  code: number;
  message: string;
  data?: Record<string, unknown>;
}

/** Browser -> server. */
export interface ToolFailedPayload {
  toolCallId: string;
  error: RuntimeToolError;
}

/** Server -> browser, when the browser filesystem is behind the binding. */
export interface RuntimeRehydratePayload {
  workspaceId: string;
  expectedRevisionId: string;
  actualRevisionId: string;
}

/**
 * Response body of `POST /internal/app-runtime/tool-invoke`. Always returned
 * with HTTP 200 and without the global `{ success, data }` wrapper.
 */
export type ToolInvokeEnvelope =
  | {
      ok: true;
      toolCallId: string;
      result: Record<string, unknown>;
      revisionId?: string;
    }
  | { ok: false; toolCallId: string; error: RuntimeToolError };

/** Payload of the runtime ticket handed to the browser by Conversation V2. */
export interface RuntimeTicketResult {
  runtimeSessionId: string;
  ticket: string;
  workspaceId: string;
  revisionId: string;
  expiresAt: string;
  /** Non-secret App Data config for Vite injection in preview. */
  appDataRuntimeEnv?: {
    appDataId: string;
    environment: 'dev' | 'prod';
    publicUrl: string;
  };
}
