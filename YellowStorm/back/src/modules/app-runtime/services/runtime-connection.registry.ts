import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Socket } from 'socket.io';
import {
  RuntimeCapabilities,
  normalizeCapabilities,
} from '../constants/app-runtime-capabilities';

export interface RuntimeConnection {
  socket: Socket;
  runtimeSessionId: string;
  bindingId: string;
  workspaceId: string;
  userId: string;
  capabilities: RuntimeCapabilities;
  revisionId: string;
  lastHeartbeatAt: number;
  /** Tail of the per-workspace mutation queue. */
  mutationLock: Promise<void>;
  /** Wall clock of the last heartbeat flushed to Mongo. */
  lastHeartbeatFlushAt: number;
}

export interface RegisterConnectionParams {
  socket: Socket;
  runtimeSessionId: string;
  bindingId: string;
  workspaceId: string;
  userId: string;
  capabilities: Partial<RuntimeCapabilities>;
  revisionId: string;
}

/**
 * In-memory index of live browser runtimes, keyed by workspace.
 *
 * This is process-local: with no Redis Socket.IO adapter configured, a tool
 * dispatch only reaches the browser when it lands on the instance holding the
 * socket. Same constraint as `BrowserSessionService`.
 */
@Injectable()
export class RuntimeConnectionRegistry {
  private readonly logger = new Logger(RuntimeConnectionRegistry.name);
  private readonly byWorkspace = new Map<string, RuntimeConnection>();
  /** Waiters for the next non-stale register on a workspace (tool dispatch). */
  private readonly connectionWaiters = new Map<
    string,
    Set<(connection: RuntimeConnection) => void>
  >();

  constructor(private readonly config: ConfigService) {}

  /**
   * Register a browser runtime, replacing any previous connection for the same
   * workspace (second tab, or a reconnect the server has not noticed yet).
   * Returns the evicted connection so the caller can disconnect it.
   *
   * A same-socket re-register (browser reporting a new revision before
   * `tool.completed`) must keep the mutation queue. Resetting it would let a
   * second write run while the first is still settling.
   */
  register(params: RegisterConnectionParams): RuntimeConnection | null {
    const previous = this.byWorkspace.get(params.workspaceId) ?? null;
    const now = Date.now();
    const sameSocket = previous?.socket.id === params.socket.id;

    if (previous && sameSocket) {
      previous.runtimeSessionId = params.runtimeSessionId;
      previous.bindingId = params.bindingId;
      previous.userId = params.userId;
      previous.capabilities = normalizeCapabilities(params.capabilities);
      previous.revisionId = params.revisionId;
      previous.lastHeartbeatAt = now;
      this.logger.debug(
        `Runtime re-registered workspaceId=${params.workspaceId} runtimeSessionId=${params.runtimeSessionId}`,
      );
      this.notifyConnectionWaiters(params.workspaceId, previous);
      return null;
    }

    const connection: RuntimeConnection = {
      socket: params.socket,
      runtimeSessionId: params.runtimeSessionId,
      bindingId: params.bindingId,
      workspaceId: params.workspaceId,
      userId: params.userId,
      capabilities: normalizeCapabilities(params.capabilities),
      revisionId: params.revisionId,
      lastHeartbeatAt: now,
      // Keep the per-workspace queue across tab replacement too: the lock is
      // not socket-scoped, and the previous holder may still be settling.
      mutationLock: previous?.mutationLock ?? Promise.resolve(),
      lastHeartbeatFlushAt: now,
    };
    this.byWorkspace.set(params.workspaceId, connection);

    this.logger.debug(
      `Runtime registered workspaceId=${params.workspaceId} runtimeSessionId=${params.runtimeSessionId}`,
    );
    this.notifyConnectionWaiters(params.workspaceId, connection);

    return previous;
  }

  get(workspaceId: string): RuntimeConnection | null {
    return this.byWorkspace.get(workspaceId) ?? null;
  }

