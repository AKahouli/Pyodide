import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { WorkyWhatsAppSystemBotService } from '@modules/worky/services/worky-whatsapp-system-bot.service';
import { MongoBaileysAuthStore } from '../baileys/mongo-auth-state';
import { WhatsAppConnectResponseDto } from '../dto/whatsapp-connect-response.dto';
import { WhatsAppIntegrationResponseDto } from '../dto/whatsapp-integration-response.dto';
import { WhatsAppPairingResponseDto } from '../dto/whatsapp-pairing-response.dto';
import { WhatsAppIntegrationStatus } from '../schemas/agent-whatsapp-integration.schema';
import { toSystemBotIntegrationRef } from '../interfaces/whatsapp-integration-ref.interface';
import { WhatsAppConnectivityService } from './whatsapp-connectivity.service';
import { WhatsAppSessionManager } from './whatsapp-session.manager';

@Injectable()
export class WorkyWhatsAppSystemBotConnectionService {
  constructor(
    private readonly configService: ConfigService,
    private readonly connectivity: WhatsAppConnectivityService,
    private readonly systemBotService: WorkyWhatsAppSystemBotService,
    private readonly sessionManager: WhatsAppSessionManager,
    private readonly authStore: MongoBaileysAuthStore,
  ) {}

  assertEnabled(): void {
    if (!this.configService.get<boolean>('whatsapp.enabled', true)) {
      throw new BadRequestException(
        ErrorCode.WHATSAPP_DISABLED,
        'WhatsApp integration is disabled',
      );
    }
  }

  async connect(adminUserId: string): Promise<WhatsAppConnectResponseDto> {
    this.assertEnabled();
    await this.connectivity.assertReachable(true);
    await this.systemBotService.assertExpectedPhoneConfigured();

    const existing = await this.systemBotService.getOrCreateDocument();
    if (existing.status === WhatsAppIntegrationStatus.CONNECTED) {
      throw new BadRequestException(
        ErrorCode.WHATSAPP_ALREADY_CONNECTED,
        'WhatsApp system bot is already connected',
      );
    }

    const sessionId = randomUUID();
    const integration = await this.systemBotService.upsertPairingShell(adminUserId, sessionId);
    await this.authStore.deleteAuthState(integration._id);
    await this.sessionManager.startPairing(
      toSystemBotIntegrationRef(integration, integration.pairedByUserId!),
      sessionId,
    );
    const pairing = this.sessionManager.getPairingSnapshot(sessionId);
    return {
      sessionId,
      status: 'PAIRING',
      qrCode: pairing?.qrCode,
      pairingCode: pairing?.pairingCode,
    };
  }

  async getPairing(sessionId: string): Promise<WhatsAppPairingResponseDto> {
    this.assertEnabled();
    const integration = await this.systemBotService.getDocumentBySession(sessionId);
    if (integration.status !== WhatsAppIntegrationStatus.PAIRING) {
      throw new BadRequestException(
        ErrorCode.WHATSAPP_SESSION_NOT_PAIRING,
        'WhatsApp session is not in pairing state',
      );
    }
    return this.sessionManager.getPairingSnapshot(sessionId) ?? {};
  }

  async reconnect(sessionId: string): Promise<WhatsAppIntegrationResponseDto> {
    this.assertEnabled();
    await this.connectivity.assertReachable(true);
    const integration = await this.systemBotService.getDocumentBySession(sessionId);
    const pairedByUserId = integration.pairedByUserId;
    if (!pairedByUserId) {
      throw new BadRequestException(
        ErrorCode.WHATSAPP_INTEGRATION_NOT_FOUND,
        'System bot has no paired admin user',
      );
    }
    await this.sessionManager.reconnect(
      toSystemBotIntegrationRef(integration, pairedByUserId),
      sessionId,
    );
    const refreshed = await this.systemBotService.getOrCreateDocument();
    return this.systemBotService.toResponse(refreshed);
  }

  async disconnectSession(sessionId: string): Promise<void> {
    this.assertEnabled();
    const integration = await this.systemBotService.getDocumentBySession(sessionId);
    await this.sessionManager.stopSession(sessionId, true);
    await this.authStore.deleteAuthState(integration._id);
    await this.systemBotService.updateStatus(integration._id, {
      status: WhatsAppIntegrationStatus.DISCONNECTED,
      sessionId: undefined,
      phoneNumber: undefined,
      displayName: undefined,
      errorMessage: undefined,
    });
  }

  async getStatus(): Promise<WhatsAppIntegrationResponseDto> {
    return this.systemBotService.getStatus();
  }

  async updateExpectedPhone(phoneNumber: string): Promise<WhatsAppIntegrationResponseDto> {
    const doc = await this.systemBotService.updateExpectedPairingPhone(phoneNumber);
    return this.systemBotService.toResponse(doc);
  }

  async isConnected(): Promise<boolean> {
    const doc = await this.systemBotService.findConnected();
    return this.systemBotService.isConnected(doc);
  }
}
