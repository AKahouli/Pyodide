import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { LoggerService } from '@modules/logger';
import { PlaybookFlowMailGraphClientService } from '@modules/playbook-flow/services/playbook-flow-mail-graph-client.service';
import { ConnectedAppTokenService } from '@modules/connected-app/services/connected-app-token.service';
import { WorkyMailRepository } from '../persistence/worky-mail.repository';
import type { WorkyMailSubscriptionRecord } from '../worky.types';

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
    private readonly subscriptions: WorkyMailRepository,
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
    const existing = await this.subscriptions.findByUser(userId);
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

    // Handled BEFORE the replace path below, deliberately. Environments share
    // one database, and an instance with no public URL of its own has no
    // business tearing down a push subscription another instance created and is
    // still serving. It used to do exactly that: `existing.notificationUrl !==
    // notificationUrl` is true when ours is null, so it deleted the live
    // subscription at Graph's end AND nulled the row. Seen live — a deployed
    // instance with no WORKY_MAIL_NOTIFICATION_URL silently killed push for a
    // developer's tunnel, dropping every reply back to the 5-minute sweep and
    // widening the "reply arrives before its step parks" race.
    if (!notificationUrl) {
      const foreignLive =
        existing?.subscriptionId &&
        existing.expiresAt &&
        existing.expiresAt.getTime() > Date.now();
      if (foreignLive) {
        this.logger.log(
          "Worky mail: polling this mailbox; leaving another instance's live " +
          'push subscription alone',
          { userId, notificationUrl: existing.notificationUrl },
        );
        return;
      }
      // Nothing live to protect — record the mailbox so the sweep can read it.
      const { appKey } = await this.tokenService.getM365ValidToken(
        userId, existing?.mailboxAppKey ?? 'microsoft');
      await this.subscriptions.upsertMailbox(userId, appKey, {
        subscriptionId: null, clientState: null, expiresAt: null, notificationUrl: null,
      });
      this.logger.log(
        'Worky mail: polling this mailbox (set WORKY_MAIL_NOTIFICATION_URL for instant replies)',
        { userId, appKey },
      );
      return;
    }

    // We have a public URL of our own, so replacing a subscription that points
    // elsewhere is legitimate: a subscription pointing somewhere we no longer
    // answer is worse than none, since Graph keeps delivering into the void.
    // Dev tunnels change hostname on every restart, so this is routine.
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

    await this.subscriptions.upsertMailbox(userId, resolvedAppKey, {
      subscriptionId: subscription.id as string,
      clientState,
      expiresAt: new Date(subscription.expirationDateTime as string),
      notificationUrl,
    });
    this.logger.log('Worky mail subscription ready', {
      userId,
      resolvedAppKey,
      expiresAt: subscription.expirationDateTime,
    });
  }

  /** The subscription a notification claims to come from, or null if it is lying. */
  async findByClientState(clientState: string): Promise<WorkyMailSubscriptionRecord | null> {
    if (!clientState) return null;
    return this.subscriptions.findByClientState(clientState);
  }

  /** Drop a user's subscription — nothing of theirs is waiting on a reply. */
  async releaseForUser(userId: string): Promise<void> {
    const existing = await this.subscriptions.findByUser(userId);
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
    await this.subscriptions.deleteById(existing.id);
    this.logger.log('Worky mail subscription released', { userId });
  }
}
