import { Injectable, Logger } from '@nestjs/common';
import {
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import {
  APP_RUNTIME_NAMESPACE,
  AppRuntimeEvents,
  AppRuntimeSocketData,
  RuntimeHeartbeatPayload,
  RuntimeRegisterPayload,
  ToolCompletedPayload,
  ToolFailedPayload,
  ToolProgressPayload,
} from '../types/app-runtime-protocol';
import { RuntimeBindingService } from '../services/runtime-binding.service';
import { RuntimeConnectionRegistry } from '../services/runtime-connection.registry';
import { RuntimeTicketService } from '../services/runtime-ticket.service';
import { RuntimeToolDispatcherService } from '../services/runtime-tool-dispatcher.service';

/** Throttle for persisting heartbeats, so a chatty runtime does not hammer Mongo. */
const HEARTBEAT_FLUSH_INTERVAL_MS = 15_000;

export interface RuntimeSocket extends Socket {
  data: AppRuntimeSocketData;
}

/**
 * Bridges the browser runtime (Nodepod) to the server. Connections are
 * authenticated with a one-shot runtime ticket rather than a user JWT: the
 * ticket is already scoped to a single workspace and cannot be replayed.
 */
@WebSocketGateway({
  namespace: APP_RUNTIME_NAMESPACE,
  cors: { origin: true, credentials: true },
})
@Injectable()
export class AppRuntimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AppRuntimeGateway.name);

  constructor(
    private readonly tickets: RuntimeTicketService,
    private readonly bindings: RuntimeBindingService,
    private readonly registry: RuntimeConnectionRegistry,
    private readonly dispatcher: RuntimeToolDispatcherService,
  ) {}

  async handleConnection(client: RuntimeSocket): Promise<void> {
    const ticket = this.extractTicket(client);
    if (!ticket) {
      this.logger.warn(`app-runtime connection rejected: no ticket (${client.id})`);
      client.disconnect(true);
      return;
    }

    const consumed = await this.tickets.consume(ticket);
    if (!consumed) {
      // Covers unknown, expired and already consumed tickets alike.
      this.logger.warn(`app-runtime connection rejected: invalid ticket (${client.id})`);
      client.disconnect(true);
      return;
    }

    client.data = {
      runtimeSessionId: consumed.runtimeSessionId,
      bindingId: consumed.bindingId,
      workspaceId: consumed.workspaceId,
      userId: consumed.userId,
      registered: false,
    };

    this.logger.debug(
      `app-runtime client connected workspaceId=${consumed.workspaceId} runtimeSessionId=${consumed.runtimeSessionId}`,
    );
  }

  async handleDisconnect(client: RuntimeSocket): Promise<void> {
    const { workspaceId } = client.data ?? {};
    if (!workspaceId) return;

    const wasCurrent = this.registry.unregister(workspaceId, client.id);
    if (!wasCurrent) return;

    this.dispatcher.failPendingForWorkspace(
      workspaceId,
      'Browser runtime disconnected',
    );
    await this.bindings.markWaitingForBrowser(workspaceId);
  }

  @SubscribeMessage(AppRuntimeEvents.REGISTER)
  async handleRegister(
    @ConnectedSocket() client: RuntimeSocket,
    @MessageBody() payload: RuntimeRegisterPayload,
  ): Promise<{ ok: boolean; error?: string }> {
    const session = client.data;
    if (!session?.workspaceId) return { ok: false, error: 'UNAUTHENTICATED' };

    // The ticket, not the payload, decides which workspace this socket owns.
    if (
      payload?.workspaceId !== session.workspaceId ||
      payload?.runtimeSessionId !== session.runtimeSessionId
    ) {
      this.logger.warn(
        `app-runtime register rejected: session mismatch (${client.id})`,
      );
      client.disconnect(true);
      return { ok: false, error: 'SESSION_MISMATCH' };
    }

    const evicted = this.registry.register({
      socket: client,
      runtimeSessionId: session.runtimeSessionId,
      bindingId: session.bindingId,
      workspaceId: session.workspaceId,
      userId: session.userId,
      capabilities: payload.capabilities ?? {},
      revisionId: payload.revisionId || 'rev_0',
    });
    evicted?.socket.disconnect(true);

    client.data.registered = true;

    await this.bindings.markBrowserActive({
      workspaceId: session.workspaceId,
      browserRuntimeId: payload.browserRuntimeId ?? session.runtimeSessionId,
      capabilities: { ...payload.capabilities },
      lastHeartbeatAt: new Date(),
    });

    return { ok: true };
  }

  @SubscribeMessage(AppRuntimeEvents.HEARTBEAT)
  async handleHeartbeat(
    @ConnectedSocket() client: RuntimeSocket,
    @MessageBody() payload: RuntimeHeartbeatPayload,
  ): Promise<{ ok: boolean }> {
    const { workspaceId } = client.data ?? {};
    if (!workspaceId || payload?.workspaceId !== workspaceId) return { ok: false };

    const connection = this.registry.touch(workspaceId, payload.revisionId);
    if (!connection) return { ok: false };

    const now = Date.now();
    if (now - connection.lastHeartbeatFlushAt >= HEARTBEAT_FLUSH_INTERVAL_MS) {
      this.registry.markHeartbeatFlushed(workspaceId, now);
      await this.bindings.touchHeartbeat(workspaceId, new Date(now));
    }

    return { ok: true };
  }

  @SubscribeMessage(AppRuntimeEvents.TOOL_PROGRESS)
  handleToolProgress(
    @ConnectedSocket() client: RuntimeSocket,
    @MessageBody() payload: ToolProgressPayload,
  ): void {
    const { workspaceId } = client.data ?? {};
    if (workspaceId) this.dispatcher.handleProgress(workspaceId, payload);
  }

  @SubscribeMessage(AppRuntimeEvents.TOOL_COMPLETED)
  handleToolCompleted(
    @ConnectedSocket() client: RuntimeSocket,
    @MessageBody() payload: ToolCompletedPayload,
  ): void {
    const { workspaceId } = client.data ?? {};
    if (workspaceId) this.dispatcher.handleCompleted(workspaceId, payload);
  }

  @SubscribeMessage(AppRuntimeEvents.TOOL_FAILED)
  handleToolFailed(
    @ConnectedSocket() client: RuntimeSocket,
    @MessageBody() payload: ToolFailedPayload,
  ): void {
    const { workspaceId } = client.data ?? {};
    if (workspaceId) this.dispatcher.handleFailed(workspaceId, payload);
  }

  private extractTicket(client: Socket): string | undefined {
    const authTicket = client.handshake.auth?.ticket;
    if (typeof authTicket === 'string' && authTicket.length > 0) return authTicket;
    const header = client.handshake.headers['x-runtime-ticket'];
    if (typeof header === 'string' && header.length > 0) return header;
    return undefined;
  }
}
