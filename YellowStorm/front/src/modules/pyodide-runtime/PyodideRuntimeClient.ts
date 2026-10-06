import { io, type Socket } from 'socket.io-client';
import { getSocketBaseUrl } from '@/lib/api/config';
import { PyodideWorkerController } from './PyodideWorkerController';
import {
  ExecutionCancelPayload,
  ExecutionRequestPayload,
  PyodideRuntimeEvents,
} from './protocol';

export interface PyodideRuntimeClientOptions {
  getToken: () => string | null;
  indexUrl: string;
  onReplaced?: () => void;
  createWorker?: () => Worker;
}

const HEARTBEAT_INTERVAL_MS = 10_000;

function randomRuntimeId(): string {
  const cryptoRef = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined;
  const suffix = cryptoRef?.randomUUID ? cryptoRef.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2);
  return `pyr_${suffix}`;
}

/**
 * Connects the browser Pyodide worker to the YellowStorm relay.
 *
 * The socket never reaches Python and the worker never receives the JWT: this
 * class is the only bridge between the two.
 */
export class PyodideRuntimeClient {
  private socket: Socket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private readonly runtimeId = randomRuntimeId();
  private readonly cancelled = new Set<string>();
  private readonly controller: PyodideWorkerController;

  constructor(private readonly options: PyodideRuntimeClientOptions) {
    this.controller = new PyodideWorkerController({
      indexUrl: options.indexUrl,
      createWorker: options.createWorker,
      onProgress: (executionId, phase, message) => {
        this.socket?.emit(PyodideRuntimeEvents.EXECUTION_PROGRESS, { executionId, phase, message });
      },
    });
  }

  connect(): void {
    if (this.socket) return;
    const token = this.options.getToken();
    if (!token) return;

    const socket = io(`${getSocketBaseUrl()}/pyodide-runtime`, {
      // Resolve the token on every (re)connection so a refreshed access token is used.
      auth: (cb) => cb({ token: this.options.getToken() ?? '' }),
      transports: ['websocket', 'polling'],
      // The runtime bridge is long-lived: it must re-register after a backend
      // restart without the user reloading the page.
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
      timeout: 10_000,
    });
    this.socket = socket;

    socket.on('connect', () => {
      socket.emit(PyodideRuntimeEvents.RUNTIME_REGISTER, { runtimeId: this.runtimeId, status: 'booting' });
      this.startHeartbeat();
    });
    socket.on('execution.request', (payload: ExecutionRequestPayload) => {
      void this.handleRequest(payload);
    });
    socket.on('execution.cancel', (payload: ExecutionCancelPayload) => this.handleCancel(payload));
    socket.on('runtime.replaced', () => {
      this.options.onReplaced?.();
      this.disconnect();
    });
    socket.on('disconnect', () => this.stopHeartbeat());
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.controller.dispose();
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.cancelled.clear();
  }

  private async handleRequest(payload: ExecutionRequestPayload): Promise<void> {
    this.cancelled.delete(payload.executionId);
    const result = await this.controller.execute(
      payload.executionId,
      payload.code,
      payload.input,
      payload.timeoutMs,
    );
    if (this.cancelled.delete(payload.executionId)) return;
    this.socket?.emit(PyodideRuntimeEvents.EXECUTION_COMPLETED, {
      executionId: payload.executionId,
      result,
    });
  }

  private handleCancel(payload: ExecutionCancelPayload): void {
    this.cancelled.add(payload.executionId);
    this.controller.cancel(payload.executionId);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.socket?.emit(PyodideRuntimeEvents.RUNTIME_HEARTBEAT, { runtimeId: this.runtimeId });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }
}
