import { Inject, Injectable } from '@nestjs/common';
import { LoggerService } from '@modules/logger';
import { WIDGET_TOKEN_STORE, type WidgetTokenStore } from '@modules/widget-chat/persistence/widget.store';
import type { ChannelTeardown } from './channels-teardown.token';

/**
 * Widget agent teardown (plan 4.6): deactivates the agent's tokens. Rows are
 * removed by the FK cascade; this only stops live tokens earlier. Registered
 * in AgentModule — WidgetChatModule imports AgentModule, so the reverse
 * import would cycle.
 */
@Injectable()
export class WidgetChannelTeardown implements ChannelTeardown {
  constructor(
    @Inject(WIDGET_TOKEN_STORE)
    private readonly widgetTokenStore: WidgetTokenStore,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WidgetChannelTeardown.name);
  }

  async deleteForAgent(agentId: string): Promise<void> {
    await this.widgetTokenStore.revokeAllForAgent(agentId);
    this.logger.log('Widget tokens revoked for agent', { agentId });
  }
}
