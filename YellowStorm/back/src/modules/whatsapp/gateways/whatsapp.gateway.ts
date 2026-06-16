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
    private readonly integrationService: WhatsAppIntegrationService,
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
    @MessageBody() body: { agentId?: string; sessionId?: string },
  ): Promise<{ ok: boolean }> {
    const userId = client.data.userId;
    if (!userId || !body?.agentId) {
      return { ok: false };
    }
    try {
      const integration = await this.integrationService.getDocumentByAgentForUser(
        userId,
        body.agentId,
      );
      const room = this.roomFor(userId, body.agentId);
      await client.join(room);

      if (body.sessionId && integration.sessionId === body.sessionId) {
        const snapshot = this.pairingCache.get(body.sessionId);
        if (snapshot?.qrCode) {
          this.emitToAgent(userId, body.agentId, 'whatsapp.qr.generated', {
            agentId: body.agentId,
            sessionId: body.sessionId,
            qrCode: snapshot.qrCode,
          });
        }
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
    this.server.to(this.roomFor(userId, agentId)).emit(event, payload);
  }

  private roomFor(userId: string, agentId: string): string {
    return `user:${userId}:agent:${agentId}`;
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
