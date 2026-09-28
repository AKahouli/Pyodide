import { newObjectId } from '@common/postgres';
import { WorkyMailSubscriptionService } from './worky-mail-subscription.service';
import type { WorkyMailSubscriptionRecord } from '../worky.types';

const USER = newObjectId();

const POLL_ONLY = { subscriptionId: null, clientState: null, expiresAt: null, notificationUrl: null };

function row(over: Partial<WorkyMailSubscriptionRecord> = {}): WorkyMailSubscriptionRecord {
  return {
    id: newObjectId(),
    userId: USER,
    mailboxAppKey: 'microsoft',
    subscriptionId: null,
    clientState: null,
    expiresAt: null,
    notificationUrl: null,
    lastSweptAt: null,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    updatedAt: new Date('2026-09-01T10:00:00Z'),
    ...over,
  };
}

function build(existing: WorkyMailSubscriptionRecord | null) {
  const subscriptions = {
    findByUser: jest.fn().mockResolvedValue(existing),
    findByClientState: jest.fn().mockResolvedValue(null),
    upsertMailbox: jest.fn().mockImplementation(async (userId: string, mailboxAppKey: string, fields: object) =>
      row({ ...existing, userId, mailboxAppKey, ...fields })),
    deleteById: jest.fn().mockResolvedValue(undefined),
  };
  const graphClient = {
    createInboxSubscription: jest.fn().mockResolvedValue({
      subscription: {
        id: 'sub-1',
        expirationDateTime: new Date(Date.now() + 72 * 3600_000).toISOString(),
      },
      resolvedAppKey: 'microsoft',
    }),
    deleteSubscription: jest.fn().mockResolvedValue(undefined),
  };
  const tokenService = {
    getM365ValidToken: jest.fn().mockResolvedValue({ token: 'tok', appKey: 'microsoft' }),
  };
  const logger = {
    setContext: jest.fn(), log: jest.fn(), warn: jest.fn(),
    error: jest.fn(), debug: jest.fn(),
  };
  const service = new WorkyMailSubscriptionService(
    subscriptions as never, graphClient as never, tokenService as never, logger as never,
  );
  return { service, subscriptions, graphClient, tokenService, logger };
}

