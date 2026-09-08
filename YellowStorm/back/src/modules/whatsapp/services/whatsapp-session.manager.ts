import { Injectable, OnModuleDestroy, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as QRCode from 'qrcode';
import pino from 'pino';
import { Types } from 'mongoose';
import { LoggerService } from '@modules/logger';
import { ConflictException, ErrorCode } from '@modules/exceptions';
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
import type { WhatsAppIntegrationResponseDto } from '../dto/whatsapp-integration-response.dto';
import { WhatsAppConnectivityService } from './whatsapp-connectivity.service';
import { WhatsAppIntegrationSseService } from './whatsapp-integration-sse.service';
import { WhatsAppIntegrationService } from './whatsapp-integration.service';
import { WhatsAppMessageService } from './whatsapp-message.service';
import { WhatsAppPairingCacheService } from './whatsapp-pairing-cache.service';
import { WorkyWhatsAppGroupService } from './worky-whatsapp-group.service';
import {
  resolveStatusAfterReconnectExhausted,
  shouldAutoReconnectAfterDisconnect,
} from '../utils/whatsapp-reconnect.util';
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
    private readonly integrationSse: WhatsAppIntegrationSseService,
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
      this.restoreConnectedIntegration(
        toSystemBotIntegrationRef(systemBot, systemBot.pairedByUserId),
        systemBot.sessionId,
      );
    }

    const agentIntegrations = await this.agentIntegrationService.findConnectedIntegrations();
    for (const integration of agentIntegrations) {
      if (!integration.sessionId) continue;
      this.restoreConnectedIntegration(toAgentIntegrationRef(integration), integration.sessionId);
    }

    const workyIntegrations = await this.workyIntegrationService.findConnectedIntegrations();
    for (const integration of workyIntegrations) {
      if (!integration.sessionId) continue;
      this.restoreConnectedIntegration(toWorkyIntegrationRef(integration), integration.sessionId);
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

  /**
   * Sends a proactive outbound text on an agent's paired session (internal
   * send endpoint / MCP façade). Returns the WhatsApp message id.
   * Throws ConflictException when the integration has no live socket.
   */
  async sendAgentMessage(
    integrationId: Types.ObjectId,
    remoteJid: string,
    text: string,
  ): Promise<string | undefined> {
    const active = [...this.sessions.values()].find(
      (candidate) =>
        candidate.integrationRef.kind === 'agent' &&
        candidate.integrationRef.integrationId.toString() === integrationId.toString(),
    );
    if (!active) {
      throw new ConflictException(
        ErrorCode.WHATSAPP_SESSION_NOT_FOUND,
        'WhatsApp session is not connected for this integration',
      );
    }

    try {
      const sent = await active.socket.sendMessage(remoteJid, { text });
      const sentId = sent?.key?.id;
      if (sentId) {
        // Echo guard: the send comes back as a fromMe messages.upsert; the
        // self-chat capture must not mistake it for an owner-typed validation.
        this.botSentMessageIds.add(sentId);
        setTimeout(() => this.botSentMessageIds.delete(sentId), 60_000);
      }
      this.logger.log('WhatsApp proactive message sent', {
        integrationId: integrationId.toString(),
        remoteJid,
        sentId,
      });
      return sentId ?? undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('WhatsApp proactive sendMessage failed', {
        integrationId: integrationId.toString(),
        remoteJid,
        error: message,
      });
      throw error;
    }
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
    if (integrationRef.status === WhatsAppIntegrationStatus.PAIRING) {
      await this.updateIntegrationStatus(integrationRef, {
        status: WhatsAppIntegrationStatus.PAIRING,
        sessionId,
        errorMessage: undefined,
      });
      await this.startPairing(integrationRef, sessionId);
      return;
    }
    await this.restoreSession(integrationRef, sessionId);
  }

  /** Re-open a stored session after FAILED/DISCONNECTED (SSE connect or bootstrap). */
  requestRecovery(
    integrationRef: WhatsAppIntegrationRef,
    sessionId: string,
    reason: string,
  ): void {
    if (integrationRef.kind !== 'agent') {
      return;
    }
    if (this.sessions.has(sessionId) || this.reconnectTimers.has(sessionId)) {
      this.logger.debug('WhatsApp recovery skipped — session active', { sessionId, reason });
      return;
    }
    this.logger.log('WhatsApp recovery requested', { sessionId, reason });
    this.reconnectAttempts.set(sessionId, 0);
    this.autoReconnect(integrationRef, sessionId, 1, undefined, reason, false);
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
        const selfJids = [
          socket.user?.jid,
          socket.user?.lid,
          socket.user?.id,
          active.credsMeJid,
        ].filter((jid): jid is string => Boolean(jid));
        const sendReply = async (remoteJid: string, text: string): Promise<void> => {
          try {
            const sent = await socket.sendMessage(remoteJid, { text });
            const sentId = sent?.key?.id;
            if (sentId) {
              // Echo guard: the reply comes back as a fromMe upsert and must
              // not be routed again as a self-chat user message.
              this.botSentMessageIds.add(sentId);
              setTimeout(() => this.botSentMessageIds.delete(sentId), 60_000);
            }
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
        const ownerTypedMessages = messages.filter(
          (message) => !message.key.id || !this.botSentMessageIds.has(message.key.id),
        );
        void this.messageService
          .captureSelfChatText(active.integrationRef, ownerTypedMessages, selfJids)
          .catch((error: unknown) => {
            this.logger.error('WhatsApp self-chat capture failed', {
              integrationId: active.integrationRef.integrationId.toString(),
              error: error instanceof Error ? error.message : String(error),
            });
          });
        void this.messageService
          .handleIncomingMessages(active.integrationRef, ownerTypedMessages, sendReply, selfJids)
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

    const shouldRetry = shouldAutoReconnectAfterDisconnect({ pairingMode, statusCode });
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
      this.autoReconnect(
        integrationRef,
        sessionId,
        attempt,
        statusCode,
        errorMessage,
        pairingMode,
      );
      return;
    }

    this.pairingCache.clear(sessionId);
    this.reconnectAttempts.delete(sessionId);
    const finalStatus = resolveStatusAfterReconnectExhausted({ pairingMode, statusCode });
    const integrationStatus =
      finalStatus === 'DISCONNECTED'
        ? WhatsAppIntegrationStatus.DISCONNECTED
        : WhatsAppIntegrationStatus.FAILED;
    this.applyIntegrationRefPatch(integrationRef, { status: integrationStatus });
    await this.updateIntegrationStatus(integrationRef, {
      status: integrationStatus,
      errorMessage,
    });
    const failureEvent =
      finalStatus === 'DISCONNECTED' ? 'whatsapp.disconnected' : 'whatsapp.session.failed';
    this.emitPairingEvent(userId, integrationRef, sessionId, failureEvent, { errorMessage });
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
      this.publishAgentStatus(integrationRef, patch);
      return;
    }
    if (integrationRef.kind === 'worky_system_bot') {
      await this.systemBotService.updateStatus(integrationRef.integrationId, patch);
      return;
    }
    await this.workyIntegrationService.updateStatus(integrationRef.integrationId, patch);
  }

  private publishAgentStatus(
    integrationRef: WhatsAppIntegrationRef,
    patch: Partial<{
      status: WhatsAppIntegrationStatus;
      sessionId: string;
      phoneNumber: string;
      displayName: string;
      errorMessage: string;
      lastActivityAt: Date;
    }>,
  ): void {
    if (integrationRef.kind !== 'agent' || !integrationRef.agentId) {
      return;
    }
    const snapshot: WhatsAppIntegrationResponseDto = {
      enabled: integrationRef.enabled,
      status: patch.status ?? integrationRef.status,
      sessionId: patch.sessionId ?? integrationRef.sessionId,
      phoneNumber: patch.phoneNumber ?? integrationRef.phoneNumber,
      displayName: patch.displayName,
      errorMessage: patch.errorMessage,
      lastActivityAt: patch.lastActivityAt?.toISOString(),
    };
    this.integrationSse.publishStatus(
      integrationRef.userId.toString(),
      integrationRef.agentId.toString(),
      snapshot,
    );
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

  /** Restores a CONNECTED integration after backend restart (no QR). */
  private restoreConnectedIntegration(
    integrationRef: WhatsAppIntegrationRef,
    sessionId: string,
  ): void {
    void this.restoreSession(integrationRef, sessionId, {
      preserveStatus: true,
      pairingMode: false,
      resetAttemptCounter: true,
    }).catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn('WhatsApp bootstrap restore failed; scheduling reconnect', {
        integrationId: integrationRef.integrationId.toString(),
        sessionId,
        error: errorMessage,
      });
      this.autoReconnect(integrationRef, sessionId, 1, undefined, errorMessage, false);
    });
  }

  private async restoreSession(
    integrationRef: WhatsAppIntegrationRef,
    sessionId: string,
    options?: {
      preserveStatus?: boolean;
      pairingMode?: boolean;
      resetAttemptCounter?: boolean;
    },
  ): Promise<void> {
    this.cancelReconnect(sessionId);
    if (options?.resetAttemptCounter !== false) {
      this.reconnectAttempts.set(sessionId, 0);
    }
    await this.stopSession(sessionId, false);

    const statusPatch = options?.preserveStatus
      ? { sessionId, errorMessage: undefined }
      : {
          status: WhatsAppIntegrationStatus.CONNECTED,
          sessionId,
          errorMessage: undefined,
        };
    await this.updateIntegrationStatus(integrationRef, statusPatch);
    this.applyIntegrationRefPatch(integrationRef, statusPatch);

    const reopenPairingMode =
      options?.pairingMode ?? integrationRef.status === WhatsAppIntegrationStatus.PAIRING;
    await this.openSocket(integrationRef, sessionId, reopenPairingMode);
  }

  private autoReconnect(
    integrationRef: WhatsAppIntegrationRef,
    sessionId: string,
    attempt: number,
    statusCode: number | undefined,
    errorMessage: string,
    pairingMode: boolean,
  ): void {
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
      void this.restoreSession(integrationRef, sessionId, {
        preserveStatus: true,
        pairingMode,
        resetAttemptCounter: false,
      }).catch((error) => {
        this.logger.error('WhatsApp auto-reconnect failed', {
          sessionId,
          error: (error as Error).message,
        });
      });
    }, delay);
    this.reconnectTimers.set(sessionId, timer);
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
