import { Injectable } from '@nestjs/common';
import { LoggerService } from '@modules/logger';
import type { ChannelTeardown } from './channels-teardown.token';
import { PgWidgetTokenStore } from '../widget-chat/persistence/pg-widget.store';

/**
 * Widget agent teardown (plan 4.6): deactivates the agent's tokens. Rows are
 * removed by the FK cascade; this only stops live tokens earlier. Registered
 * in AgentModule — WidgetChatModule imports AgentModule, so the reverse
 * import would cycle.
 */
@Injectable()
export class WidgetChannelTeardown implements ChannelTeardown {
  constructor(
    private readonly widgetTokenStore: PgWidgetTokenStore,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WidgetChannelTeardown.name);
  }

  async deleteForAgent(agentId: string): Promise<void> {
    await this.widgetTokenStore.revokeAllForAgent(agentId);
    this.logger.log('Widget tokens revoked for agent', { agentId });
  }
}
