import { PyodideExecutionResult, WorkerResponse, failureResult } from './protocol';

export interface PyodideWorkerControllerOptions {
  indexUrl: string;
  createWorker?: () => Worker;
  onProgress?: (executionId: string, phase?: string, message?: string) => void;
  maxIdleMs?: number;
}

interface PendingExecution {
  resolve: (result: PyodideExecutionResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_IDLE_MS = 15 * 60 * 1000;

/**
 * Owns the dedicated Pyodide Web Worker.
 *
 * The worker is created lazily on the first execution, kept warm afterwards,
 * and terminated after an idle period. A timeout terminates the worker as the
 * cancellation guarantee, then the next execution recreates it.
 */
export class PyodideWorkerController {
  private worker: Worker | null = null;
  private readonly pending = new Map<string, PendingExecution>();
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: PyodideWorkerControllerOptions) {}

  get isStarted(): boolean {
    return this.worker !== null;
  }

  warmup(): void {
    this.ensureWorker();
  }

  execute(executionId: string, code: string, input: unknown, timeoutMs: number): Promise<PyodideExecutionResult> {
    const worker = this.ensureWorker();
    return new Promise<PyodideExecutionResult>((resolve) => {
      const timer = setTimeout(
        () => {
          this.settle(executionId, failureResult('PYODIDE_EXECUTION_TIMEOUT', 'Python execution timed out.'));
          this.terminateWorker();
        },
        timeoutMs,
      );
      this.pending.set(executionId, { resolve, timer });
      worker.postMessage({ type: 'execute', executionId, code, input, timeoutMs });
    });
  }

  cancel(executionId: string): void {
    this.settle(executionId, failureResult('PYODIDE_EXECUTION_TIMEOUT', 'Python execution was cancelled.'));
    this.terminateWorker();
  }

  dispose(): void {
    for (const executionId of [...this.pending.keys()]) {
      this.settle(executionId, failureResult('PYODIDE_CONNECTION_LOST', 'The browser Python runtime was stopped.'));
    }
    this.terminateWorker();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = this.options.createWorker
      ? this.options.createWorker()
      : new Worker(new URL('./pyodide.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.onMessage(event.data);
    worker.postMessage({ type: 'init', indexUrl: this.options.indexUrl });
    this.worker = worker;
    return worker;
  }

  private onMessage(message: WorkerResponse): void {
    if (message.type === 'progress') {
      this.options.onProgress?.(message.executionId, message.phase, message.message);
      return;
    }
    if (message.type === 'result') {
      this.settle(message.executionId, message.result);
      return;
    }
    if (message.type === 'fatal') {
      for (const executionId of [...this.pending.keys()]) {
        this.settle(executionId, failureResult(message.code, message.message));
      }
      this.terminateWorker();
    }
  }

  private settle(executionId: string, result: PyodideExecutionResult): void {
    const pending = this.pending.get(executionId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(executionId);
    pending.resolve(result);
    this.resetIdleTimer();
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.pending.size > 0) return;
    this.idleTimer = setTimeout(() => this.terminateWorker(), this.options.maxIdleMs ?? DEFAULT_IDLE_MS);
  }

  private terminateWorker(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
