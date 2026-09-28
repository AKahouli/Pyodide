import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LoggerService } from '@modules/logger';
import { PlaybookFlowMailGraphClientService } from '@modules/playbook-flow/services/playbook-flow-mail-graph-client.service';
import { WorkyMailRepository } from '../persistence/worky-mail.repository';
import type { WorkyMailSubscriptionRecord } from '../worky.types';
import { WorkyOrchestratorGrpcClientService } from './worky-orchestrator.grpc-client.service';
import { WorkyTurnContextService } from './worky-turn-context.service';
import { extractMailToken, fullReplyText } from './worky-mail-token';

/** How far back to look when a mailbox has never been swept. */
const COLD_START_LOOKBACK_MS = 60 * 60 * 1000;
/** Overlap each sweep slightly rather than trusting clocks to agree. */
const OVERLAP_MS = 2 * 60 * 1000;
/**
 * Every 2 minutes. @nestjs/schedule has no EVERY_2_MINUTES constant, so this is
 * spelled out in its 6-field form to match the CronExpression values.
 *
 * This is the floor on how late a reply can be whenever push is unavailable —
 * no Graph subscription, or one pointing at another environment. It also closes
 * the window on a reply that arrives before its step has parked: that
 * notification is spent (the wait is not claimable yet, by design) and only a
 * re-offer picks it up.
 */
const SWEEP_CRON = '0 */2 * * * *';

/**
 * Re-offers routing tokens found in recent mail, for the replies the webhook
 * never delivered.
 *
 * Two things lose a reply, and neither is exotic. Graph drops notifications it
 * cannot deliver, and around a renewal or restart a subscription can be briefly
 * deaf. And a reply can simply arrive before its step has parked — the token
 * exists from plan projection, but there is no interrupt to resume yet, so the
 * wait is deliberately not claimable and that notification is spent. Only a
 * later re-offer can pick it up.
 *
 * It needs to know nothing about which steps are waiting: it offers every token
 * it finds, and worky resolves them. Re-offering an already-delivered token is a
 * no-op, because claiming a wait is a one-shot — which is what makes replaying
 * the whole recent inbox safe.
 */
@Injectable()
export class WorkyMailCatchupService {
  constructor(
    private readonly subscriptions: WorkyMailRepository,
    private readonly graphClient: PlaybookFlowMailGraphClientService,
    private readonly orchestrator: WorkyOrchestratorGrpcClientService,
    private readonly turnContext: WorkyTurnContextService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('WorkyMailCatchup');
  }

  @Cron(SWEEP_CRON)
  async sweep(): Promise<void> {
    const subscriptions = await this.subscriptions.listAll();
    this.logger.log('Mail catch-up sweep tick', { mailboxes: subscriptions.length });
    for (const subscription of subscriptions) {
      try {
        await this.sweepMailbox(subscription);
      } catch (err) {
        this.logger.warn('Mail catch-up sweep failed for a mailbox', {
          userId: subscription.userId,
          error: (err as Error).message,
        });
      }
    }
  }

  /** Only the fields the sweep needs. */
  private async sweepMailbox(
    subscription: Pick<WorkyMailSubscriptionRecord, 'id' | 'userId' | 'mailboxAppKey' | 'lastSweptAt'>,
  ): Promise<void> {
    const lastSweptAt = subscription.lastSweptAt ?? undefined;
    const since = new Date(
      (lastSweptAt?.getTime() ?? Date.now() - COLD_START_LOOKBACK_MS) - OVERLAP_MS,
    );
    // Read the clock before the fetch, but only commit the cursor once the whole
    // window delivered: a sweep that throws half way should re-read that window
    // rather than skip the replies it never got to. Re-reading is safe — a wait
    // can only be claimed once — so erring towards replay costs nothing.
    const sweptAt = new Date();

    const messages = await this.graphClient.listInboxMessagesSince(
      subscription.userId,
      subscription.mailboxAppKey,
      since,
    );

    // Resolved lazily, once, only if a token actually turns up: almost every
    // swept mail carries none (the sweep re-reads the WHOLE inbox, not just
    // replies), so most sweeps would otherwise pay for a resolution nothing uses.
    let context: { agents: unknown[]; connectors: unknown[] } | null = null;

    let recovered = 0;
    for (const message of messages) {
      const token = extractMailToken(
        (message.subject as string) ?? '',
        ((message.body as Record<string, unknown>)?.content as string) ?? '',
      );
      if (!token) continue;

      if (!context) {
        // Without this the resumed plan gets zero agents/tools for every
        // not-yet-run step -- a step needing one silently fabricates a "done"
        // result and never calls it, instead of actually acting.
        const [agents, connectors] = await Promise.all([
          this.turnContext.resolveWorkyAgents(subscription.userId),
          this.turnContext.resolveConnectors(subscription.userId),
        ]);
        context = { agents, connectors };
      }

      const result = await this.orchestrator.deliverMailReply({
        token,
        replyBody: fullReplyText(
          message.body as { contentType?: string; content?: string },
          message.bodyPreview as string,
        ),
        replyFrom:
          ((message.from as Record<string, any>)?.emailAddress?.address as string) ?? '',
        agents: context.agents,
        connectors: context.connectors,
      });
      // delivered=false is the normal answer here: almost every token we re-offer
      // was already delivered by the webhook seconds after it arrived.
      if (result.delivered) recovered += 1;
    }

    await this.subscriptions.setLastSwept(subscription.id, sweptAt);

    if (recovered > 0) {
      this.logger.log('Mail catch-up recovered replies the webhook missed', {
        userId: subscription.userId,
        recovered,
      });
    }
  }
}
