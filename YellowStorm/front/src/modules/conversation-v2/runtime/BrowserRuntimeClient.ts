import { io, type Socket } from 'socket.io-client';
import { getSocketBaseUrl } from '@/lib/api/config';
import {
  BrowserRuntimeEvents,
  type RuntimeRegisterPayload,
  type RuntimeHeartbeatPayload,
  type ToolInvokePayload,
  type ToolProgressPayload,
  type ToolCompletedPayload,
  type ToolFailedPayload,
  type RuntimeRehydratePayload,
} from './runtime.types';

const LOG = '[BrowserRuntimeClient]';

export type ToolInvokeHandler = (payload: ToolInvokePayload) => void;
export type RehydrateHandler = (payload: RuntimeRehydratePayload) => void;
export type DisconnectHandler = (reason: string) => void;
export type ConnectHandler = () => void;

export class BrowserRuntimeClient {
  private socket: Socket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _onToolInvoke: ToolInvokeHandler | null = null;
  private _onRehydrate: RehydrateHandler | null = null;
  private _onDisconnect: DisconnectHandler | null = null;
  private _onConnect: ConnectHandler | null = null;

  get connected(): boolean {
    return this.socket?.connected === true;
  }

  connect(ticket: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket) {
        this.disconnect();
      }

      const baseUrl = getSocketBaseUrl();
      console.log(LOG, 'connecting', { baseUrl });

      this.socket = io(`${baseUrl}/app-runtime`, {
        auth: { ticket },
        transports: ['websocket', 'polling'],
        reconnection: false,
      });

      const onConnect = () => {
        console.log(LOG, 'connected');
        cleanup();
        this._onConnect?.();
        resolve();
      };

      const onError = (err: Error) => {
        console.error(LOG, 'connect_error', err.message);
        cleanup();
        reject(err);
      };

      const onDisconnect = (reason: string) => {
        console.warn(LOG, 'disconnected during connect', reason);
        cleanup();
        reject(new Error(`Disconnected during connect: ${reason}`));
      };

      const cleanup = () => {
        this.socket?.off('connect', onConnect);
        this.socket?.off('connect_error', onError);
        this.socket?.off('disconnect', onDisconnect);
        this.bindEvents();
      };

      this.socket.on('connect', onConnect);
      this.socket.on('connect_error', onError);
      this.socket.on('disconnect', onDisconnect);
    });
  }

  private bindEvents(): void {
    if (!this.socket) return;

    this.socket.on(BrowserRuntimeEvents.TOOL_INVOKE, (payload: ToolInvokePayload) => {
      console.log(LOG, 'tool.invoke', { toolCallId: payload.toolCallId, tool: payload.tool });
      this._onToolInvoke?.(payload);
    });

    this.socket.on(BrowserRuntimeEvents.REHYDRATE, (payload: RuntimeRehydratePayload) => {
      console.log(LOG, 'runtime.rehydrate', payload);
      this._onRehydrate?.(payload);
    });

    this.socket.on('disconnect', (reason: string) => {
      console.warn(LOG, 'disconnected', reason);
      this.stopHeartbeat();
      this._onDisconnect?.(reason);
    });
  }

  register(payload: RuntimeRegisterPayload): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error('Not connected'));
        return;
      }
      this.socket.emit(
        BrowserRuntimeEvents.REGISTER,
        payload,
        (ack: { ok: boolean; error?: string }) => {
          console.log(LOG, 'register ack', ack);
          resolve(ack);
        },
      );
    });
  }

  startHeartbeat(
    workspaceId: string,
    getRevisionId: () => string,
    intervalMs = 10_000,
  ): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.socket?.connected) return;
      const payload: RuntimeHeartbeatPayload = {
        workspaceId,
        revisionId: getRevisionId(),
      };
      this.socket.emit(BrowserRuntimeEvents.HEARTBEAT, payload);
    }, intervalMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  emitToolProgress(payload: ToolProgressPayload): void {
    this.socket?.emit(BrowserRuntimeEvents.TOOL_PROGRESS, payload);
  }

  emitToolCompleted(payload: ToolCompletedPayload): void {
    console.log(LOG, 'tool.completed', { toolCallId: payload.toolCallId });
    this.socket?.emit(BrowserRuntimeEvents.TOOL_COMPLETED, payload);
  }

  emitToolFailed(payload: ToolFailedPayload): void {
    console.warn(LOG, 'tool.failed', { toolCallId: payload.toolCallId, code: payload.error.code });
    this.socket?.emit(BrowserRuntimeEvents.TOOL_FAILED, payload);
  }

  onToolInvoke(handler: ToolInvokeHandler): void {
    this._onToolInvoke = handler;
  }

  onRehydrate(handler: RehydrateHandler): void {
    this._onRehydrate = handler;
  }

  onDisconnect(handler: DisconnectHandler): void {
    this._onDisconnect = handler;
  }

  onConnect(handler: ConnectHandler): void {
    this._onConnect = handler;
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }
}
