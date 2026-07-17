import { WorkyMailSubscriptionService } from './worky-mail-subscription.service';

function build(existing: Record<string, unknown> | null) {
  const updateOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });
  const subscriptionModel = {
    findOne: jest.fn().mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve(existing) }),
    }),
    updateOne,
    deleteOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
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
    subscriptionModel as any, graphClient as any, tokenService as any, logger as any,
  );
  return { service, subscriptionModel, graphClient, tokenService, logger, updateOne };
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
      const { service, graphClient, updateOne } = build(null);
      await service.ensureForUser('u1');

      expect(graphClient.createInboxSubscription).not.toHaveBeenCalled();
      expect(updateOne).toHaveBeenCalledWith(
        { userId: 'u1', mailboxAppKey: 'microsoft' },
        { $setOnInsert: { subscriptionId: null, clientState: null, expiresAt: null } },
        { upsert: true },
      );
      expect(service.pushEnabled).toBe(false);
    });

    it('resolves the real app key rather than assuming one', async () => {
      const { service, tokenService } = build(null);
      await service.ensureForUser('u1');
      expect(tokenService.getM365ValidToken).toHaveBeenCalledWith('u1', 'microsoft');
    });
  });

  describe('with a public webhook URL', () => {
    beforeEach(() => {
      process.env.WORKY_MAIL_NOTIFICATION_URL = 'https://public.example/worky/mail/webhook';
    });

    it('subscribes with a random secret, not a guessable id', async () => {
      const { service, graphClient, updateOne } = build(null);
      await service.ensureForUser('u1');

      const [userId, appKey, url, clientState] =
        graphClient.createInboxSubscription.mock.calls[0];
      expect([userId, appKey, url]).toEqual([
        'u1', 'microsoft', 'https://public.example/worky/mail/webhook',
      ]);
      // Anyone who can reach the public webhook could forge notifications if
      // this were derivable from the user or session.
      expect(clientState.length).toBeGreaterThan(20);
      expect(clientState).not.toContain('u1');
      expect(updateOne.mock.calls[0][1].$set.subscriptionId).toBe('sub-1');
    });

    it('leaves a live subscription alone', async () => {
      const { service, graphClient } = build({
        userId: 'u1', mailboxAppKey: 'microsoft', subscriptionId: 'sub-1',
        expiresAt: new Date(Date.now() + 48 * 3600_000),
      });
      await service.ensureForUser('u1');
      expect(graphClient.createInboxSubscription).not.toHaveBeenCalled();
    });

    it('re-subscribes before expiry rather than racing the deadline', async () => {
      const { service, graphClient } = build({
        userId: 'u1', mailboxAppKey: 'microsoft', subscriptionId: 'sub-1',
        expiresAt: new Date(Date.now() + 60_000), // about to die
      });
      await service.ensureForUser('u1');
      expect(graphClient.createInboxSubscription).toHaveBeenCalled();
    });

    it('upgrades a poll-only mailbox once a URL exists', async () => {
      const { service, graphClient } = build({
        userId: 'u1', mailboxAppKey: 'microsoft', subscriptionId: null, expiresAt: null,
      });
      await service.ensureForUser('u1');
      expect(graphClient.createInboxSubscription).toHaveBeenCalled();
    });
  });

  it('releases a poll-only mailbox without calling Graph', async () => {
    const { service, graphClient, subscriptionModel } = build({
      _id: 'oid', userId: 'u1', mailboxAppKey: 'microsoft', subscriptionId: null,
    });
    await service.releaseForUser('u1');
    expect(graphClient.deleteSubscription).not.toHaveBeenCalled();
    expect(subscriptionModel.deleteOne).toHaveBeenCalled();
  });
});
