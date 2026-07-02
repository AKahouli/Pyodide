import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { LoggerService } from '@modules/logger';
import { WorkyWhatsAppIntegrationService } from '@modules/worky/services/worky-whatsapp-integration.service';
import { WorkyWhatsAppSystemBotService } from '@modules/worky/services/worky-whatsapp-system-bot.service';
import { WhatsAppIntegrationService } from '../services/whatsapp-integration.service';
import { WhatsAppPairingCacheService } from '../services/whatsapp-pairing-cache.service';

interface AuthenticatedSocket extends Socket {
  data: {
    userId?: string;
  };
}

@WebSocketGateway({
  namespace: '/whatsapp',
  cors: {
    origin: true,
    credentials: true,
  },
})
@Injectable()
export class WhatsAppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly agentIntegrationService: WhatsAppIntegrationService,
    private readonly workyIntegrationService: WorkyWhatsAppIntegrationService,
    private readonly systemBotService: WorkyWhatsAppSystemBotService,
    private readonly pairingCache: WhatsAppPairingCacheService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WhatsAppGateway.name);
  }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(token, {
        secret: this.configService.get<string>('jwt.secret'),
        issuer: this.configService.get<string>('jwt.issuer'),
        audience: this.configService.get<string>('jwt.audience'),
      });
      client.data.userId = payload.sub;
    } catch (error) {
      this.logger.warn('WhatsApp socket auth failed', { error: (error as Error).message });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    this.logger.debug('WhatsApp socket disconnected', { socketId: client.id });
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    body: { agentId?: string; streamId?: string; sessionId?: string; systemBot?: boolean },
  ): Promise<{ ok: boolean }> {
    const userId = client.data.userId;
    if (!userId || !body?.sessionId) {
      return { ok: false };
    }

    try {
      if (body.systemBot) {
        const integration = await this.systemBotService.getDocumentBySession(body.sessionId);
        const room = this.roomForSystemBot(userId);
        await client.join(room);
        if (integration.sessionId === body.sessionId) {
          this.replayCachedQrSystemBot(body.sessionId, room);
        }
        return { ok: true };
      }

      if (body.streamId) {
        const integration = await this.workyIntegrationService.getDocumentByStreamForUser(
          userId,
          body.streamId,
        );
        const room = this.roomForWorky(userId, body.streamId);
        await client.join(room);
        if (integration.sessionId === body.sessionId) {
          this.replayCachedQr(body.streamId, body.sessionId, room, 'streamId');
        }
        return { ok: true };
      }

      if (!body.agentId) {
        return { ok: false };
      }

      const integration = await this.agentIntegrationService.getDocumentByAgentForUser(
        userId,
        body.agentId,
      );
      const room = this.roomForAgent(userId, body.agentId);
      await client.join(room);
      if (integration.sessionId === body.sessionId) {
        this.replayCachedQr(body.agentId, body.sessionId, room, 'agentId');
      }
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  emitToAgent(
    userId: string,
    agentId: string,
    event: string,
    payload: Record<string, unknown>,
  ): void {
    if (!this.server) return;
    this.server.to(this.roomForAgent(userId, agentId)).emit(event, payload);
  }

  emitToWorkyStream(
    userId: string,
    streamId: string,
    event: string,
    payload: Record<string, unknown>,
  ): void {
    if (!this.server) return;
    this.server.to(this.roomForWorky(userId, streamId)).emit(event, payload);
  }

  emitToSystemBot(userId: string, event: string, payload: Record<string, unknown>): void {
    if (!this.server) return;
    this.server.to(this.roomForSystemBot(userId)).emit(event, payload);
  }

  private replayCachedQrSystemBot(sessionId: string, room: string): void {
    const snapshot = this.pairingCache.get(sessionId);
    if (!snapshot?.qrCode || !this.server) return;
    this.server.to(room).emit('whatsapp.qr.generated', {
      systemBot: true,
      sessionId,
      qrCode: snapshot.qrCode,
    });
  }

  private replayCachedQr(
    targetId: string,
    sessionId: string,
    room: string,
    idField: 'agentId' | 'streamId',
  ): void {
    const snapshot = this.pairingCache.get(sessionId);
    if (!snapshot?.qrCode || !this.server) return;
    this.server.to(room).emit('whatsapp.qr.generated', {
      [idField]: targetId,
      sessionId,
      qrCode: snapshot.qrCode,
    });
  }

  private roomForAgent(userId: string, agentId: string): string {
    return `user:${userId}:agent:${agentId}`;
  }

  private roomForWorky(userId: string, streamId: string): string {
    return `user:${userId}:worky:${streamId}`;
  }

  private roomForSystemBot(userId: string): string {
    return `user:${userId}:worky:system-bot`;
  }

  private extractToken(client: Socket): string | undefined {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.length > 0) {
      return authToken;
    }
    const header = client.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice(7);
    }
    return undefined;
  }
}
