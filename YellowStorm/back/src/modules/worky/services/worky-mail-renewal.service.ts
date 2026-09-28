import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LoggerService } from '@modules/logger';
import { PlaybookFlowMailGraphClientService } from '@modules/playbook-flow/services/playbook-flow-mail-graph-client.service';
import { WorkyMailRepository } from '../persistence/worky-mail.repository';

const RENEWAL_WINDOW_MINUTES = 20;

/**
 * Graph caps a mailbox subscription at 72 hours, and a person takes longer than
 * that to answer an email more often than you would like. So renewal is not
 * housekeeping — it is the difference between a reply resuming a step on day
 * four and vanishing.
 */
@Injectable()
export class WorkyMailRenewalService {
  constructor(
    private readonly subscriptions: WorkyMailRepository,
    private readonly graphClient: PlaybookFlowMailGraphClientService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('WorkyMailRenewal');
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async renewExpiringSubscriptions(): Promise<void> {
    const cutoff = new Date(Date.now() + RENEWAL_WINDOW_MINUTES * 60 * 1000);

    // Deliberately gated on nothing but expiry. The playbook renewal also
    // requires runtimeEnabled, which silently lets a subscription die whenever
    // that flag is off — the failure is invisible until a reply goes missing.
    // Poll-only mailboxes have no subscription to renew — they are read by the
    // catch-up sweep instead.
    const due = await this.subscriptions.listExpiring(cutoff);
    if (due.length === 0) return;

    this.logger.log('Renewing worky mail subscriptions', { count: due.length });

    for (const subscription of due) {
      if (!subscription.subscriptionId) continue;  // poll-only; query already excludes these
      try {
        const renewed = await this.graphClient.renewSubscription(
          subscription.userId,
          subscription.mailboxAppKey,
          subscription.subscriptionId,
        );
        await this.subscriptions.setExpiry(
          subscription.id,
          new Date(renewed.expirationDateTime as string),
        );
      } catch (err) {
        this.logger.error('Mail subscription renewal failed', {
          userId: subscription.userId,
          subscriptionId: subscription.subscriptionId,
          error: (err as Error).message,
        });
        // Past expiry Graph has dropped it anyway; clear the record so the next
        // turn creates a fresh one instead of renewing a corpse forever.
        if ((subscription.expiresAt?.getTime() ?? 0) <= Date.now()) {
          await this.subscriptions.deleteById(subscription.id);
          this.logger.warn('Dropped an expired mail subscription record', {
            userId: subscription.userId,
          });
        }
      }
    }
  }
}
