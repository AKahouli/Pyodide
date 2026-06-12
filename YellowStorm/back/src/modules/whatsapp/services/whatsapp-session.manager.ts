import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import * as QRCode from 'qrcode';
import pino from 'pino';
import { LoggerService } from '@modules/logger';
import { loadBaileys } from '../baileys/baileys-loader';
import { BaileysClientFactory } from '../baileys/baileys-client.factory';
import { MongoBaileysAuthStore } from '../baileys/mongo-auth-state';
import {
  WHATSAPP_NETWORK_UNREACHABLE_MESSAGE,
  isWhatsAppTransportError,
} from '../baileys/whatsapp-network.util';
import { WhatsAppGateway } from '../gateways/whatsapp.gateway';
import {
  AgentWhatsAppIntegrationDocument,
  WhatsAppIntegrationStatus,
} from '../schemas/agent-whatsapp-integration.schema';
import { WhatsAppConnectivityService } from './whatsapp-connectivity.service';
import { WhatsAppIntegrationService } from './whatsapp-integration.service';
import { WhatsAppMessageService } from './whatsapp-message.service';
import { WhatsAppPairingCacheService } from './whatsapp-pairing-cache.service';

interface ActiveWhatsAppSession {
  sessionId: string;
  integration: AgentWhatsAppIntegrationDocument;
  socket: import('@whiskeysockets/baileys').WASocket;
  saveCreds: () => Promise<void>;
  pairingMode: boolean;
}

