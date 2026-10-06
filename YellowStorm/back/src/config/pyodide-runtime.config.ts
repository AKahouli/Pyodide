import { registerAs } from '@nestjs/config';

/**
 * Browser Pyodide runtime relay configuration.
 *
 * The backend is only a relay: Python runs in the user's browser worker. When
 * disabled, registration and execution are rejected and the MCP reports the
 * runtime as offline.
 */
export default registerAs('pyodideRuntime', () => ({
  enabled: process.env.PYODIDE_RUNTIME_ENABLED === 'true',
  executionTimeoutMs: parseInt(process.env.PYODIDE_RUNTIME_EXECUTION_TIMEOUT_MS ?? '90000', 10),
  heartbeatTimeoutMs: parseInt(process.env.PYODIDE_RUNTIME_HEARTBEAT_TIMEOUT_MS ?? '30000', 10),
  maxQueue: parseInt(process.env.PYODIDE_RUNTIME_MAX_QUEUE ?? '3', 10),
  /** Total bytes of workspace files handed to the browser (/workspace/input). */
  maxInputFileBytes: parseInt(process.env.PYODIDE_RUNTIME_MAX_INPUT_FILE_BYTES ?? String(2 * 1024 * 1024), 10),
  /** Total bytes of files captured from /workspace/output and persisted. */
  maxOutputFileBytes: parseInt(process.env.PYODIDE_RUNTIME_MAX_OUTPUT_FILE_BYTES ?? String(512 * 1024), 10),
}));
