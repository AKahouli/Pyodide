import { Injectable } from '@nestjs/common';
import { WidgetChatService } from '@modules/widget-chat/services/widget-chat.service';
import { WhatsAppIntegrationService } from '@modules/whatsapp/services/whatsapp-integration.service';
import { WhatsAppIntegrationStatus } from '@modules/whatsapp/schemas/agent-whatsapp-integration.schema';
import { TelegramIntegrationService } from '@modules/telegram/services/telegram-integration.service';
import { TelegramIntegrationStatus } from '@modules/telegram/schemas/agent-telegram-integration.schema';
import type { GovernanceReadinessCheck } from './governance-deployment.service';

@Injectable()
export class GovernanceChannelReadinessService {
  constructor(
    private readonly widgetChatService: WidgetChatService,
    private readonly whatsappIntegrationService: WhatsAppIntegrationService,
    private readonly telegramIntegrationService: TelegramIntegrationService,
  ) {}

  async buildChannelChecks(userId: string, agentId: string, channels: Record<string, { enabled?: boolean; status?: string }>): Promise<GovernanceReadinessCheck[]> {
    const checks: GovernanceReadinessCheck[] = [];
    for (const [channel, config] of Object.entries(channels)) {
      if (!config.enabled) continue;
      checks.push(await this.buildChannelCheck(userId, agentId, channel));
    }
    return checks;
  }

  private async buildChannelCheck(userId: string, agentId: string, channel: string): Promise<GovernanceReadinessCheck> {
    const isReady = await this.isChannelReady(userId, agentId, channel);
    return { key: `${channel}_ready`, label: `${channel} ready`, status: isReady ? 'passed' : 'failed', severity: 'blocking', targetType: 'channel', targetId: agentId };
  }

  private async isChannelReady(userId: string, agentId: string, channel: string): Promise<boolean> {
    try {
      if (channel === 'widget') return this.widgetChatService.hasActiveToken(agentId);
      if (channel === 'whatsapp') {
        const integration = await this.whatsappIntegrationService.getByAgentForUser(userId, agentId);
        return integration?.enabled === true && integration.status === WhatsAppIntegrationStatus.CONNECTED;
      }
      if (channel === 'telegram') {
        const integration = await this.telegramIntegrationService.getByAgentForUser(userId, agentId);
        return integration?.enabled === true && integration.status === TelegramIntegrationStatus.ACTIVE;
      }
      return false;
    } catch (error) {
      void error;
      return false;
    }
  }
}