@Injectable()
export class WhatsAppSessionManager implements OnModuleInit, OnModuleDestroy {
  private readonly sessions = new Map<string, ActiveWhatsAppSession>();
  private readonly reconnectAttempts = new Map<string, number>();
  private readonly reconnectTimers = new Map<string, NodeJS.Timeout>();
  private readonly baileysLogger = pino({ level: 'warn' });

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly authStore: MongoBaileysAuthStore,
    private readonly clientFactory: BaileysClientFactory,
    private readonly connectivity: WhatsAppConnectivityService,
    private readonly pairingCache: WhatsAppPairingCacheService,
    private readonly integrationService: WhatsAppIntegrationService,
    private readonly messageService: WhatsAppMessageService,
    private readonly gateway: WhatsAppGateway,
  ) {
    this.logger.setContext(WhatsAppSessionManager.name);
  }

  async onModuleInit(): Promise<void> {
    if (!this.configService.get<boolean>('whatsapp.enabled', true)) {
      return;
    }
    const integrations = await this.integrationService.findConnectedIntegrations();
    for (const integration of integrations) {
      if (!integration.sessionId) continue;
      try {
        await this.openSocket(integration, integration.sessionId, false);
      } catch (error) {
        this.logger.warn('WhatsApp session restore failed', {
          integrationId: integration._id.toString(),
          error: (error as Error).message,
        });
        await this.integrationService.updateStatus(integration._id, {
          status: WhatsAppIntegrationStatus.FAILED,
          errorMessage: (error as Error).message,
        });
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const sessionId of [...this.sessions.keys()]) {
      await this.stopSession(sessionId, false);
    }
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
  }

  getPairingSnapshot(sessionId: string) {
    return this.pairingCache.get(sessionId);
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  async startPairing(
    integration: AgentWhatsAppIntegrationDocument,
    sessionId: string,
  ): Promise<void> {
    this.cancelReconnect(sessionId);
    this.reconnectAttempts.set(sessionId, 0);
    await this.stopSession(sessionId, false);
    await this.openSocket(integration, sessionId, true);
  }

  async reconnect(
    integration: AgentWhatsAppIntegrationDocument,
    sessionId: string,
  ): Promise<void> {
    await this.integrationService.updateStatus(integration._id, {
      status: WhatsAppIntegrationStatus.PAIRING,
      sessionId,
      errorMessage: undefined,
    });
    await this.startPairing(integration, sessionId);
  }

  async stopSession(sessionId: string, logout: boolean): Promise<void> {
    this.cancelReconnect(sessionId);
    const active = this.sessions.get(sessionId);
    if (!active) {
      return;
    }
    this.sessions.delete(sessionId);
    try {
      if (logout) {
        await active.socket.logout();
      } else {
        active.socket.end(undefined);
      }
    } catch (error) {
      this.logger.warn('WhatsApp socket close error', {
        sessionId,
        error: (error as Error).message,
      });
    }
  }

  private cancelReconnect(sessionId: string): void {
    const timer = this.reconnectTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(sessionId);
    }
  }

  private async openSocket(
    integration: AgentWhatsAppIntegrationDocument,
    sessionId: string,
    pairingMode: boolean,
  ): Promise<void> {
    const { state, saveCreds } = await this.authStore.createAuthState(integration._id);
    const socket = await this.clientFactory.createSocket({
      auth: state,
      baileysLogger: this.baileysLogger,
      probeTimeoutMs: this.configService.get<number>(
        'whatsapp.connectivityProbeTimeoutMs',
        10000,
      ),
    });

    const active: ActiveWhatsAppSession = {
      sessionId,
      integration,
      socket,
      saveCreds,
      pairingMode,
    };
    this.sessions.set(sessionId, active);

    socket.ev.on('creds.update', () => {
      void saveCreds().catch((error) => {
        this.logger.error('WhatsApp creds save failed', {
          integrationId: integration._id.toString(),
          error: (error as Error).message,
        });
      });
    });

    socket.ev.on('connection.update', (update) => {
      void this.handleConnectionUpdate(active, update).catch((error) => {
        this.logger.error('WhatsApp connection.update handler failed', {
          sessionId,
          error: (error as Error).message,
        });
      });
    });

    socket.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;
      const sendReply = async (remoteJid: string, text: string): Promise<void> => {
        try {
          await socket.sendMessage(remoteJid, { text });
        } catch (sendError: unknown) {
          const msg = sendError instanceof Error ? sendError.message : String(sendError);
          this.logger.error('WhatsApp sendMessage failed', {
            integrationId: integration._id.toString(),
            remoteJid,
            error: msg,
          });
          throw sendError;
        }
      };
      void this.messageService
        .handleIncomingMessages(integration._id, messages, sendReply)
        .catch((error: unknown) => {
          this.logger.error('WhatsApp messages.upsert failed', {
            integrationId: integration._id.toString(),
            error: error instanceof Error ? error.message : String(error),
          });
        });
    });
  }

  private async handleConnectionUpdate(
    active: ActiveWhatsAppSession,
    update: Partial<import('@whiskeysockets/baileys').ConnectionState>,
  ): Promise<void> {
    const { integration, sessionId, pairingMode } = active;
    const userId = integration.userId.toString();
    const agentId = integration.agentId.toString();

    if (update.qr) {
      const qrCode = await QRCode.toDataURL(update.qr);
      this.pairingCache.set(sessionId, { qrCode });
      this.gateway.emitToAgent(userId, agentId, 'whatsapp.qr.generated', {
        agentId,
        sessionId,
        qrCode,
      });
    }

    if (update.connection === 'open') {
      this.reconnectAttempts.delete(sessionId);
      this.cancelReconnect(sessionId);
      const phoneNumber = this.formatPhone(active.socket.user?.id);
      const displayName =
        active.socket.user?.name ?? active.socket.user?.verifiedName ?? undefined;
      await this.integrationService.updateStatus(integration._id, {
        status: WhatsAppIntegrationStatus.CONNECTED,
        phoneNumber,
        displayName,
        sessionId,
        errorMessage: undefined,
      });
      this.pairingCache.clear(sessionId);
      this.gateway.emitToAgent(userId, agentId, 'whatsapp.connected', {
        agentId,
        sessionId,
        phoneNumber,
        displayName,
      });
      return;
    }

    if (update.connection !== 'close') return;

    const baileys = await loadBaileys();
    const statusCode = (update.lastDisconnect?.error as { output?: { statusCode?: number } })
      ?.output?.statusCode;
    const errorMessage = update.lastDisconnect?.error?.message ?? 'Connection closed';
    const loggedOut = statusCode === baileys.DisconnectReason.loggedOut;

    this.sessions.delete(sessionId);

    if (loggedOut) {
      this.pairingCache.clear(sessionId);
      this.reconnectAttempts.delete(sessionId);
      await this.authStore.deleteAuthState(integration._id);
      await this.integrationService.updateStatus(integration._id, {
        status: WhatsAppIntegrationStatus.DISCONNECTED,
        errorMessage: 'Logged out from WhatsApp',
      });
      this.gateway.emitToAgent(userId, agentId, 'whatsapp.disconnected', { agentId, sessionId });
      return;
    }

    const shouldRetry = pairingMode || statusCode === baileys.DisconnectReason.restartRequired;
    const attempt = (this.reconnectAttempts.get(sessionId) ?? 0) + 1;
    const maxAttempts = this.maxReconnectAttempts();

    if (isWhatsAppTransportError(errorMessage)) {
      const probe = await this.connectivity.probeWhatsAppServers(true);
      if (!probe.reachable) {
        this.pairingCache.clear(sessionId);
        this.reconnectAttempts.delete(sessionId);
        await this.integrationService.updateStatus(integration._id, {
          status: WhatsAppIntegrationStatus.FAILED,
          errorMessage: WHATSAPP_NETWORK_UNREACHABLE_MESSAGE,
        });
        this.gateway.emitToAgent(userId, agentId, 'whatsapp.session.failed', {
          agentId,
          sessionId,
          errorMessage: WHATSAPP_NETWORK_UNREACHABLE_MESSAGE,
        });
        return;
      }
    }

    if (shouldRetry && attempt <= maxAttempts) {
      this.reconnectAttempts.set(sessionId, attempt);
      const delay = this.reconnectDelay(attempt);
      this.logger.warn('WhatsApp pairing reconnect scheduled', {
        sessionId,
        attempt,
        delayMs: delay,
        statusCode,
        errorMessage,
      });
      this.cancelReconnect(sessionId);
      const timer = setTimeout(() => {
        this.reconnectTimers.delete(sessionId);
        void this.openSocket(integration, sessionId, pairingMode).catch((error) => {
          this.logger.error('WhatsApp reconnect openSocket failed', {
            sessionId,
            error: (error as Error).message,
          });
        });
      }, delay);
      this.reconnectTimers.set(sessionId, timer);
      return;
    }

    this.pairingCache.clear(sessionId);
    this.reconnectAttempts.delete(sessionId);
    await this.integrationService.updateStatus(integration._id, {
      status: WhatsAppIntegrationStatus.FAILED,
      errorMessage,
    });
    this.gateway.emitToAgent(userId, agentId, 'whatsapp.session.failed', {
      agentId,
      sessionId,
      errorMessage,
    });
  }

  private formatPhone(jid: string | undefined): string | undefined {
    if (!jid) return undefined;

    const atIndex = jid.indexOf('@');
    if (atIndex <= 0) return undefined;

    const server = jid.slice(atIndex + 1);
    if (server !== 's.whatsapp.net' && server !== 'c.us') {
      return undefined;
    }

    const userPart = jid.slice(0, atIndex).split(':')[0];
    const digits = userPart.replace(/\D/g, '');
    return digits ? `+${digits}` : undefined;
  }

  private maxReconnectAttempts(): number {
    return this.configService.get<number>('whatsapp.reconnectMaxAttempts', 10);
  }

  private reconnectDelay(attempt: number): number {
    const initial = this.configService.get<number>('whatsapp.reconnectInitialDelayMs', 1000);
    const max = this.configService.get<number>('whatsapp.reconnectMaxDelayMs', 120000);
    return Math.min(initial * 2 ** (attempt - 1), max);
  }
}
