import { Injectable, OnModuleDestroy, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as QRCode from 'qrcode';
import pino from 'pino';
import { LoggerService } from '@modules/logger';
import { WorkyWhatsAppIngressService } from '@modules/worky/services/worky-whatsapp-ingress.service';
import { WorkyWhatsAppIntegrationService } from '@modules/worky/services/worky-whatsapp-integration.service';
import { WorkyWhatsAppSystemBotService } from '@modules/worky/services/worky-whatsapp-system-bot.service';
import { loadBaileys } from '../baileys/baileys-loader';
import { BaileysClientFactory } from '../baileys/baileys-client.factory';
import { MongoBaileysAuthStore } from '../baileys/mongo-auth-state';
import {
  WHATSAPP_NETWORK_UNREACHABLE_MESSAGE,
  isWhatsAppTransportError,
} from '../baileys/whatsapp-network.util';
import { WhatsAppGateway } from '../gateways/whatsapp.gateway';
import { WhatsAppIntegrationStatus } from '../schemas/agent-whatsapp-integration.schema';
import {
  toAgentIntegrationRef,
  toSystemBotIntegrationRef,
  toWorkyIntegrationRef,
  type WhatsAppIntegrationRef,
} from '../interfaces/whatsapp-integration-ref.interface';
import { WhatsAppConnectivityService } from './whatsapp-connectivity.service';
import { WhatsAppIntegrationService } from './whatsapp-integration.service';
import { WhatsAppMessageService } from './whatsapp-message.service';
import { WhatsAppPairingCacheService } from './whatsapp-pairing-cache.service';
import { WorkyWhatsAppGroupService } from './worky-whatsapp-group.service';
import { normalizeWhatsappUserJid } from '../utils/whatsapp-user-jid.util';
import {
  getWhatsAppAudioMimetype,
  isWhatsAppAudioMessage,
} from '../utils/whatsapp-audio-message.util';

interface ActiveWhatsAppSession {
  sessionId: string;
  integrationRef: WhatsAppIntegrationRef;
  socket: import('@whiskeysockets/baileys').WASocket;
  saveCreds: () => Promise<void>;
  pairingMode: boolean;
  credsMeJid?: string;
  /** JID of the Worky bridge group (populated after creation, e.g. 120363xxx@g.us). */
  workyGroupJid?: string;
}

@Injectable()
export class WhatsAppSessionManager implements OnModuleInit, OnModuleDestroy {
  private readonly sessions = new Map<string, ActiveWhatsAppSession>();
  private readonly reconnectAttempts = new Map<string, number>();
  private readonly reconnectTimers = new Map<string, NodeJS.Timeout>();
  private readonly baileysLogger = pino({ level: 'warn' });
  /** IDs of messages sent programmatically by the bot to a Worky group.
   *  Used to prevent re-ingesting our own outbound messages as owner input. */
  private readonly botSentMessageIds = new Set<string>();
  /** WhatsApp message IDs already ingested, to dedupe duplicate upserts
   *  (the same message can arrive via several `messages.upsert` events). */
  private readonly ingestedMessageIds = new Set<string>();

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly authStore: MongoBaileysAuthStore,
    private readonly clientFactory: BaileysClientFactory,
    private readonly connectivity: WhatsAppConnectivityService,
    private readonly pairingCache: WhatsAppPairingCacheService,
    private readonly agentIntegrationService: WhatsAppIntegrationService,
    private readonly workyIntegrationService: WorkyWhatsAppIntegrationService,
    private readonly systemBotService: WorkyWhatsAppSystemBotService,
    @Inject(forwardRef(() => WorkyWhatsAppGroupService))
    private readonly workyGroupService: WorkyWhatsAppGroupService,
    @Inject(forwardRef(() => WorkyWhatsAppIngressService))
    private readonly workyIngress: WorkyWhatsAppIngressService,
    private readonly messageService: WhatsAppMessageService,
    private readonly gateway: WhatsAppGateway,
  ) {
    this.logger.setContext(WhatsAppSessionManager.name);
  }

  async onModuleInit(): Promise<void> {
    if (!this.configService.get<boolean>('whatsapp.enabled', true)) {
      return;
    }

    const systemBot = await this.systemBotService.findConnected();
    if (systemBot?.sessionId && systemBot.pairedByUserId) {
      try {
        await this.openSocket(
          toSystemBotIntegrationRef(systemBot, systemBot.pairedByUserId),
          systemBot.sessionId,
          false,
        );
      } catch (error) {
        this.logger.warn('WhatsApp system bot session restore failed', {
          integrationId: systemBot._id.toString(),
          error: (error as Error).message,
        });
        await this.systemBotService.updateStatus(systemBot._id, {
          status: WhatsAppIntegrationStatus.FAILED,
          errorMessage: (error as Error).message,
        });
      }
    }

    const agentIntegrations = await this.agentIntegrationService.findConnectedIntegrations();
    for (const integration of agentIntegrations) {
      if (!integration.sessionId) continue;
      try {
        await this.openSocket(toAgentIntegrationRef(integration), integration.sessionId, false);
      } catch (error) {
        this.logger.warn('WhatsApp agent session restore failed', {
          integrationId: integration._id.toString(),
          error: (error as Error).message,
        });
        await this.agentIntegrationService.updateStatus(integration._id, {
          status: WhatsAppIntegrationStatus.FAILED,
          errorMessage: (error as Error).message,
        });
      }
    }

    const workyIntegrations = await this.workyIntegrationService.findConnectedIntegrations();
    for (const integration of workyIntegrations) {
      if (!integration.sessionId) continue;
      try {
        await this.openSocket(toWorkyIntegrationRef(integration), integration.sessionId, false);
      } catch (error) {
        this.logger.warn('WhatsApp Worky session restore failed', {
          integrationId: integration._id.toString(),
          error: (error as Error).message,
        });
        await this.workyIntegrationService.updateStatus(integration._id, {
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

  /** Returns the active Baileys socket for the Worky system bot, if connected. */
  getSystemBotSocket(): import('@whiskeysockets/baileys').WASocket | undefined {
    for (const active of this.sessions.values()) {
      if (active.integrationRef.kind === 'worky_system_bot') {
        return active.socket;
      }
    }
    return undefined;
  }

  /**
   * Sends `text` to the Worky bridge WhatsApp group via the system bot socket.
   * Tracks the sent message ID so user-session inbound can ignore echoes if needed.
   */
  async sendToWorkyGroup(streamId: string, text: string): Promise<void> {
    const groupJid = await this.workyGroupService.resolveGroupJid(streamId);
    if (!groupJid) {
      this.logger.warn('sendToWorkyGroup: no group JID for stream', { streamId });
      return;
    }

    const botSocket = this.getSystemBotSocket();
    if (!botSocket) {
      this.logger.warn('sendToWorkyGroup: system bot socket not active', { streamId });
      return;
    }

    try {
      const sent = await botSocket.sendMessage(groupJid, { text });
      this.logger.log('sendToWorkyGroup delivered via system bot', {
        streamId,
        groupJid,
        sentId: sent?.key?.id,
      });
      const msgId = sent?.key?.id;
      if (msgId) {
        this.botSentMessageIds.add(msgId);
        setTimeout(() => this.botSentMessageIds.delete(msgId), 60_000);
      }
    } catch (err) {
      this.logger.warn('sendToWorkyGroup failed', {
        streamId,
        groupJid,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async startPairing(integrationRef: WhatsAppIntegrationRef, sessionId: string): Promise<void> {
    this.cancelReconnect(sessionId);
    this.reconnectAttempts.set(sessionId, 0);
    await this.stopSession(sessionId, false);
    await this.openSocket(integrationRef, sessionId, true);
  }

  async reconnect(integrationRef: WhatsAppIntegrationRef, sessionId: string): Promise<void> {
    await this.updateIntegrationStatus(integrationRef, {
      status: WhatsAppIntegrationStatus.PAIRING,
      sessionId,
      errorMessage: undefined,
    });
    await this.startPairing(integrationRef, sessionId);
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
    integrationRef: WhatsAppIntegrationRef,
    sessionId: string,
    pairingMode: boolean,
  ): Promise<void> {
    const { state, saveCreds } = await this.authStore.createAuthState(integrationRef.integrationId);
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
      integrationRef,
      socket,
      saveCreds,
      pairingMode,
      credsMeJid: state.creds.me?.id,
      workyGroupJid: integrationRef.workyGroupJid,
    };
    this.sessions.set(sessionId, active);

    socket.ev.on('creds.update', () => {
      void saveCreds().catch((error) => {
        this.logger.error('WhatsApp creds save failed', {
          integrationId: integrationRef.integrationId.toString(),
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

    if (integrationRef.kind === 'agent') {
      socket.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') return;
        const sendReply = async (remoteJid: string, text: string): Promise<void> => {
          try {
            await socket.sendMessage(remoteJid, { text });
          } catch (sendError: unknown) {
            const msg = sendError instanceof Error ? sendError.message : String(sendError);
            this.logger.error('WhatsApp sendMessage failed', {
              integrationId: active.integrationRef.integrationId.toString(),
              remoteJid,
              error: msg,
            });
            throw sendError;
          }
        };
        void this.messageService
          .handleIncomingMessages(active.integrationRef, messages, sendReply)
          .catch((error: unknown) => {
            this.logger.error('WhatsApp messages.upsert failed', {
              integrationId: active.integrationRef.integrationId.toString(),
              error: error instanceof Error ? error.message : String(error),
            });
          });
      });
    }

    if (integrationRef.kind === 'worky_stream') {
      // Only live messages ('notify'); 'append' replays history and would
      // re-ingest the same message, producing duplicate planning turns.
      socket.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') return;
        const groupJid = active.workyGroupJid;
        if (!groupJid) return;
        for (const message of messages) {
          if (!message.key.fromMe) continue;
          if (message.key.remoteJid !== groupJid) continue;
          const msgId = message.key.id;
          // Skip echoes of messages the bot itself sent to avoid a planning loop.
          if (msgId && this.botSentMessageIds.has(msgId)) continue;
          // Dedupe duplicate upserts of the same inbound message.
          if (msgId && this.ingestedMessageIds.has(msgId)) continue;
          const text = this.extractMessageText(message);
          const streamId = active.integrationRef.workyStreamId?.toString();
          const userId = active.integrationRef.userId.toString();
          if (!streamId) continue;

          if (text) {
            this.markWorkyMessageIngested(msgId);
            void this.workyIngress
              .ingestMessage({ streamId, userId, content: text })
              .catch((err: unknown) => {
                this.logger.error('Worky WhatsApp group message ingress failed', {
                  integrationId: active.integrationRef.integrationId.toString(),
                  error: err instanceof Error ? err.message : String(err),
                });
              });
            continue;
          }

          if (isWhatsAppAudioMessage(message)) {
            this.markWorkyMessageIngested(msgId);
            void this.ingestWorkyStreamVoiceMessage(active, message, streamId, userId).catch(
              (err: unknown) => {
                this.logger.error('Worky WhatsApp voice ingress failed', {
                  integrationId: active.integrationRef.integrationId.toString(),
                  streamId,
                  error: err instanceof Error ? err.message : String(err),
                });
              },
            );
            continue;
          }

          this.logger.warn('Worky WhatsApp ingress drop: unsupported message type', {
            streamId,
            messageId: msgId,
          });
        }
      });
    }
  }

  private async handleConnectionUpdate(
    active: ActiveWhatsAppSession,
    update: Partial<import('@whiskeysockets/baileys').ConnectionState>,
  ): Promise<void> {
    const { integrationRef, sessionId, pairingMode } = active;
    const userId = integrationRef.userId.toString();

    if (update.qr) {
      const qrCode = await QRCode.toDataURL(update.qr);
      this.pairingCache.set(sessionId, { qrCode });
      this.emitPairingEvent(userId, integrationRef, sessionId, 'whatsapp.qr.generated', {
        qrCode,
      });
    }

    if (update.connection === 'open') {
      this.reconnectAttempts.delete(sessionId);
      this.cancelReconnect(sessionId);
      active.pairingMode = false;
      const phoneNumber =
        this.formatPhone(active.socket.user?.id) ?? this.formatPhone(active.credsMeJid);
      const displayName =
        active.socket.user?.name ?? active.socket.user?.verifiedName ?? undefined;

      if (phoneNumber) {
        active.integrationRef.phoneNumber = phoneNumber;
      }

      this.applyIntegrationRefPatch(active.integrationRef, {
        status: WhatsAppIntegrationStatus.CONNECTED,
        phoneNumber,
        sessionId,
      });
      this.logger.log('WhatsApp session connected', {
        sessionId,
        kind: integrationRef.kind,
        phoneNumber,
      });

      if (integrationRef.kind === 'worky_system_bot') {
        try {
          await this.systemBotService.assertExpectedPhone(phoneNumber);
        } catch (phoneError) {
          const message =
            phoneError instanceof Error ? phoneError.message : 'Phone number mismatch';
          await this.stopSession(sessionId, true);
          await this.authStore.deleteAuthState(integrationRef.integrationId);
          await this.updateIntegrationStatus(integrationRef, {
            status: WhatsAppIntegrationStatus.FAILED,
            errorMessage: message,
          });
          this.emitPairingEvent(userId, integrationRef, sessionId, 'whatsapp.session.failed', {
            errorMessage: message,
          });
          return;
        }
      }

      if (integrationRef.kind === 'worky_stream') {
        void this.setupWorkyStreamGroup(active, phoneNumber).catch(async (err: unknown) => {
          const errorMessage = err instanceof Error ? err.message : String(err);
          this.logger.error('Worky WhatsApp group setup failed', {
            integrationId: integrationRef.integrationId.toString(),
            error: errorMessage,
          });
          await this.updateIntegrationStatus(integrationRef, {
            status: WhatsAppIntegrationStatus.FAILED,
            errorMessage,
          });
          this.emitPairingEvent(userId, integrationRef, sessionId, 'whatsapp.session.failed', {
            errorMessage,
          });
        });
      }

      await this.updateIntegrationStatus(integrationRef, {
        status: WhatsAppIntegrationStatus.CONNECTED,
        phoneNumber,
        displayName,
        sessionId,
        errorMessage: undefined,
      });
      this.pairingCache.clear(sessionId);
      this.emitPairingEvent(userId, integrationRef, sessionId, 'whatsapp.connected', {
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
      await this.authStore.deleteAuthState(integrationRef.integrationId);
      this.applyIntegrationRefPatch(integrationRef, {
        status: WhatsAppIntegrationStatus.DISCONNECTED,
      });
      await this.updateIntegrationStatus(integrationRef, {
        status: WhatsAppIntegrationStatus.DISCONNECTED,
        errorMessage: 'Logged out from WhatsApp',
      });
      this.emitPairingEvent(userId, integrationRef, sessionId, 'whatsapp.disconnected', {});
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
        await this.updateIntegrationStatus(integrationRef, {
          status: WhatsAppIntegrationStatus.FAILED,
          errorMessage: WHATSAPP_NETWORK_UNREACHABLE_MESSAGE,
        });
        this.emitPairingEvent(userId, integrationRef, sessionId, 'whatsapp.session.failed', {
          errorMessage: WHATSAPP_NETWORK_UNREACHABLE_MESSAGE,
        });
        return;
      }
    }

    if (shouldRetry && attempt <= maxAttempts) {
      this.reconnectAttempts.set(sessionId, attempt);
      const delay = this.reconnectDelay(attempt);
      this.logger.warn('WhatsApp reconnect scheduled', {
        sessionId,
        attempt,
        delayMs: delay,
        statusCode,
        errorMessage,
        pairingMode,
      });
      this.cancelReconnect(sessionId);
      const timer = setTimeout(() => {
        this.reconnectTimers.delete(sessionId);
        void this.openSocket(integrationRef, sessionId, pairingMode).catch((error) => {
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
    this.applyIntegrationRefPatch(integrationRef, {
      status: WhatsAppIntegrationStatus.FAILED,
    });
    await this.updateIntegrationStatus(integrationRef, {
      status: WhatsAppIntegrationStatus.FAILED,
      errorMessage,
    });
    this.emitPairingEvent(userId, integrationRef, sessionId, 'whatsapp.session.failed', {
      errorMessage,
    });
  }

  private emitPairingEvent(
    userId: string,
    integrationRef: WhatsAppIntegrationRef,
    sessionId: string,
    event: string,
    payload: Record<string, unknown>,
  ): void {
    if (integrationRef.kind === 'agent' && integrationRef.agentId) {
      this.gateway.emitToAgent(userId, integrationRef.agentId.toString(), event, {
        agentId: integrationRef.agentId.toString(),
        sessionId,
        ...payload,
      });
      return;
    }
    if (integrationRef.kind === 'worky_stream' && integrationRef.workyStreamId) {
      this.gateway.emitToWorkyStream(
        userId,
        integrationRef.workyStreamId.toString(),
        event,
        {
          streamId: integrationRef.workyStreamId.toString(),
          sessionId,
          ...payload,
        },
      );
      return;
    }
    if (integrationRef.kind === 'worky_system_bot') {
      this.gateway.emitToSystemBot(userId, event, {
        sessionId,
        ...payload,
      });
    }
  }

  private applyIntegrationRefPatch(
    integrationRef: WhatsAppIntegrationRef,
    patch: Partial<Pick<WhatsAppIntegrationRef, 'status' | 'phoneNumber' | 'sessionId'>>,
  ): void {
    if (patch.status !== undefined) {
      integrationRef.status = patch.status;
    }
    if (patch.phoneNumber !== undefined) {
      integrationRef.phoneNumber = patch.phoneNumber;
    }
    if (patch.sessionId !== undefined) {
      integrationRef.sessionId = patch.sessionId;
    }
  }

  private async updateIntegrationStatus(
    integrationRef: WhatsAppIntegrationRef,
    patch: Partial<{
      status: WhatsAppIntegrationStatus;
      sessionId: string;
      phoneNumber: string;
      displayName: string;
      errorMessage: string;
      lastActivityAt: Date;
    }>,
  ): Promise<void> {
    if (integrationRef.kind === 'agent') {
      await this.agentIntegrationService.updateStatus(integrationRef.integrationId, patch);
      return;
    }
    if (integrationRef.kind === 'worky_system_bot') {
      await this.systemBotService.updateStatus(integrationRef.integrationId, patch);
      return;
    }
    await this.workyIntegrationService.updateStatus(integrationRef.integrationId, patch);
  }

  private async setupWorkyStreamGroup(
    active: ActiveWhatsAppSession,
    phoneNumber: string | undefined,
  ): Promise<void> {
    const { integrationRef } = active;
    if (integrationRef.kind !== 'worky_stream' || !integrationRef.workyStreamId) {
      return;
    }

    await this.systemBotService.assertConnected();

    const streamId = integrationRef.workyStreamId.toString();
    const userId = integrationRef.userId.toString();
    const rawUserJid = active.socket.user?.id ?? active.credsMeJid;
    if (!rawUserJid) {
      throw new Error('User WhatsApp JID unavailable after connect');
    }
    const userJid = normalizeWhatsappUserJid(rawUserJid);

    await this.workyIntegrationService.updateUserWhatsappJid(
      integrationRef.integrationId,
      userJid,
    );

    if (active.workyGroupJid) {
      return;
    }

    const existingJid = await this.workyGroupService.resolveGroupJid(streamId);
    if (existingJid) {
      active.workyGroupJid = existingJid;
      active.integrationRef.workyGroupJid = existingJid;
      return;
    }

    const { groupJid } = await this.workyGroupService.provisionBridgeGroup({
      streamId,
      userId,
      integrationId: integrationRef.integrationId,
      userJid,
    });
    active.workyGroupJid = groupJid;
    active.integrationRef.workyGroupJid = groupJid;

    this.logger.log('Worky stream group ready', {
      streamId,
      groupJid,
      phoneNumber,
    });
  }

  private markWorkyMessageIngested(msgId: string | null | undefined): void {
    if (!msgId) return;
    this.ingestedMessageIds.add(msgId);
    setTimeout(() => this.ingestedMessageIds.delete(msgId), 5 * 60_000);
  }

  private async ingestWorkyStreamVoiceMessage(
    active: ActiveWhatsAppSession,
    message: import('@whiskeysockets/baileys').WAMessage,
    streamId: string,
    userId: string,
  ): Promise<void> {
    const baileys = await loadBaileys();
    const downloaded = await baileys.downloadMediaMessage(
      message,
      'buffer',
      {},
      {
        logger: this.baileysLogger,
        reuploadRequest: active.socket.updateMediaMessage,
      },
    );
    if (!Buffer.isBuffer(downloaded) || !downloaded.length) {
      this.logger.warn('Worky WhatsApp voice drop: empty download', {
        streamId,
        messageId: message.key.id,
      });
      return;
    }

    const mimetype = getWhatsAppAudioMimetype(message) ?? 'audio/ogg; codecs=opus';
    await this.workyIngress.ingestAudioMessage({
      streamId,
      userId,
      audio: downloaded,
      mimetype,
    });
  }

  private extractMessageText(
    message: import('@whiskeysockets/baileys').WAMessage,
  ): string | undefined {
    const content = message.message;
    if (!content) return undefined;
    const text =
      content.conversation ??
      content.extendedTextMessage?.text ??
      content.ephemeralMessage?.message?.conversation ??
      content.ephemeralMessage?.message?.extendedTextMessage?.text;
    return text?.trim() || undefined;
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
