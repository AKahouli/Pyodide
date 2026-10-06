import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PyodideRuntimeRegistry } from './pyodide-runtime.registry';
import {
  ExecutePyodideRequest,
  ExecutionCompletedPayload,
  ExecutionFailedPayload,
  ExecutionProgressPayload,
  PyodideErrorCode,
  PyodideExecutionInfo,
  PyodideExecutionResult,
  PyodideRuntimeConnection,
  PyodideRuntimeEvents,
} from './pyodide-runtime.types';

const RESULT_CACHE_TTL_MS = 5 * 60 * 1000;

interface PendingExecution {
  executionId: string;
  userId: string;
  socketId: string;
  resolve: (result: PyodideExecutionResult) => void;
  timer: NodeJS.Timeout;
}

interface QueuedExecution {
  executionId: string;
  request: ExecutePyodideRequest;
  resolve: (result: PyodideExecutionResult) => void;
}

function executionInfo(overrides: Partial<PyodideExecutionInfo> = {}): PyodideExecutionInfo {
  return {
    runtime: 'pyodide',
    durationMs: 0,
    coldStart: false,
    loadedPackages: [],
    ...overrides,
  };
}

/**
 * Routes one Python execution to the user's active browser runtime.
 *
 * Policy: one active execution per browser, at most `maxQueue` waiting. The
 * forced termination of the worker is the timeout guarantee, so a timed-out
 * request emits `execution.cancel` and resolves without waiting for the
 * browser. Disconnections never leave a request hanging.
 */
@Injectable()
export class PyodideRuntimeDispatcher {
  private readonly logger = new Logger(PyodideRuntimeDispatcher.name);
  private readonly pending = new Map<string, PendingExecution>();
  private readonly queues = new Map<string, QueuedExecution[]>();
  private readonly active = new Map<string, string>();
  private readonly resultCache = new Map<string, { at: number; result: PyodideExecutionResult }>();

  constructor(
    private readonly registry: PyodideRuntimeRegistry,
    private readonly config: ConfigService,
  ) {}

  async execute(userId: string, request: ExecutePyodideRequest): Promise<PyodideExecutionResult> {
    const connection = this.registry.get(userId);
    if (!connection || !this.registry.isUsable(connection)) {
      return this.failure(PyodideErrorCode.RUNTIME_OFFLINE, 'The browser Python runtime is not connected.');
    }

    const timeoutMs = this.effectiveTimeout(request.timeoutMs);
    const normalized: ExecutePyodideRequest = { ...request, timeoutMs };

    if (this.active.has(userId)) {
      const queue = this.queues.get(userId) ?? [];
      if (queue.length >= this.config.get<number>('pyodideRuntime.maxQueue', 3)) {
        return this.failure(PyodideErrorCode.RUNTIME_BUSY, 'The browser Python runtime is busy.');
      }
      return new Promise<PyodideExecutionResult>((resolve) => {
        queue.push({ executionId: this.newExecutionId(), request: normalized, resolve });
        this.queues.set(userId, queue);
      });
    }

    return this.start(userId, connection, normalized);
  }

  handleCompleted(userId: string, payload: ExecutionCompletedPayload): void {
    const pending = this.pending.get(payload.executionId);
    if (pending?.userId !== userId) return;
    this.settle(userId, payload.executionId, this.normalizeResult(payload.result));
  }

  handleFailed(userId: string, payload: ExecutionFailedPayload): void {
    const pending = this.pending.get(payload.executionId);
    if (pending?.userId !== userId) return;
    this.settle(userId, payload.executionId, {
      ok: false,
      stdout: payload.stdout ?? '',
      stderr: payload.stderr ?? '',
      execution: payload.execution ?? executionInfo(),
      error: payload.error,
    });
  }

  handleProgress(userId: string, payload: ExecutionProgressPayload): void {
    const pending = this.pending.get(payload.executionId);
    if (pending?.userId !== userId) return;
    this.logger.debug(
      `Pyodide execution progress userId=${userId} executionId=${payload.executionId} phase=${payload.phase ?? ''}`,
    );
  }

