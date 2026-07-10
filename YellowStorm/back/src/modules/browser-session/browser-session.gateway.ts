import {
  ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect,
  SubscribeMessage, WebSocketGateway,
} from '@nestjs/websockets';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { LoggerService } from '../logger';
import { BrowserSessionService } from './browser-session.service';
import { InputEvent, NavAction } from './browser-session.types';

interface AuthedSocket extends Socket {
  data: { userId?: string; sessionId?: string };
}

@WebSocketGateway({ namespace: '/browser-session', cors: { origin: true, credentials: true } })
@Injectable()
export class BrowserSessionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(
    private readonly sessions: BrowserSessionService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(BrowserSessionGateway.name);
  }

  async handleConnection(client: AuthedSocket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) { client.disconnect(true); return; }
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token, {
        secret: this.config.get<string>('jwt.secret'),
        issuer: this.config.get<string>('jwt.issuer'),
        audience: this.config.get<string>('jwt.audience'),
      });
      client.data.userId = payload.sub;
    } catch (e) {
      this.logger.warn('browser-session auth failed', { error: (e as Error).message });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthedSocket): void {
    if (client.data.sessionId) void this.sessions.destroy(client.data.sessionId);
  }

  @SubscribeMessage('start')
  async handleStart(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { url: string },
  ): Promise<{ ok: true; sessionId: string } | { ok: false; error: string }> {
    const userId = client.data.userId;
    if (!userId || !body?.url) return { ok: false, error: 'BAD_REQUEST' };
    try {
      const sessionId = await this.sessions.create(userId, body.url, (event, payload) => {
        client.emit(event, payload);
      });
      client.data.sessionId = sessionId;
      return { ok: true, sessionId };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  @SubscribeMessage('input')
  async handleInput(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { event: InputEvent },
  ): Promise<void> {
    if (client.data.sessionId) await this.sessions.dispatchInput(client.data.sessionId, body.event);
  }

  @SubscribeMessage('navigate')
  async handleNavigate(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { action: NavAction },
  ): Promise<{ ok: boolean; error?: string }> {
    if (!client.data.sessionId) return { ok: false, error: 'NO_SESSION' };
    try {
      await this.sessions.navigate(client.data.sessionId, body.action);
      return { ok: true };
    } catch (e) {
      client.emit('blocked', { url: body.action.kind === 'goto' ? body.action.url : '', reason: (e as Error).message });
      return { ok: false, error: (e as Error).message };
    }
  }

  private extractToken(client: Socket): string | undefined {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.length > 0) return authToken;
    const header = client.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7);
    return undefined;
  }
}
