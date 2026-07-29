import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { LoggerService } from '@modules/logger';
import { PlaybookFlowMailGraphClientService } from '@modules/playbook-flow/services/playbook-flow-mail-graph-client.service';
import {
  WorkyMailSubscription,
  WorkyMailSubscriptionDocument,
} from '../schemas/worky-mail-subscription.schema';
import { WorkyOrchestratorGrpcClientService } from './worky-orchestrator.grpc-client.service';
import { WorkyTurnContextService } from './worky-turn-context.service';
import { extractMailToken } from './worky-mail-token';

/** How far back to look when a mailbox has never been swept. */
const COLD_START_LOOKBACK_MS = 60 * 60 * 1000;
/** Overlap each sweep slightly rather than trusting clocks to agree. */
const OVERLAP_MS = 2 * 60 * 1000;

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
    @InjectModel(WorkyMailSubscription.name)
    private readonly subscriptionModel: Model<WorkyMailSubscriptionDocument>,
    private readonly graphClient: PlaybookFlowMailGraphClientService,
    private readonly orchestrator: WorkyOrchestratorGrpcClientService,
    private readonly turnContext: WorkyTurnContextService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('WorkyMailCatchup');
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<void> {
    const subscriptions = await this.subscriptionModel.find().lean().exec();
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

  /** Only the fields the sweep needs — a lean doc, not a hydrated model. */
  private async sweepMailbox(subscription: {
    _id: unknown;
    userId: string;
    mailboxAppKey: string;
    lastSweptAt?: Date | null;
  }): Promise<void> {
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
        replyBody:
          ((message.bodyPreview as string) ||
            ((message.body as Record<string, unknown>)?.content as string) ||
            '').trim(),
        replyFrom:
          ((message.from as Record<string, any>)?.emailAddress?.address as string) ?? '',
        agents: context.agents,
        connectors: context.connectors,
      });
      // delivered=false is the normal answer here: almost every token we re-offer
      // was already delivered by the webhook seconds after it arrived.
      if (result.delivered) recovered += 1;
    }

    await this.subscriptionModel
      .updateOne({ _id: subscription._id }, { $set: { lastSweptAt: sweptAt } })
      .exec();

    if (recovered > 0) {
      this.logger.log('Mail catch-up recovered replies the webhook missed', {
        userId: subscription.userId,
        recovered,
      });
    }
  }
}
