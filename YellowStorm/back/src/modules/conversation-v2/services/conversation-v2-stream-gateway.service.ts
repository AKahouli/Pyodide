import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

/**
 * A single open SSE pipe for a user (one browser tab/connection). The pipe is
 * a pure event channel — it carries events for ALL of the user's conversations,
 * each frame tagged with its `sessionId`. It is NOT tied to any one
 * conversation or to the request that sends a message, so navigating between
 * conversations on the client never tears down a running stream.
 */
interface SseConnection {
  connectionId: string;
  userId: string;
  res: Response;
}

/** A logical event pushed to a user's pipe. `data` carries the `sessionId`. */
export interface GatewayEvent {
  type: string;
  data: Record<string, unknown>;
}

/**
 * Per-user SSE connection registry for conversation-v2. Mirrors v1
 * `StreamGatewayService`: the background stream service pushes events here via
 * {@link sendToUser}, and they are written to every live pipe the user has
 * open. Decoupling the pipe from message-sending is what lets a single user
 * run multiple conversations at once and switch between them freely.
 */
@Injectable()
export class ConversationV2StreamGatewayService implements OnModuleDestroy {
  private readonly logger = new Logger(ConversationV2StreamGatewayService.name);
  private readonly connections = new Map<string, SseConnection>();
  private readonly userConnections = new Map<string, Set<string>>();

  constructor(private readonly config: ConfigService) {}

  onModuleDestroy(): void {
    for (const conn of this.connections.values()) {
      try {
        if (!(conn.res as Response & { writableEnded?: boolean }).writableEnded) {
          conn.res.end();
        }
      } catch {
        /* noop */
      }
    }
    this.connections.clear();
    this.userConnections.clear();
  }

  /**
   * Register a freshly-opened SSE response for a user. Returns `false` (without
   * registering) when the user is already at the configured connection cap, so
   * the controller can reject the connection.
   */
  registerConnection(userId: string, connectionId: string, res: Response): boolean {
    const max = this.config.get<number>('conversationV2.maxSseConnections') ?? 5;
    const userConns = this.userConnections.get(userId);
    if (userConns && userConns.size >= max) {
      this.logger.warn(`SSE connection limit reached for user ${userId} (max ${max})`);
      return false;
    }

    this.connections.set(connectionId, { connectionId, userId, res });
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    this.userConnections.get(userId)!.add(connectionId);
    this.logger.debug(`SSE pipe registered: user=${userId} connection=${connectionId}`);
    return true;
  }

  removeConnection(userId: string, connectionId: string): void {
    this.connections.delete(connectionId);
    const userConns = this.userConnections.get(userId);
    if (userConns) {
      userConns.delete(connectionId);
      if (userConns.size === 0) this.userConnections.delete(userId);
    }
    this.logger.debug(`SSE pipe removed: user=${userId} connection=${connectionId}`);
  }

  isUserConnected(userId: string): boolean {
    const conns = this.userConnections.get(userId);
    return !!conns && conns.size > 0;
  }

  /**
   * Write an event to every pipe the user has open. The frame is a named SSE
   * event (`event: <type>`) carrying JSON `data` — matching the frontend's
   * `addEventListener(type)` consumption. A write failure on one connection
   * removes just that connection; the others are unaffected.
   */
  sendToUser(userId: string, event: GatewayEvent): void {
    const userConns = this.userConnections.get(userId);
    if (!userConns || userConns.size === 0) return;

    const frame = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    for (const connectionId of [...userConns]) {
      const conn = this.connections.get(connectionId);
      if (!conn) continue;
      try {
        conn.res.write(frame);
        (conn.res as Response & { flush?: () => void }).flush?.();
      } catch (err) {
        this.logger.warn(
          `Failed writing to SSE pipe ${connectionId}: ${(err as Error).message}`,
        );
        this.removeConnection(userId, connectionId);
      }
    }
  }
}
