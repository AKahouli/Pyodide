import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '@modules/logger';
import { PlaybookFlowMailGraphClientService } from '@modules/playbook-flow/services/playbook-flow-mail-graph-client.service';
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

  get enabled(): boolean {
    return this.notificationUrl !== null;
  }

  /**
   * Ensure this user's mailbox is subscribed. Idempotent and safe to call on
   * every turn: an existing subscription that is not near expiry is left alone.
   *
   * Best-effort by design — the caller is sending a message, and a mail
   * subscription failing must not fail the turn. The worst case is a reply that
   * never routes, which the wait's own expiry already covers.
   */
  async ensureForUser(userId: string): Promise<void> {
    const notificationUrl = this.notificationUrl;
    if (!notificationUrl) {
      this.logger.debug('WORKY_MAIL_NOTIFICATION_URL unset — mail replies will not route');
      return;
    }

    const existing = await this.subscriptionModel.findOne({ userId }).lean().exec();
    if (existing && existing.expiresAt.getTime() > Date.now() + RENEWAL_WINDOW_MS) return;

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
      await this.graphClient.deleteSubscription(
        userId, existing.mailboxAppKey, existing.subscriptionId);
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
