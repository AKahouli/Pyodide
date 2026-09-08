import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { Model } from 'mongoose';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { WorkyWhatsAppIntegrationService } from '@modules/worky/services/worky-whatsapp-integration.service';
import { WorkyWhatsAppSystemBotService } from '@modules/worky/services/worky-whatsapp-system-bot.service';
import { MongoBaileysAuthStore } from '../baileys/mongo-auth-state';
import { WhatsAppConnectResponseDto } from '../dto/whatsapp-connect-response.dto';
import { WhatsAppIntegrationResponseDto } from '../dto/whatsapp-integration-response.dto';
import { WhatsAppPairingResponseDto } from '../dto/whatsapp-pairing-response.dto';
import { WhatsAppIntegrationStatus } from '../schemas/agent-whatsapp-integration.schema';
import { WhatsAppChatBinding, WhatsAppChatBindingDocument } from '../schemas/whatsapp-chat-binding.schema';
import { toWorkyIntegrationRef } from '../interfaces/whatsapp-integration-ref.interface';
import { WhatsAppConnectivityService } from './whatsapp-connectivity.service';
import { WhatsAppSessionManager } from './whatsapp-session.manager';

@Injectable()
export class WorkyWhatsAppConnectionService {
  constructor(
    private readonly configService: ConfigService,
    private readonly connectivity: WhatsAppConnectivityService,
    private readonly integrationService: WorkyWhatsAppIntegrationService,
    private readonly systemBotService: WorkyWhatsAppSystemBotService,
    private readonly sessionManager: WhatsAppSessionManager,
    private readonly authStore: MongoBaileysAuthStore,
    @InjectModel(WhatsAppChatBinding.name)
    private readonly bindingModel: Model<WhatsAppChatBindingDocument>,
  ) {}

  assertEnabled(): void {
    if (!this.configService.get<boolean>('whatsapp.enabled', true)) {
      throw new BadRequestException(
        ErrorCode.WHATSAPP_DISABLED,
        'WhatsApp integration is disabled',
      );
    }
  }

  async connect(userId: string, streamId: string): Promise<WhatsAppConnectResponseDto> {
    this.assertEnabled();
    await this.connectivity.assertReachable(true);
    await this.systemBotService.assertConnected();

    const existing = await this.integrationService.getByStreamForUser(userId, streamId);
    if (existing?.status === 'CONNECTED') {
      throw new BadRequestException(
        ErrorCode.WHATSAPP_ALREADY_CONNECTED,
        'WhatsApp is already connected for this stream',
      );
    }

    const sessionId = randomUUID();
    const integration = await this.integrationService.upsertIntegrationShell(
      userId,
      streamId,
      sessionId,
    );
    await this.integrationService.clearGroupJid(integration._id);
    await this.authStore.deleteAuthState(integration._id);
    await this.sessionManager.startPairing(toWorkyIntegrationRef(integration), sessionId);
    const pairing = this.sessionManager.getPairingSnapshot(sessionId);
    return {
      sessionId,
      status: 'PAIRING',
      qrCode: pairing?.qrCode,
      pairingCode: pairing?.pairingCode,
    };
  }

  async getPairing(
    userId: string,
    streamId: string,
    sessionId: string,
  ): Promise<WhatsAppPairingResponseDto> {
    this.assertEnabled();
    const integration = await this.integrationService.getDocumentBySessionForUser(
      userId,
      streamId,
      sessionId,
    );
    if (integration.status !== WhatsAppIntegrationStatus.PAIRING) {
      throw new BadRequestException(
        ErrorCode.WHATSAPP_SESSION_NOT_PAIRING,
        'WhatsApp session is not in pairing state',
      );
    }
    return this.sessionManager.getPairingSnapshot(sessionId) ?? {};
  }

  async reconnect(
    userId: string,
    streamId: string,
    sessionId: string,
  ): Promise<WhatsAppIntegrationResponseDto> {
    this.assertEnabled();
    await this.connectivity.assertReachable(true);
    const integration = await this.integrationService.getDocumentBySessionForUser(
      userId,
      streamId,
      sessionId,
    );
    await this.sessionManager.reconnect(toWorkyIntegrationRef(integration), sessionId);
    const refreshed = await this.integrationService.getDocumentByStreamForUser(userId, streamId);
    return this.integrationService.toResponse(refreshed);
  }

  async disconnectSession(
    userId: string,
    streamId: string,
    sessionId: string,
  ): Promise<void> {
    this.assertEnabled();
    const integration = await this.integrationService.getDocumentBySessionForUser(
      userId,
      streamId,
      sessionId,
    );
    await this.sessionManager.stopSession(sessionId, true);
    await this.authStore.deleteAuthState(integration._id);
    await this.integrationService.updateStatus(integration._id, {
      status: WhatsAppIntegrationStatus.DISCONNECTED,
      sessionId: undefined,
      phoneNumber: undefined,
      displayName: undefined,
      errorMessage: undefined,
    });
  }

  /**
   * Forwards an AI manager message to the Worky bridge WhatsApp group, if one
   * is configured for the given stream. Transient connection failures throw so
   * the Worky delivery outbox can retry them.
   */
  async forwardManagerMessage(
    streamId: string,
    text: string,
  ): Promise<'sent' | 'not_configured'> {
    return this.sessionManager.sendToWorkyGroup(streamId, text);
  }

  async deleteIntegration(userId: string, streamId: string): Promise<void> {
    this.assertEnabled();
    const integration = await this.integrationService.getDocumentByStreamForUser(
      userId,
      streamId,
    );
    if (integration.sessionId) {
      await this.sessionManager.stopSession(integration.sessionId, true);
    }
    await this.authStore.deleteAuthState(integration._id);
    await this.bindingModel.deleteMany({ integrationId: integration._id }).exec();
    await this.integrationService.deleteIntegrationDocument(integration);
  }
}
