import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { Flow, FlowDocument } from '../schemas/playbook-flow.schema';
import { PlaybookFlowMailGraphClientService } from './playbook-flow-mail-graph-client.service';
import { PlaybookFlowService } from './playbook-flow.service';
import { LoggerService } from '@modules/logger';

const RENEWAL_WINDOW_MINUTES = 10;

@Injectable()
export class PlaybookFlowMailSubscriptionRenewalService {
  constructor(
    @InjectModel(Flow.name) private readonly flowModel: Model<FlowDocument>,
    private readonly graphClient: PlaybookFlowMailGraphClientService,
    private readonly flowService: PlaybookFlowService,
    private readonly logger: LoggerService,
  ) { this.logger.setContext('FlowMailSubscriptionRenewal'); }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async renewExpiringSubscriptions(): Promise<void> {
    const cutoff = new Date(Date.now() + RENEWAL_WINDOW_MINUTES * 60 * 1000);

    const flows = await this.flowModel
      .find({
        'triggerConfig.kind': 'mail',
        'triggerConfig.params.runtimeEnabled': true,
        'triggerConfig.params.subscriptionId': { $ne: null },
        'triggerConfig.params.subscriptionExpiresAt': { $lte: cutoff, $gt: new Date() },
      })
      .select('_id ownerId triggerConfig')
      .lean()
      .exec();

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

        await this.flowService.update(flow._id.toString(), flow.ownerId, {
          triggerConfig: {
            kind: 'mail',
            params: {
              ...params,
              subscriptionExpiresAt: result.expirationDateTime || null,
            },
          },
        } as any);

        this.logger.log('Mail subscription renewed', {
          flowId: flow._id.toString(),
          subscriptionId,
          newExpiry: result.expirationDateTime,
        });
      } catch (err) {
        this.logger.error('Mail subscription renewal failed', {
          flowId: flow._id.toString(),
          subscriptionId,
          error: (err as Error).message,
        });
      }
    }
  }
}