  /**
   * Wait until a non-stale browser connection is registered for `workspaceId`,
   * or until `timeoutMs` elapses. `timeoutMs <= 0` returns immediately.
   */
  waitForConnection(
    workspaceId: string,
    timeoutMs: number,
  ): Promise<RuntimeConnection | null> {
    const current = this.get(workspaceId);
    if (current && !this.isStale(current)) return Promise.resolve(current);
    if (timeoutMs <= 0) return Promise.resolve(null);

    return new Promise<RuntimeConnection | null>((resolve) => {
      let settled = false;
      let waiters = this.connectionWaiters.get(workspaceId);
      if (!waiters) {
        waiters = new Set();
        this.connectionWaiters.set(workspaceId, waiters);
      }

      const finish = (connection: RuntimeConnection | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        waiters.delete(onConnection);
        if (waiters.size === 0) this.connectionWaiters.delete(workspaceId);
        resolve(connection);
      };

      const onConnection = (connection: RuntimeConnection) => {
        if (!this.isStale(connection)) finish(connection);
      };

      waiters.add(onConnection);

      const timer = setTimeout(() => finish(null), timeoutMs);

      const raced = this.get(workspaceId);
      if (raced && !this.isStale(raced)) finish(raced);
    });
  }

  private notifyConnectionWaiters(
    workspaceId: string,
    connection: RuntimeConnection,
  ): void {
    const waiters = this.connectionWaiters.get(workspaceId);
    if (!waiters?.size) return;
    for (const waiter of [...waiters]) {
      try {
        waiter(connection);
      } catch {
        /* ignore waiter errors */
      }
    }
  }

  /** Only removes the entry when it still points at the given socket. */
  unregister(workspaceId: string, socketId: string): boolean {
    const current = this.byWorkspace.get(workspaceId);
    if (!current || current.socket.id !== socketId) return false;
    this.byWorkspace.delete(workspaceId);
    this.logger.debug(`Runtime unregistered workspaceId=${workspaceId}`);
    return true;
  }

  touch(workspaceId: string, revisionId?: string): RuntimeConnection | null {
    const connection = this.byWorkspace.get(workspaceId);
    if (!connection) return null;
    connection.lastHeartbeatAt = Date.now();
    if (revisionId) connection.revisionId = revisionId;
    return connection;
  }

  setRevision(workspaceId: string, revisionId: string): void {
    const connection = this.byWorkspace.get(workspaceId);
    if (connection) connection.revisionId = revisionId;
  }

  markHeartbeatFlushed(workspaceId: string, at: number): void {
    const connection = this.byWorkspace.get(workspaceId);
    if (connection) connection.lastHeartbeatFlushAt = at;
  }

  /**
   * Heartbeat staleness is evaluated on demand rather than swept by a timer:
   * the only consumer that cares is the tool dispatcher.
   */
  isStale(connection: RuntimeConnection, now = Date.now()): boolean {
    const timeoutMs = this.config.get<number>(
      'appRuntime.heartbeatTimeoutMs',
      45_000,
    );
    return now - connection.lastHeartbeatAt > timeoutMs;
  }

  /**
   * Serialize mutations per workspace. Concurrent mutations queue behind each
   * other instead of failing, and the caller aborts if the wait exceeds
   * `appRuntime.mutationWaitMs`.
   */
  async withMutationLock<T>(
    workspaceId: string,
    onTimeout: () => T,
    run: () => Promise<T>,
  ): Promise<T> {
    const connection = this.byWorkspace.get(workspaceId);
    if (!connection) return run();

    const waitMs = this.config.get<number>('appRuntime.mutationWaitMs', 30_000);
    const predecessor = connection.mutationLock;

    let release!: () => void;
    connection.mutationLock = new Promise<void>((resolve) => {
      release = resolve;
    });

    let timer: NodeJS.Timeout | undefined;
    const acquired = await Promise.race([
      predecessor.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), waitMs);
      }),
    ]);
    if (timer) clearTimeout(timer);

    if (!acquired) {
      // Stay in the queue and release only once the holder is done. Releasing
      // now would let whoever queued behind us run during the mutation, and
      // dropping our link would do the same to every later waiter.
      void predecessor.then(release, release);
      return onTimeout();
    }

    try {
      return await run();
    } finally {
      release();
    }
  }
}
