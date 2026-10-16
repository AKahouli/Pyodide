export type PyodideRuntimeStatus = 'booting' | 'ready' | 'busy';

/** Aggregate stdout + stderr cap. */
export const MAX_LOG_BYTES = 256 * 1024;
/** Serialized result cap. */
export const MAX_RESULT_BYTES = 512 * 1024;
/** Total bytes of files captured from /workspace/output before the relay persists them. */
export const MAX_WORKSPACE_FILE_BYTES = 8 * 1024 * 1024;

export interface PyodideWorkspaceFile {
  name: string;
  mimeType?: string;
  contentBase64: string;
}

export interface PyodideExecutionResult {
  ok: boolean;
  result?: unknown;
  stdout: string;
  stderr: string;
  logsTruncated?: boolean;
  /** Raw files captured from /workspace/output; persisted by the relay, never returned to the model. */
  outputFiles?: PyodideWorkspaceFile[];
  execution: {
    runtime: 'pyodide';
    pythonVersion?: string;
    pyodideVersion?: string;
    durationMs: number;
    coldStart: boolean;
    loadedPackages: string[];
  };
  error?: { code: string; message: string };
}

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

export interface ExecutionRequestPayload {
  executionId: string;
  code: string;
  input: unknown;
  timeoutMs: number;
  /** Bounded workspace files to mount under /workspace/input. */
  inputFiles?: PyodideWorkspaceFile[];
  /** File names to capture from /workspace/output. */
  outputFiles?: string[];
}

export interface ExecutionCancelPayload {
  executionId: string;
}

export interface RuntimeRegisterPayload {
  runtimeId: string;
  status?: PyodideRuntimeStatus;
}

export type WorkerRequest =
  | { type: 'init'; indexUrl: string }
  | {
      type: 'execute';
      executionId: string;
      code: string;
      input: unknown;
      timeoutMs: number;
      inputFiles?: PyodideWorkspaceFile[];
      outputFiles?: string[];
    };

export type WorkerResponse =
  | { type: 'ready'; pyodideVersion: string }
  | { type: 'progress'; executionId: string; phase?: string; message?: string }
  | { type: 'result'; executionId: string; result: PyodideExecutionResult }
  | { type: 'fatal'; code: string; message: string };

export function emptyExecution(overrides: Partial<PyodideExecutionResult['execution']> = {}): PyodideExecutionResult['execution'] {
  return {
    runtime: 'pyodide',
    durationMs: 0,
    coldStart: false,
    loadedPackages: [],
    ...overrides,
  };
}

export function failureResult(
  code: string,
  message: string,
  overrides: Partial<PyodideExecutionResult> = {},
): PyodideExecutionResult {
  return {
    ok: false,
    stdout: '',
    stderr: '',
    execution: emptyExecution(),
    error: { code, message },
    ...overrides,
  };
}
