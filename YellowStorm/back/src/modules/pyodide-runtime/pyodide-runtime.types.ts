import type { Socket } from 'socket.io';

export const PYODIDE_RUNTIME_NAMESPACE = '/pyodide-runtime';

/** Stable application error codes surfaced to the MCP and the model. */
export const PyodideErrorCode = {
  RUNTIME_OFFLINE: 'PYODIDE_RUNTIME_OFFLINE',
  RUNTIME_BUSY: 'PYODIDE_RUNTIME_BUSY',
  BOOT_FAILED: 'PYODIDE_BOOT_FAILED',
  REQUEST_TOO_LARGE: 'PYODIDE_REQUEST_TOO_LARGE',
  UNSUPPORTED_PACKAGE: 'PYODIDE_UNSUPPORTED_PACKAGE',
  EXECUTION_TIMEOUT: 'PYODIDE_EXECUTION_TIMEOUT',
  EXECUTION_ERROR: 'PYODIDE_EXECUTION_ERROR',
  RESULT_TOO_LARGE: 'PYODIDE_RESULT_TOO_LARGE',
  CONNECTION_LOST: 'PYODIDE_CONNECTION_LOST',
} as const;

export type PyodideErrorCodeValue = (typeof PyodideErrorCode)[keyof typeof PyodideErrorCode];

export const PyodideRuntimeEvents = {
  RUNTIME_REGISTER: 'runtime.register',
  RUNTIME_HEARTBEAT: 'runtime.heartbeat',
  EXECUTION_PROGRESS: 'execution.progress',
  EXECUTION_COMPLETED: 'execution.completed',
  EXECUTION_FAILED: 'execution.failed',
  EXECUTION_REQUEST: 'execution.request',
  EXECUTION_CANCEL: 'execution.cancel',
  RUNTIME_REPLACED: 'runtime.replaced',
} as const;

export type PyodideRuntimeStatus = 'booting' | 'ready' | 'busy';

export interface PyodideRuntimeConnection {
  userId: string;
  socket: Socket;
  runtimeId: string;
  status: PyodideRuntimeStatus;
  lastHeartbeatAt: number;
  activeExecutionId?: string;
}

/** A bounded input file handed to the browser and mounted under /workspace/input. */
export interface PyodideResolvedInputFile {
  name: string;
  mimeType: string;
  contentBase64: string;
}

/** A file captured from /workspace/output in the browser. */
export interface PyodideOutputFile {
  name: string;
  mimeType?: string;
  contentBase64: string;
}

/** A persisted workspace artifact reference (no content travels through MCP). */
export interface PyodideArtifactReference {
  name: string;
  sizeBytes: number;
  contentType?: string;
  documentId?: string;
}

export interface ExecutePyodideRequest {
  code: string;
  input?: unknown;
  timeoutMs: number;
  inputs?: string[];
  outputs?: string[];
  /** Resolved, bounded input files injected by the relay controller before dispatch. */
  inputFiles?: PyodideResolvedInputFile[];
}

export interface PyodideExecutionInfo {
  runtime: 'pyodide';
  pythonVersion?: string;
  pyodideVersion?: string;
  durationMs: number;
  coldStart: boolean;
  loadedPackages: string[];
}

export interface PyodideExecutionResult {
  ok: boolean;
  result?: unknown;
  stdout: string;
  stderr: string;
  logsTruncated?: boolean;
  /** Persisted artifact references (content never travels through MCP). */
  artifacts?: PyodideArtifactReference[];
  /** Raw files captured from the browser, persisted by the relay before returning. */
  outputFiles?: PyodideOutputFile[];
  execution: PyodideExecutionInfo;
  error?: { code: string; message: string };
}

export interface RuntimeRegisterPayload {
  runtimeId: string;
  status?: PyodideRuntimeStatus;
}

export interface RuntimeHeartbeatPayload {
  runtimeId?: string;
}

export interface ExecutionProgressPayload {
  executionId: string;
  phase?: string;
  message?: string;
}

export interface ExecutionCompletedPayload {
  executionId: string;
  result: PyodideExecutionResult;
}

export interface ExecutionFailedPayload {
  executionId: string;
  error: { code: string; message: string };
  stdout?: string;
  stderr?: string;
  execution?: PyodideExecutionInfo;
}

export interface PyodideSocketData {
  userId?: string;
  runtimeId?: string;
  registered?: boolean;
}
