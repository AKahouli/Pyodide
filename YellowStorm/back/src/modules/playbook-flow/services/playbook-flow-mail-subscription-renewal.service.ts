import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PlaybookFlowMailGraphClientService } from './playbook-flow-mail-graph-client.service';
import { PlaybookFlowService } from './playbook-flow.service';
import { LoggerService } from '@modules/logger';
import { FlowRepository } from '../persistence/flow.repository';

const RENEWAL_WINDOW_MINUTES = 10;

/** A stored expiry (the ISO string Graph returned, or a Date) as epoch ms; NaN when unreadable. */
function expiryTime(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  return typeof value === 'string' ? new Date(value).getTime() : Number.NaN;
}

@Injectable()
export class PlaybookFlowMailSubscriptionRenewalService {
  constructor(
    private readonly flows: FlowRepository,
    private readonly graphClient: PlaybookFlowMailGraphClientService,
    private readonly flowService: PlaybookFlowService,
    private readonly logger: LoggerService,
  ) { this.logger.setContext('FlowMailSubscriptionRenewal'); }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async renewExpiringSubscriptions(): Promise<void> {
    const now = Date.now();
    const cutoff = now + RENEWAL_WINDOW_MINUTES * 60 * 1000;

    const candidates = await this.flows.listByTrigger('mail', { runtimeEnabled: true });
    const flows = candidates.filter((flow) => {
      const params = (flow.triggerConfig?.params ?? {}) as Record<string, unknown>;
      const expiresAt = expiryTime(params['subscriptionExpiresAt']);
      return params['subscriptionId'] != null && expiresAt <= cutoff && expiresAt > now;
    });

    if (flows.length === 0) return;

    this.logger.log('Renewing expiring mail subscriptions', { count: flows.length });

    for (const flow of flows) {
      const params = (flow.triggerConfig?.params ?? {}) as Record<string, unknown>;
      const subscriptionId = params['subscriptionId'] as string | undefined;
      const mailboxAppKey = params['mailboxAppKey'] as string | undefined;
      if (!subscriptionId || !mailboxAppKey) continue;

      const autoRenewUntil = params['autoRenewUntil'] as string | Date | null | undefined;
      if (autoRenewUntil && new Date(autoRenewUntil).getTime() <= Date.now()) continue;

      try {
        const result = await this.graphClient.renewSubscription(
          flow.ownerId,
          mailboxAppKey,
          subscriptionId,
          autoRenewUntil,
        );

        await this.flowService.update(flow.id, flow.ownerId, {
          triggerConfig: {
            kind: 'mail',
            params: {
              ...params,
              subscriptionExpiresAt: result.expirationDateTime || null,
            },
          },
        } as any);

        this.logger.log('Mail subscription renewed', {
          flowId: flow.id,
          subscriptionId,
          newExpiry: result.expirationDateTime,
        });
      } catch (err) {
        this.logger.error('Mail subscription renewal failed', {
          flowId: flow.id,
          subscriptionId,
          error: (err as Error).message,
        });
      }
    }
  }
}
