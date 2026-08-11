import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { Playbook, PlaybookDocument } from '../schemas/playbook.schema';
import { PlaybookMailGraphClientService } from './playbook-mail-graph-client.service';
import { PlaybookService } from './playbook.service';
import { LoggerService } from '../../logger';

const RENEWAL_WINDOW_MINUTES = 10;

@Injectable()
export class PlaybookMailSubscriptionRenewalService {
  constructor(
    @InjectModel(Playbook.name)
    private readonly playbookModel: Model<PlaybookDocument>,
    private readonly graphClient: PlaybookMailGraphClientService,
    private readonly playbookService: PlaybookService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('MailSubscriptionRenewal');
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async renewExpiringSubscriptions(): Promise<void> {
    const cutoff = new Date(Date.now() + RENEWAL_WINDOW_MINUTES * 60 * 1000);

    const playbooks = await this.playbookModel
      .find({
        isActive: true,
        'mailTrigger.enabled': true,
        'mailTrigger.runtimeEnabled': true,
        'mailTrigger.subscriptionId': { $ne: null },
        'mailTrigger.subscriptionExpiresAt': { $lte: cutoff, $gt: new Date() },
      })
      .select('_id createdBy mailTrigger')
      .lean()
      .exec();

    if (playbooks.length === 0) return;

    this.logger.log('Renewing expiring mail subscriptions', { count: playbooks.length });

    for (const playbook of playbooks) {
      const trigger = playbook.mailTrigger;
      if (!trigger?.subscriptionId || !trigger?.mailboxAppKey) continue;
      if (trigger.autoRenewUntil && new Date(trigger.autoRenewUntil).getTime() <= Date.now()) {
        continue;
      }

      try {
        const result = await this.graphClient.renewSubscription(
          (playbook.createdBy as any).toString(),
          trigger.mailboxAppKey,
          trigger.subscriptionId,
          trigger.autoRenewUntil,
        );

        await this.playbookService.syncMailTriggerSubscription(
          playbook._id.toString(),
          {
            mailboxAppKey: trigger.mailboxAppKey,
            notificationUrl: trigger.notificationUrl,
            autoRenewUntil: trigger.autoRenewUntil instanceof Date
              ? trigger.autoRenewUntil.toISOString()
              : trigger.autoRenewUntil ?? null,
            subscriptionId: trigger.subscriptionId,
            subscriptionClientState: trigger.subscriptionClientState || '',
            subscriptionExpiresAt: result.expirationDateTime || null,
          },
        );

        this.logger.log('Mail subscription renewed', {
          playbookId: playbook._id.toString(),
          subscriptionId: trigger.subscriptionId,
          newExpiry: result.expirationDateTime,
        });
      } catch (err) {
        this.logger.error('Mail subscription renewal failed', {
          playbookId: playbook._id.toString(),
          subscriptionId: trigger.subscriptionId,
          error: (err as Error).message,
        });
      }
    }
  }
}
