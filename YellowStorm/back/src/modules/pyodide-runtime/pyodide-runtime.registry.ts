import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Socket } from 'socket.io';
import type { PyodideRuntimeConnection, PyodideRuntimeStatus } from './pyodide-runtime.types';

export interface RegisterRuntimeParams {
  userId: string;
  socket: Socket;
  runtimeId: string;
  status?: PyodideRuntimeStatus;
}

/**
 * In-memory index of the active Pyodide browser runtime per user.
 *
 * One runtime per user: a second registration evicts and replaces the previous
 * connection (avoiding multi-tab routing in the MVP). Process-local, same
 * constraint as `BrowserSessionService` and `RuntimeConnectionRegistry`.
 */
@Injectable()
export class PyodideRuntimeRegistry {
  private readonly logger = new Logger(PyodideRuntimeRegistry.name);
  private readonly byUser = new Map<string, PyodideRuntimeConnection>();

  constructor(private readonly config: ConfigService) {}

  register(params: RegisterRuntimeParams): PyodideRuntimeConnection | null {
    const previous = this.byUser.get(params.userId) ?? null;
    const now = Date.now();

    if (previous?.socket.id === params.socket.id) {
      previous.runtimeId = params.runtimeId;
      previous.status = params.status ?? previous.status;
      previous.lastHeartbeatAt = now;
      return null;
    }

    this.byUser.set(params.userId, {
      userId: params.userId,
      socket: params.socket,
      runtimeId: params.runtimeId,
      status: params.status ?? 'booting',
      lastHeartbeatAt: now,
    });
    this.logger.debug(`Pyodide runtime registered userId=${params.userId} runtimeId=${params.runtimeId}`);
    return previous;
  }

  get(userId: string): PyodideRuntimeConnection | null {
    return this.byUser.get(userId) ?? null;
  }

  /** Only removes the entry when it still points at the given socket. */
  unregister(userId: string, socketId: string): boolean {
    const current = this.byUser.get(userId);
    if (current?.socket.id !== socketId) return false;
    this.byUser.delete(userId);
    this.logger.debug(`Pyodide runtime unregistered userId=${userId}`);
    return true;
  }

  touch(userId: string, status?: PyodideRuntimeStatus): PyodideRuntimeConnection | null {
    const connection = this.byUser.get(userId);
    if (!connection) return null;
    connection.lastHeartbeatAt = Date.now();
    if (status) connection.status = status;
    return connection;
  }

  markBusy(userId: string, executionId: string): void {
    const connection = this.byUser.get(userId);
    if (!connection) return;
    connection.status = 'busy';
    connection.activeExecutionId = executionId;
  }

  markReady(userId: string): void {
    const connection = this.byUser.get(userId);
    if (!connection) return;
    connection.status = 'ready';
    connection.activeExecutionId = undefined;
  }

  isUsable(connection: PyodideRuntimeConnection): boolean {
    return connection.socket.connected && !this.isStale(connection);
  }

  isStale(connection: PyodideRuntimeConnection, now = Date.now()): boolean {
    const timeoutMs = this.config.get<number>('pyodideRuntime.heartbeatTimeoutMs', 30_000);
    return now - connection.lastHeartbeatAt > timeoutMs;
  }
}
