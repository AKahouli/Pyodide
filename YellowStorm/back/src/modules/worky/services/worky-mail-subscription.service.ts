import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '@modules/logger';
import { PlaybookFlowMailGraphClientService } from '@modules/playbook-flow/services/playbook-flow-mail-graph-client.service';
import { ConnectedAppTokenService } from '@modules/connected-app/services/connected-app-token.service';
import {
  WorkyMailSubscription,
  WorkyMailSubscriptionDocument,
} from '../schemas/worky-mail-subscription.schema';

/** Re-subscribe this far before expiry rather than racing the deadline. */
const RENEWAL_WINDOW_MS = 15 * 60 * 1000;

/**
 * Keeps one Graph inbox subscription alive per user mailbox, so a reply to a
 * mail worky sent can find its way back to the step waiting for it.
 *
 * Scoped to the user, not the step or the session: a Graph inbox subscription
 * fires for every arriving mail and cannot be filtered by sender or thread, so
 * one per step would multiply every notification by the number of waits. The
 * routing token — not the subscription — decides which step a mail belongs to.
 */
@Injectable()
export class WorkyMailSubscriptionService {
  constructor(
    @InjectModel(WorkyMailSubscription.name)
    private readonly subscriptionModel: Model<WorkyMailSubscriptionDocument>,
    private readonly graphClient: PlaybookFlowMailGraphClientService,
    private readonly tokenService: ConnectedAppTokenService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('WorkyMailSubscription');
  }

  /**
   * The public URL Graph should POST notifications to. Without it there is no
   * webhook to validate the subscription against, so Graph would reject the
   * create anyway — the feature is simply off.
   */
  private get notificationUrl(): string | null {
    return process.env.WORKY_MAIL_NOTIFICATION_URL?.trim() || null;
  }

  /** True when replies can be pushed to us; false means they are polled instead. */
  get pushEnabled(): boolean {
    return this.notificationUrl !== null;
  }

  /**
   * Make sure this user's mailbox is watched. Idempotent and safe to call on
   * every turn: a live subscription that is not near expiry is left alone.
   *
   * Two ways a reply gets home, and only one of them needs a public URL. The row
   * is written either way, because it is what tells the catch-up poll which
   * mailbox to read — so a deployment with no public webhook still routes
   * replies, just minutes later instead of seconds.
   *
   * Best-effort — the caller is sending a message, and this failing must not
   * fail the turn. The worst case is a reply that routes late, or not at all,
   * which the wait's own expiry already covers.
   */
  async ensureForUser(userId: string): Promise<void> {
    const existing = await this.subscriptionModel.findOne({ userId }).lean().exec();
    const notificationUrl = this.notificationUrl;
    const live =
      existing?.subscriptionId &&
      existing.expiresAt &&
      existing.expiresAt.getTime() > Date.now() + RENEWAL_WINDOW_MS &&
      // A subscription pointing somewhere we no longer answer is worse than
      // none: Graph keeps delivering into the void and nothing ever arrives.
      // Dev tunnels change hostname on every restart, so this is routine.
      existing.notificationUrl === notificationUrl;
    if (live) return;
    if (existing?.subscriptionId && existing.notificationUrl !== notificationUrl) {
      this.logger.log('Notification URL changed — replacing the mail subscription', {
        userId, from: existing.notificationUrl, to: notificationUrl,
      });
      // Drop the old one at Graph's end so it stops posting to a dead URL.
      try {
        await this.graphClient.deleteSubscription(
          userId, existing.mailboxAppKey, existing.subscriptionId);
      } catch {
        // Already gone, or unreachable — either way we are replacing it.
      }
    }
    if (!notificationUrl) {
      // Poll-only: record the mailbox so the catch-up sweep can read it.
      const { appKey } = await this.tokenService.getM365ValidToken(
        userId, existing?.mailboxAppKey ?? 'microsoft');
      await this.subscriptionModel.updateOne(
        { userId, mailboxAppKey: appKey },
        { $set: { subscriptionId: null, clientState: null, expiresAt: null, notificationUrl: null } },
        { upsert: true },
      );
      this.logger.log(
        'Worky mail: polling this mailbox (set WORKY_MAIL_NOTIFICATION_URL for instant replies)',
        { userId, appKey },
      );
      return;
    }

    // A random secret, not the user id: clientState is the only thing proving a
    // notification came from the subscription we created, so it must not be
    // guessable by anyone who can reach the public webhook.
    const clientState = randomBytes(24).toString('base64url');

    const { subscription, resolvedAppKey } = await this.graphClient.createInboxSubscription(
      userId,
      existing?.mailboxAppKey ?? 'microsoft',
      notificationUrl,
      clientState,
    );

    await this.subscriptionModel.updateOne(
      { userId, mailboxAppKey: resolvedAppKey },
      {
        $set: {
          subscriptionId: subscription.id as string,
          clientState,
          expiresAt: new Date(subscription.expirationDateTime as string),
          notificationUrl,
        },
      },
      { upsert: true },
    );
    this.logger.log('Worky mail subscription ready', {
      userId,
      resolvedAppKey,
      expiresAt: subscription.expirationDateTime,
    });
  }

  /** The subscription a notification claims to come from, or null if it is lying. */
  async findByClientState(clientState: string): Promise<WorkyMailSubscription | null> {
    if (!clientState) return null;
    return this.subscriptionModel.findOne({ clientState }).lean().exec() as
      Promise<WorkyMailSubscription | null>;
  }

  /** Drop a user's subscription — nothing of theirs is waiting on a reply. */
  async releaseForUser(userId: string): Promise<void> {
    const existing = await this.subscriptionModel.findOne({ userId }).lean().exec();
    if (!existing) return;
    try {
      // Nothing to delete for a poll-only mailbox — there is no subscription.
      if (existing.subscriptionId) {
        await this.graphClient.deleteSubscription(
          userId, existing.mailboxAppKey, existing.subscriptionId);
      }
    } catch (err) {
      // Already gone at Graph's end is fine; drop our record either way rather
      // than keep renewing a subscription that no longer exists.
      this.logger.warn('Graph subscription delete failed; dropping record anyway', {
        userId, error: (err as Error).message,
      });
    }
    await this.subscriptionModel.deleteOne({ _id: (existing as any)._id }).exec();
    this.logger.log('Worky mail subscription released', { userId });
  }
}
