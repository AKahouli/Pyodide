import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { Types } from 'mongoose';
import { LoggerService } from '@modules/logger';
import { WorkyWhatsAppIntegrationService } from '@modules/worky/services/worky-whatsapp-integration.service';
import { WorkyWhatsAppSystemBotService } from '@modules/worky/services/worky-whatsapp-system-bot.service';
import { WhatsAppSessionManager } from './whatsapp-session.manager';
import { normalizeWhatsappUserJid } from '../utils/whatsapp-user-jid.util';

export interface ProvisionBridgeGroupInput {
  streamId: string;
  userId: string;
  integrationId: Types.ObjectId;
  userJid: string;
}

export interface ProvisionBridgeGroupResult {
  groupJid: string;
}

/**
 * Creates and resolves Worky bridge WhatsApp groups using the system bot socket.
 */
@Injectable()
export class WorkyWhatsAppGroupService {
  constructor(
    private readonly logger: LoggerService,
    private readonly systemBotService: WorkyWhatsAppSystemBotService,
    private readonly workyIntegrationService: WorkyWhatsAppIntegrationService,
    @Inject(forwardRef(() => WhatsAppSessionManager))
    private readonly sessionManager: WhatsAppSessionManager,
  ) {
    this.logger.setContext(WorkyWhatsAppGroupService.name);
  }

  async resolveGroupJid(streamId: string): Promise<string | undefined> {
    return this.workyIntegrationService.resolveGroupJidByStreamId(streamId);
  }

  async provisionBridgeGroup(
    input: ProvisionBridgeGroupInput,
  ): Promise<ProvisionBridgeGroupResult> {
    await this.systemBotService.assertConnected();
    const botSocket = this.sessionManager.getSystemBotSocket();
    if (!botSocket) {
      throw new Error('System bot socket is not active');
    }

    const groupName = await this.workyIntegrationService.findStreamTitle(
      input.userId,
      new Types.ObjectId(input.streamId),
    );
    const participantJid = normalizeWhatsappUserJid(input.userJid);

    this.logger.log('Creating Worky bridge group via system bot', {
      streamId: input.streamId,
      groupName,
      participantJid,
    });

    const result = await botSocket.groupCreate(groupName, [participantJid]);
    const groupJid = result.id;
    if (!groupJid) {
      throw new Error('groupCreate returned no group JID');
    }

    await this.workyIntegrationService.updateGroupJid(input.integrationId, groupJid);
    await this.workyIntegrationService.updateUserWhatsappJid(input.integrationId, participantJid);

    this.logger.log('Worky bridge group created', {
      streamId: input.streamId,
      groupJid,
    });

    return { groupJid };
  }
}
