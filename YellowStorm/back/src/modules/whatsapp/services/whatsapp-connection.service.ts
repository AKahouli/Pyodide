import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { MongoBaileysAuthStore } from '../baileys/mongo-auth-state';
import { WhatsAppConnectResponseDto } from '../dto/whatsapp-connect-response.dto';
import { WhatsAppIntegrationResponseDto } from '../dto/whatsapp-integration-response.dto';
import { WhatsAppPairingResponseDto } from '../dto/whatsapp-pairing-response.dto';
import { WhatsAppIntegrationStatus } from '../schemas/agent-whatsapp-integration.schema';
import { WhatsAppConnectivityService } from './whatsapp-connectivity.service';
import { WhatsAppIntegrationService } from './whatsapp-integration.service';
import { WhatsAppSessionManager } from './whatsapp-session.manager';

@Injectable()
export class WhatsAppConnectionService {
  constructor(
    private readonly configService: ConfigService,
    private readonly connectivity: WhatsAppConnectivityService,
    private readonly integrationService: WhatsAppIntegrationService,
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

  async connect(userId: string, agentId: string): Promise<WhatsAppConnectResponseDto> {
    this.assertEnabled();
    await this.connectivity.assertReachable(true);

    const existing = await this.integrationService.getByAgentForUser(userId, agentId);
    if (existing?.status === 'CONNECTED') {
      throw new BadRequestException(
        ErrorCode.WHATSAPP_ALREADY_CONNECTED,
        'WhatsApp is already connected for this agent',
      );
    }

    const sessionId = randomUUID();
    const integration = await this.integrationService.upsertIntegrationShell(
      userId,
      agentId,
      sessionId,
    );
    await this.authStore.deleteAuthState(integration._id);
    await this.sessionManager.startPairing(integration, sessionId);
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
    agentId: string,
    sessionId: string,
  ): Promise<WhatsAppPairingResponseDto> {
    this.assertEnabled();
    const integration = await this.integrationService.getDocumentBySessionForUser(
      userId,
      agentId,
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
    agentId: string,
    sessionId: string,
  ): Promise<WhatsAppIntegrationResponseDto> {
    this.assertEnabled();
    await this.connectivity.assertReachable(true);
    const integration = await this.integrationService.getDocumentBySessionForUser(
      userId,
      agentId,
      sessionId,
    );
    await this.sessionManager.reconnect(integration, sessionId);
    const refreshed = await this.integrationService.getDocumentByAgentForUser(userId, agentId);
    return this.integrationService.toResponse(refreshed);
  }

  async disconnectSession(
    userId: string,
    agentId: string,
    sessionId: string,
  ): Promise<void> {
    this.assertEnabled();
    const integration = await this.integrationService.getDocumentBySessionForUser(
      userId,
      agentId,
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

  async deleteIntegration(userId: string, agentId: string): Promise<void> {
    this.assertEnabled();
    const integration = await this.integrationService.getDocumentByAgentForUser(
      userId,
      agentId,
    );
    if (integration.sessionId) {
      await this.sessionManager.stopSession(integration.sessionId, true);
    }
    await this.authStore.deleteAuthState(integration._id);
    await this.integrationService.deleteIntegrationForAgent(userId, agentId);
  }
}
