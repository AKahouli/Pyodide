import { Injectable } from '@nestjs/common';
import { WidgetChatService } from '@modules/widget-chat/services/widget-chat.service';
import { TelegramIntegrationService } from '@modules/telegram/services/telegram-integration.service';
import { TelegramIntegrationStatus } from '@modules/telegram/telegram.types';
import type { GovernanceReadinessCheck } from './governance-deployment.service';

@Injectable()
export class GovernanceChannelReadinessService {
  constructor(
    private readonly widgetChatService: WidgetChatService,
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

  groupChannelsByAgent(channels: Record<string, { enabled?: boolean; status?: string }>, defaultAgentId: string): Record<string, Record<string, { enabled?: boolean; status?: string }>> {
    const grouped: Record<string, Record<string, { enabled?: boolean; status?: string }>> = {};
    for (const [key, config] of Object.entries(channels)) {
      const separatorIndex = key.indexOf(':');
      const agentId = separatorIndex > 0 ? key.slice(0, separatorIndex) : defaultAgentId;
      const channel = separatorIndex > 0 ? key.slice(separatorIndex + 1) : key;
      grouped[agentId] = { ...grouped[agentId], [channel]: config };
    }
    return grouped;
  }

  private async buildChannelCheck(userId: string, agentId: string, channel: string): Promise<GovernanceReadinessCheck> {
    const isReady = await this.isChannelReady(userId, agentId, channel);
    return { key: `${agentId}:${channel}_ready`, label: `${channel} ready`, status: isReady ? 'passed' : 'warning', severity: 'warning', targetType: 'channel', targetId: agentId };
  }

  private async isChannelReady(userId: string, agentId: string, channel: string): Promise<boolean> {
    try {
      if (channel === 'widget') return this.widgetChatService.hasActiveToken(agentId);
      if (channel === 'telegram') {
        const integration = await this.telegramIntegrationService.getByAgentForUser(userId, agentId);
        return integration?.enabled === true && integration.status === TelegramIntegrationStatus.ACTIVE;
      }
      return false;
    } catch (error) {
      error;
      return false;
    }
  }
}