describe('WorkyMailSubscriptionService', () => {
  const OLD_ENV = process.env.WORKY_MAIL_NOTIFICATION_URL;
  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.WORKY_MAIL_NOTIFICATION_URL;
    else process.env.WORKY_MAIL_NOTIFICATION_URL = OLD_ENV;
  });

  describe('with no public webhook URL', () => {
    beforeEach(() => delete process.env.WORKY_MAIL_NOTIFICATION_URL);

    it('still records the mailbox, so replies route by polling', async () => {
      // The reason this matters: without the row the catch-up sweep has no
      // mailbox to read, and a deployment with no public URL could not route a
      // reply at all rather than routing it a few minutes late.
      const { service, graphClient, subscriptions } = build(null);
      await service.ensureForUser(USER);

      expect(subscriptions.findByUser).toHaveBeenCalledWith(USER);
      expect(graphClient.createInboxSubscription).not.toHaveBeenCalled();
      // Every push field written as null: a mailbox dropping back to poll-only
      // must clear its stale subscription/URL, not keep pointing at a dead one.
      expect(subscriptions.upsertMailbox).toHaveBeenCalledWith(USER, 'microsoft', POLL_ONLY);
      expect(service.pushEnabled).toBe(false);
    });

    it('resolves the real app key rather than assuming one', async () => {
      const { service, tokenService } = build(null);
      await service.ensureForUser(USER);
      expect(tokenService.getM365ValidToken).toHaveBeenCalledWith(USER, 'microsoft');
    });

    it('records the mailbox under the app key the token was found under', async () => {
      const { service, tokenService, subscriptions } = build(row({ mailboxAppKey: 'microsoft-legacy' }));
      tokenService.getM365ValidToken.mockResolvedValue({ token: 'tok', appKey: 'microsoft-work' });

      await service.ensureForUser(USER);

      expect(tokenService.getM365ValidToken).toHaveBeenCalledWith(USER, 'microsoft-legacy');
      expect(subscriptions.upsertMailbox).toHaveBeenCalledWith(USER, 'microsoft-work', POLL_ONLY);
    });

    it("never tears down another instance's live push subscription", async () => {
      // Environments share one database. An instance with no public URL of its
      // own used to delete the live subscription at Graph's end (because
      // existing.notificationUrl !== null) and then null the row. Seen live: a
      // deployed backend with no WORKY_MAIL_NOTIFICATION_URL silently killed
      // push for a developer's tunnel, dropping every reply back to the
      // 5-minute sweep. It has no URL to offer, so nothing better to replace it
      // with — it must poll and leave the row alone.
      const { service, graphClient, subscriptions } = build(row({
        subscriptionId: 'sub-owned-by-the-other-instance',
        clientState: 'their-secret',
        notificationUrl: 'https://someones-tunnel.example/api/v1/worky/mail/webhook',
        expiresAt: new Date(Date.now() + 48 * 3600_000),
      }));

      await service.ensureForUser(USER);

      expect(graphClient.deleteSubscription).not.toHaveBeenCalled();
      expect(subscriptions.upsertMailbox).not.toHaveBeenCalled();
      expect(subscriptions.deleteById).not.toHaveBeenCalled();
      expect(graphClient.createInboxSubscription).not.toHaveBeenCalled();
    });

    it('still clears a subscription that has actually expired', async () => {
      // Nothing live to protect: leaving a dead subscriptionId on the row would
      // make it look like push still works when Graph has long dropped it.
      const { service, subscriptions } = build(row({
        subscriptionId: 'sub-expired',
        clientState: 'old-secret',
        notificationUrl: 'https://yesterdays-tunnel.example/worky/mail/webhook',
        expiresAt: new Date(Date.now() - 3600_000),
      }));

      await service.ensureForUser(USER);

      expect(subscriptions.upsertMailbox).toHaveBeenCalledWith(USER, 'microsoft', POLL_ONLY);
    });
  });

  describe('with a public webhook URL', () => {
    const URL = 'https://public.example/worky/mail/webhook';
    beforeEach(() => {
      process.env.WORKY_MAIL_NOTIFICATION_URL = URL;
    });

    it('subscribes with a random secret, not a guessable id', async () => {
      const { service, graphClient, subscriptions } = build(null);
      await service.ensureForUser(USER);

      const [userId, appKey, url, clientState] =
        graphClient.createInboxSubscription.mock.calls[0];
      expect([userId, appKey, url]).toEqual([USER, 'microsoft', URL]);
      // Anyone who can reach the public webhook could forge notifications if
      // this were derivable from the user or session.
      expect(clientState.length).toBeGreaterThan(20);
      expect(clientState).not.toContain(USER);
      // The row carries the very secret Graph was given, so its notifications match.
      expect(subscriptions.upsertMailbox).toHaveBeenCalledWith(USER, 'microsoft', {
        subscriptionId: 'sub-1',
        clientState,
        expiresAt: expect.any(Date),
        notificationUrl: URL,
      });
    });

    it('stores the subscription under the app key Graph resolved', async () => {
      const { service, graphClient, subscriptions } = build(null);
      graphClient.createInboxSubscription.mockResolvedValue({
        subscription: { id: 'sub-2', expirationDateTime: '2026-10-01T00:00:00.000Z' },
        resolvedAppKey: 'microsoft-work',
      });

      await service.ensureForUser(USER);

      expect(subscriptions.upsertMailbox).toHaveBeenCalledWith(USER, 'microsoft-work', expect.objectContaining({
        subscriptionId: 'sub-2',
        expiresAt: new Date('2026-10-01T00:00:00.000Z'),
      }));
    });

    it('leaves a live subscription alone', async () => {
      const { service, graphClient, subscriptions } = build(row({
        subscriptionId: 'sub-1',
        clientState: 'secret',
        expiresAt: new Date(Date.now() + 48 * 3600_000),
        notificationUrl: URL,
      }));
      await service.ensureForUser(USER);
      expect(graphClient.createInboxSubscription).not.toHaveBeenCalled();
      expect(subscriptions.upsertMailbox).not.toHaveBeenCalled();
    });

    it('replaces a subscription pointing at a stale URL', async () => {
      // Dev tunnels hand out a new hostname on every restart. A subscription
      // aimed at yesterday's URL fails silently — Graph keeps delivering into
      // the void — which looks exactly like the feature being broken.
      const { service, graphClient, subscriptions } = build(row({
        subscriptionId: 'sub-old',
        clientState: 'old-secret',
        expiresAt: new Date(Date.now() + 48 * 3600_000),
        notificationUrl: 'https://yesterdays-tunnel.example/worky/mail/webhook',
      }));
      await service.ensureForUser(USER);

      // The dead one is dropped at Graph's end rather than left posting nowhere.
      expect(graphClient.deleteSubscription).toHaveBeenCalledWith(USER, 'microsoft', 'sub-old');
      expect(graphClient.createInboxSubscription).toHaveBeenCalled();
      expect(graphClient.createInboxSubscription.mock.calls[0][2]).toBe(URL);
      expect(subscriptions.upsertMailbox).toHaveBeenCalledWith(USER, 'microsoft', expect.objectContaining({
        subscriptionId: 'sub-1',
        notificationUrl: URL,
      }));
      expect(subscriptions.upsertMailbox.mock.calls[0][2].clientState).not.toBe('old-secret');
    });

    it('replaces even when Graph will not delete the old one', async () => {
      const { service, graphClient, subscriptions } = build(row({
        subscriptionId: 'sub-old',
        expiresAt: new Date(Date.now() + 48 * 3600_000),
        notificationUrl: 'https://gone.example/worky/mail/webhook',
      }));
      graphClient.deleteSubscription.mockRejectedValueOnce(new Error('404 already gone'));
      await service.ensureForUser(USER);
      expect(graphClient.createInboxSubscription).toHaveBeenCalled();
      expect(subscriptions.upsertMailbox).toHaveBeenCalled();
    });

    it('re-subscribes before expiry rather than racing the deadline', async () => {
      const { service, graphClient } = build(row({
        subscriptionId: 'sub-1',
        expiresAt: new Date(Date.now() + 60_000), // about to die
        notificationUrl: URL,
      }));
      await service.ensureForUser(USER);
      expect(graphClient.createInboxSubscription).toHaveBeenCalled();
      // Same URL: nothing stale to tear down first.
      expect(graphClient.deleteSubscription).not.toHaveBeenCalled();
    });

    it('upgrades a poll-only mailbox once a URL exists', async () => {
      const { service, graphClient, subscriptions } = build(row());
      await service.ensureForUser(USER);
      expect(graphClient.createInboxSubscription).toHaveBeenCalled();
      expect(graphClient.deleteSubscription).not.toHaveBeenCalled();
      expect(subscriptions.upsertMailbox).toHaveBeenCalledWith(USER, 'microsoft', expect.objectContaining({
        subscriptionId: 'sub-1',
        notificationUrl: URL,
      }));
    });
  });

  describe('findByClientState', () => {
    it('returns the subscription holding that secret', async () => {
      const { service, subscriptions } = build(null);
      const stored = row({ subscriptionId: 'sub-1', clientState: 'secret' });
      subscriptions.findByClientState.mockResolvedValue(stored);

      await expect(service.findByClientState('secret')).resolves.toBe(stored);
      expect(subscriptions.findByClientState).toHaveBeenCalledWith('secret');
    });

    it('answers null for an empty secret without querying', async () => {
      const { service, subscriptions } = build(null);
      await expect(service.findByClientState('')).resolves.toBeNull();
      expect(subscriptions.findByClientState).not.toHaveBeenCalled();
    });
  });

  describe('releaseForUser', () => {
    it('releases a poll-only mailbox without calling Graph', async () => {
      const existing = row();
      const { service, graphClient, subscriptions } = build(existing);
      await service.releaseForUser(USER);
      expect(graphClient.deleteSubscription).not.toHaveBeenCalled();
      expect(subscriptions.deleteById).toHaveBeenCalledWith(existing.id);
    });

    it('deletes a push subscription at Graph, then drops the record', async () => {
      const existing = row({ subscriptionId: 'sub-1', clientState: 'secret' });
      const { service, graphClient, subscriptions } = build(existing);
      await service.releaseForUser(USER);
      expect(graphClient.deleteSubscription).toHaveBeenCalledWith(USER, 'microsoft', 'sub-1');
      expect(subscriptions.deleteById).toHaveBeenCalledWith(existing.id);
    });

    it('drops the record even when Graph will not delete the subscription', async () => {
      const existing = row({ subscriptionId: 'sub-1' });
      const { service, graphClient, subscriptions, logger } = build(existing);
      graphClient.deleteSubscription.mockRejectedValueOnce(new Error('404 already gone'));
      await service.releaseForUser(USER);
      expect(logger.warn).toHaveBeenCalled();
      expect(subscriptions.deleteById).toHaveBeenCalledWith(existing.id);
    });

    it('does nothing for a user with no mailbox on record', async () => {
      const { service, graphClient, subscriptions } = build(null);
      await service.releaseForUser(USER);
      expect(graphClient.deleteSubscription).not.toHaveBeenCalled();
      expect(subscriptions.deleteById).not.toHaveBeenCalled();
    });
  });
});
