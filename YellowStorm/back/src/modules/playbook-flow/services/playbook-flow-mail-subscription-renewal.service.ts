import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomBytes } from 'crypto';
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
      const params = (flow.triggerConfig?.params ?? {});
      const expiresAt = expiryTime(params.subscriptionExpiresAt);
      return params.subscriptionId != null && expiresAt <= cutoff && expiresAt > now;
    });

    if (flows.length === 0) return;

    this.logger.log('Renewing expiring mail subscriptions', { count: flows.length });

    for (const flow of flows) {
      const params = (flow.triggerConfig?.params ?? {});
      const subscriptionId = params.subscriptionId as string | undefined;
      const mailboxAppKey = params.mailboxAppKey as string | undefined;
      if (!subscriptionId || !mailboxAppKey) continue;

      const autoRenewUntil = params.autoRenewUntil as string | Date | null | undefined;
      if (autoRenewUntil && new Date(autoRenewUntil).getTime() <= Date.now()) continue;

      try {
        // Legacy subscriptions carry a guessable clientState (the flow id).
        // Graph's PATCH cannot rotate a clientState, so those are re-created
        // with a fresh random secret instead of renewed. Needs the stored
        // notification URL; flows subscribed before it was persisted must be
        // re-synced from the trigger UI once.
        const legacyClientState =
          typeof params.subscriptionClientState !== 'string' ||
          params.subscriptionClientState.length === 0 ||
          params.subscriptionClientState === flow.id;
        const notificationUrl = params.subscriptionNotificationUrl as string | undefined;

        if (legacyClientState && notificationUrl) {
          const clientState = randomBytes(24).toString('base64url');
          const { subscription, resolvedAppKey } = await this.graphClient.createInboxSubscription(
            flow.ownerId,
            mailboxAppKey,
            notificationUrl,
            clientState,
            autoRenewUntil ?? null,
          );
          try {
            await this.graphClient.deleteSubscription(flow.ownerId, mailboxAppKey, subscriptionId);
          } catch {
            // The old subscription may already be gone; the new one is live.
          }
          await this.flowService.update(flow.id, flow.ownerId, {
            triggerConfig: {
              kind: 'mail',
              params: {
                ...params,
                mailboxAppKey: resolvedAppKey,
                subscriptionId: subscription.id,
                subscriptionClientState: clientState,
                subscriptionExpiresAt: subscription.expirationDateTime,
                subscriptionNotificationUrl: notificationUrl,
              },
            },
          });
          this.logger.log('Mail subscription rotated with a fresh clientState', {
            flowId: flow.id,
            oldSubscriptionId: subscriptionId,
            newSubscriptionId: subscription.id,
          });
          continue;
        }
        if (legacyClientState) {
          this.logger.warn(
            'Legacy mail subscription with a guessable clientState cannot be rotated ' +
            'without a stored notification URL — re-sync the trigger subscription once',
            { flowId: flow.id, subscriptionId },
          );
        }

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
        });

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
