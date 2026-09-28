/**
 * Store port for app_runtime.tool_calls (P8 Mongo cutover).
 */

export type ToolCallStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface RuntimeToolCallRecord {
  toolCallId: string;
  bindingId: string;
  workspaceId: string;
  tool: string;
  argumentsHash: string;
  baseRevisionId: string | null;
  status: ToolCallStatus;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  resultingRevisionId: string | null;
  startedAtMs: number | null;
  durationMs: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertRunningToolCallData {
  toolCallId: string;
  bindingId: string;
  workspaceId: string;
  tool: string;
  argumentsHash: string;
  baseRevisionId: string | null;
}

export interface RuntimeToolCallStore {
  findByToolCallId(toolCallId: string): Promise<RuntimeToolCallRecord | null>;
  /** Upsert with status='running', startedAtMs=now. */
  upsertRunning(data: UpsertRunningToolCallData): Promise<void>;
  /** Update to succeeded with result and optional revisionId. */
  markSucceeded(toolCallId: string, result: Record<string, unknown>, resultingRevisionId: string | null, durationMs: number | null): Promise<void>;
  /** Update to failed with error. */
  markFailed(toolCallId: string, error: Record<string, unknown>, durationMs: number | null): Promise<void>;
  /** Get startedAtMs for elapsed time calculation. */
  getStartedAtMs(toolCallId: string): Promise<number | null>;
}
