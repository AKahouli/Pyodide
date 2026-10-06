/// <reference lib="webworker" />
import { loadPyodide } from 'pyodide';
import {
  MAX_LOG_BYTES,
  MAX_RESULT_BYTES,
  PyodideExecutionResult,
  WorkerRequest,
  WorkerResponse,
  emptyExecution,
  failureResult,
} from './protocol';

type PyodideApi = Awaited<ReturnType<typeof loadPyodide>>;

interface WorkerScope {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;

let pyodidePromise: Promise<PyodideApi> | null = null;
let indexUrl = '';
let coldStart = true;
let pythonVersion: string | undefined;

function getPyodide(): Promise<PyodideApi> {
  if (!pyodidePromise) {
    pyodidePromise = loadPyodide({ indexURL: indexUrl });
  }
  return pyodidePromise;
}

async function pythonVersionOf(py: PyodideApi): Promise<string | undefined> {
  if (pythonVersion === undefined) {
    try {
      const value = py.runPython('import sys; sys.version');
      pythonVersion = typeof value === 'string' ? value : String(value);
    } catch {
      pythonVersion = undefined;
    }
  }
  return pythonVersion;
}

function jsonSafe(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return String(value);
  }
}

async function execute(request: Extract<WorkerRequest, { type: 'execute' }>): Promise<PyodideExecutionResult> {
  const { executionId, code, input } = request;
  const started = performance.now();
  const wasCold = coldStart;

  scope.postMessage({ type: 'progress', executionId, phase: 'boot' });
  let py: PyodideApi;
  try {
    py = await getPyodide();
  } catch (error) {
    return failureResult('PYODIDE_BOOT_FAILED', `Pyodide failed to start: ${(error as Error).message}`);
  }

  scope.postMessage({ type: 'progress', executionId, phase: 'packages' });
  try {
    await py.loadPackagesFromImports(code);
  } catch (error) {
    return failureResult(
      'PYODIDE_UNSUPPORTED_PACKAGE',
      `A required package is not available in the Pyodide distribution: ${(error as Error).message}`,
    );
  }

  let stdout = '';
  let stderr = '';
  let logsTruncated = false;
  const capture = (target: 'out' | 'err', chunk: string): void => {
    const used = stdout.length + stderr.length;
    const remaining = MAX_LOG_BYTES - used;
    if (remaining <= 0) {
      logsTruncated = true;
      return;
    }
    const slice = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
    if (slice.length < chunk.length) logsTruncated = true;
    if (target === 'out') stdout += slice;
    else stderr += slice;
  };

  py.setStdout({ batched: (text: string) => capture('out', text) });
  py.setStderr({ batched: (text: string) => capture('err', text) });

  scope.postMessage({ type: 'progress', executionId, phase: 'running' });
  const globals = py.toPy({ input_data: input ?? null });
  let returnValue: unknown;
  try {
    returnValue = await py.runPythonAsync(code, { globals });
  } catch (error) {
    return failureResult('PYODIDE_EXECUTION_ERROR', (error as Error).message, { stdout, stderr, logsTruncated });
  } finally {
    py.setStdout();
    py.setStderr();
    globals.destroy();
  }

  let result: unknown;
  try {
    const candidate = returnValue as { toJs?: (options: Record<string, unknown>) => unknown };
    result = typeof candidate?.toJs === 'function'
      ? candidate.toJs({ dict_converter: Object.fromEntries, create_pyproxies: false })
      : returnValue;
  } catch {
    result = String(returnValue);
  }
  (returnValue as { destroy?: () => void } | undefined)?.destroy?.();
  result = jsonSafe(result);

  let serialized: string;
  try {
    serialized = JSON.stringify(result) ?? 'null';
  } catch {
    result = String(result);
    serialized = JSON.stringify(result) ?? 'null';
  }
  if (serialized.length > MAX_RESULT_BYTES) {
    return failureResult('PYODIDE_RESULT_TOO_LARGE', 'The result exceeded the configured limit.', { stdout, stderr, logsTruncated });
  }

  coldStart = false;
  return {
    ok: true,
    result,
    stdout,
    stderr,
    ...(logsTruncated ? { logsTruncated: true } : {}),
    execution: emptyExecution({
      durationMs: Math.round(performance.now() - started),
      coldStart: wasCold,
      pyodideVersion: py.version,
      pythonVersion: await pythonVersionOf(py),
      loadedPackages: Object.keys(py.loadedPackages ?? {}),
    }),
  };
}

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'init') {
    indexUrl = request.indexUrl;
    void getPyodide()
      .then((py) => scope.postMessage({ type: 'ready', pyodideVersion: py.version }))
      .catch((error: Error) => scope.postMessage({ type: 'fatal', code: 'PYODIDE_BOOT_FAILED', message: error.message }));
    return;
  }
  if (request.type === 'execute') {
    void execute(request).then((result) => {
      scope.postMessage({ type: 'result', executionId: request.executionId, result });
    });
  }
};