  /** Resolve everything in flight for a user whose runtime is gone. */
  failForUser(userId: string, code: string, message: string): void {
    const activeId = this.active.get(userId);
    if (activeId) {
      this.settle(userId, activeId, this.failure(code, message), { drain: false });
    }
    const queue = this.queues.get(userId) ?? [];
    this.queues.delete(userId);
    for (const queued of queue) {
      queued.resolve(this.failure(code, message));
    }
  }

  getCached(executionId: string): PyodideExecutionResult | null {
    const entry = this.resultCache.get(executionId);
    if (!entry) return null;
    if (Date.now() - entry.at > RESULT_CACHE_TTL_MS) {
      this.resultCache.delete(executionId);
      return null;
    }
    return entry.result;
  }

  isActive(userId: string): boolean {
    return this.active.has(userId);
  }

  queueLength(userId: string): number {
    return this.queues.get(userId)?.length ?? 0;
  }

  private start(
    userId: string,
    connection: PyodideRuntimeConnection,
    request: ExecutePyodideRequest,
  ): Promise<PyodideExecutionResult> {
    const executionId = this.newExecutionId();
    return new Promise<PyodideExecutionResult>((resolve) => {
      const timer = setTimeout(() => {
        this.onTimeout(userId, executionId);
      }, request.timeoutMs);
      this.pending.set(executionId, { executionId, userId, socketId: connection.socket.id, resolve, timer });
      this.active.set(userId, executionId);
      this.registry.markBusy(userId, executionId);
      connection.socket.emit(PyodideRuntimeEvents.EXECUTION_REQUEST, {
        executionId,
        code: request.code,
        input: request.input ?? null,
        timeoutMs: request.timeoutMs,
        ...(request.inputFiles?.length ? { inputFiles: request.inputFiles } : {}),
        ...(request.outputs?.length ? { outputFiles: request.outputs } : {}),
      });
    });
  }

  private onTimeout(userId: string, executionId: string): void {
    const pending = this.pending.get(executionId);
    if (!pending) return;
    const connection = this.registry.get(userId);
    connection?.socket.emit(PyodideRuntimeEvents.EXECUTION_CANCEL, { executionId });
    this.settle(
      userId,
      executionId,
      this.failure(PyodideErrorCode.EXECUTION_TIMEOUT, 'Python execution timed out.'),
    );
  }

  private settle(
    userId: string,
    executionId: string,
    result: PyodideExecutionResult,
    options: { drain?: boolean } = {},
  ): void {
    const pending = this.pending.get(executionId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(executionId);
    this.resultCache.set(executionId, { at: Date.now(), result });
    pending.resolve(result);

    if (this.active.get(userId) === executionId) this.active.delete(userId);
    this.registry.markReady(userId);

    if (options.drain !== false) this.drain(userId);
  }

  private drain(userId: string): void {
    const queue = this.queues.get(userId) ?? [];
    const next = queue.shift();
    if (!next) {
      this.queues.delete(userId);
      return;
    }
    this.queues.set(userId, queue);

    const connection = this.registry.get(userId);
    if (!connection || !this.registry.isUsable(connection)) {
      next.resolve(this.failure(PyodideErrorCode.RUNTIME_OFFLINE, 'The browser Python runtime is not connected.'));
      this.drain(userId);
      return;
    }
    void this.start(userId, connection, next.request).then((result) => {
      next.resolve(result);
    });
  }

  private normalizeResult(result: PyodideExecutionResult | undefined): PyodideExecutionResult {
    if (!result || typeof result !== 'object') {
      return this.failure(PyodideErrorCode.EXECUTION_ERROR, 'The browser runtime returned no result.');
    }
    return {
      ok: result.ok,
      result: result.result,
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
      logsTruncated: result.logsTruncated,
      outputFiles: Array.isArray(result.outputFiles) ? result.outputFiles : undefined,
      artifacts: Array.isArray(result.artifacts) ? result.artifacts : undefined,
      execution: result.execution,
      error: result.error,
    };
  }

  private failure(code: string, message: string): PyodideExecutionResult {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      execution: executionInfo(),
      error: { code, message },
    };
  }

  private effectiveTimeout(requested: number): number {
    const cap = this.config.get<number>('pyodideRuntime.executionTimeoutMs', 90_000);
    const value = Number.isFinite(requested) && requested > 0 ? requested : cap;
    return Math.min(value, cap);
  }

  private newExecutionId(): string {
    return `pye_${randomUUID().replace(/-/g, '')}`;
  }
}
