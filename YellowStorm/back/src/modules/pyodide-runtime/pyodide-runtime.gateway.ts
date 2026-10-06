import {
  ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect,
  SubscribeMessage, WebSocketGateway,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { PyodideRuntimeRegistry } from './pyodide-runtime.registry';
import { PyodideRuntimeDispatcher } from './pyodide-runtime.dispatcher';
import {
  ExecutionCompletedPayload,
  ExecutionFailedPayload,
  ExecutionProgressPayload,
  PYODIDE_RUNTIME_NAMESPACE,
  PyodideErrorCode,
  PyodideRuntimeEvents,
  PyodideSocketData,
  RuntimeRegisterPayload,
} from './pyodide-runtime.types';

interface AuthedSocket extends Socket {
  data: PyodideSocketData;
}

@WebSocketGateway({ namespace: PYODIDE_RUNTIME_NAMESPACE, cors: { origin: true, credentials: true } })
@Injectable()
export class PyodideRuntimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(PyodideRuntimeGateway.name);

  constructor(
    private readonly registry: PyodideRuntimeRegistry,
    private readonly dispatcher: PyodideRuntimeDispatcher,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(client: AuthedSocket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      this.logger.warn(`pyodide-runtime connection rejected: no auth token (${client.id})`);
      client.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token, {
        secret: this.config.get<string>('jwt.secret'),
        issuer: this.config.get<string>('jwt.issuer'),
        audience: this.config.get<string>('jwt.audience'),
      });
      client.data = { ...client.data, userId: payload.sub };
    } catch (error) {
      this.logger.warn(`pyodide-runtime auth failed: ${(error as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthedSocket): void {
    const userId = client.data.userId;
    if (!userId) return;
    const wasCurrent = this.registry.unregister(userId, client.id);
    if (!wasCurrent) return;
    this.dispatcher.failForUser(
      userId,
      PyodideErrorCode.CONNECTION_LOST,
      'The browser Python runtime disconnected.',
    );
  }

  @SubscribeMessage(PyodideRuntimeEvents.RUNTIME_REGISTER)
  handleRegister(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: RuntimeRegisterPayload,
  ): { ok: boolean; error?: string } {
    const userId = client.data.userId;
    if (!userId) return { ok: false, error: 'UNAUTHENTICATED' };
    if (!this.config.get<boolean>('pyodideRuntime.enabled', false)) {
      return { ok: false, error: PyodideErrorCode.RUNTIME_OFFLINE };
    }
    if (!body.runtimeId) return { ok: false, error: 'BAD_REQUEST' };

    const evicted = this.registry.register({
      userId,
      socket: client,
      runtimeId: body.runtimeId,
      status: body.status ?? 'booting',
    });
    if (evicted) {
      evicted.socket.emit(PyodideRuntimeEvents.RUNTIME_REPLACED, { userId });
      evicted.socket.disconnect(true);
    }
    client.data.runtimeId = body.runtimeId;
    client.data.registered = true;
    return { ok: true };
  }

  @SubscribeMessage(PyodideRuntimeEvents.RUNTIME_HEARTBEAT)
  handleHeartbeat(@ConnectedSocket() client: AuthedSocket): { ok: boolean } {
    const userId = client.data.userId;
    if (!userId) return { ok: false };
    return { ok: Boolean(this.registry.touch(userId)) };
  }

  @SubscribeMessage(PyodideRuntimeEvents.EXECUTION_PROGRESS)
  handleProgress(@ConnectedSocket() client: AuthedSocket, @MessageBody() body: ExecutionProgressPayload): void {
    const userId = client.data.userId;
    if (userId) this.dispatcher.handleProgress(userId, body);
  }

  @SubscribeMessage(PyodideRuntimeEvents.EXECUTION_COMPLETED)
  handleCompleted(@ConnectedSocket() client: AuthedSocket, @MessageBody() body: ExecutionCompletedPayload): void {
    const userId = client.data.userId;
    if (userId) this.dispatcher.handleCompleted(userId, body);
  }

  @SubscribeMessage(PyodideRuntimeEvents.EXECUTION_FAILED)
  handleFailed(@ConnectedSocket() client: AuthedSocket, @MessageBody() body: ExecutionFailedPayload): void {
    const userId = client.data.userId;
    if (userId) this.dispatcher.handleFailed(userId, body);
  }

  private extractToken(client: Socket): string | undefined {
    const auth = client.handshake.auth as { token?: unknown } | undefined;
    const authToken = auth?.token;
    if (typeof authToken === 'string' && authToken.length > 0) return authToken;
    const header = client.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7);
    return undefined;
  }
}

