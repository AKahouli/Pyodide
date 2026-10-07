import { newObjectId } from '@common/postgres';
import { WorkyMailRenewalService } from './worky-mail-renewal.service';
import type { WorkyMailSubscriptionRecord } from '../worky.types';

function row(over: Partial<WorkyMailSubscriptionRecord> = {}): WorkyMailSubscriptionRecord {
  return {
    id: newObjectId(),
    userId: newObjectId(),
    mailboxAppKey: 'microsoft',
    subscriptionId: 'sub-1',
    clientState: 'secret',
    expiresAt: new Date(Date.now() + 5 * 60_000),
    notificationUrl: 'https://public.example/worky/mail/webhook',
    lastSweptAt: null,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    updatedAt: new Date('2026-09-01T10:00:00Z'),
    ...over,
  };
}

const RENEWED_UNTIL = '2026-10-01T12:00:00.000Z';

function build(due: WorkyMailSubscriptionRecord[]) {
  const subscriptions = {
    listExpiring: jest.fn().mockResolvedValue(due),
    setExpiry: jest.fn().mockResolvedValue(undefined),
    deleteById: jest.fn().mockResolvedValue(undefined),
  };
  const graphClient = {
    renewSubscription: jest.fn().mockResolvedValue({ id: 'sub-1', expirationDateTime: RENEWED_UNTIL }),
  };
  const logger = {
    setContext: jest.fn(), log: jest.fn(), warn: jest.fn(),
    error: jest.fn(), debug: jest.fn(),
  };
  const service = new WorkyMailRenewalService(subscriptions as never, graphClient as never, logger as never);
  return { service, subscriptions, graphClient, logger };
}

describe('WorkyMailRenewalService', () => {
  it('renews the subscriptions expiring within the next 20 minutes and stores the new expiry', async () => {
    const soon = row({ subscriptionId: 'sub-soon', mailboxAppKey: 'microsoft-work' });
    const { service, subscriptions, graphClient } = build([soon]);
    const before = Date.now();

    await service.renewExpiringSubscriptions();

    const cutoff = (subscriptions.listExpiring.mock.calls[0][0] as Date).getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before + 20 * 60_000);
    expect(cutoff).toBeLessThanOrEqual(Date.now() + 20 * 60_000);
    expect(graphClient.renewSubscription).toHaveBeenCalledWith(soon.userId, 'microsoft-work', 'sub-soon');
    expect(subscriptions.setExpiry).toHaveBeenCalledWith(soon.id, new Date(RENEWED_UNTIL));
    expect(subscriptions.deleteById).not.toHaveBeenCalled();
  });

  it('does nothing when no subscription is due', async () => {
    const { service, graphClient, logger } = build([]);
    await service.renewExpiringSubscriptions();
    expect(graphClient.renewSubscription).not.toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('never renews a poll-only mailbox', async () => {
    // listExpiring already leaves out mailboxes with no Graph subscription (see
    // the repository spec); the service still refuses one if it ever came back.
    const pollOnly = row({ subscriptionId: null, clientState: null, notificationUrl: null });
    const push = row({ subscriptionId: 'sub-push' });
    const { service, subscriptions, graphClient } = build([pollOnly, push]);

    await service.renewExpiringSubscriptions();

    expect(graphClient.renewSubscription).toHaveBeenCalledTimes(1);
    expect(graphClient.renewSubscription).toHaveBeenCalledWith(push.userId, 'microsoft', 'sub-push');
    expect(subscriptions.setExpiry).toHaveBeenCalledTimes(1);
    expect(subscriptions.setExpiry).toHaveBeenCalledWith(push.id, new Date(RENEWED_UNTIL));
    expect(subscriptions.deleteById).not.toHaveBeenCalled();
  });

  it('drops the record of a subscription that expired while renewal kept failing', async () => {
    // Past expiry Graph has dropped it anyway: renewing a corpse forever would
    // stop the next turn from creating a fresh one.
    const expired = row({ expiresAt: new Date(Date.now() - 60_000) });
    const { service, subscriptions, graphClient, logger } = build([expired]);
    graphClient.renewSubscription.mockRejectedValue(new Error('404 subscription not found'));

    await service.renewExpiringSubscriptions();

    expect(subscriptions.setExpiry).not.toHaveBeenCalled();
    expect(subscriptions.deleteById).toHaveBeenCalledWith(expired.id);
    expect(logger.error).toHaveBeenCalledWith('Mail subscription renewal failed', expect.objectContaining({
      userId: expired.userId,
      subscriptionId: 'sub-1',
      error: '404 subscription not found',
    }));
    expect(logger.warn).toHaveBeenCalledWith('Dropped an expired mail subscription record', { userId: expired.userId });
  });

  it('keeps a failing subscription that has not expired yet, so the next tick retries it', async () => {
    const stillValid = row({ expiresAt: new Date(Date.now() + 10 * 60_000) });
    const { service, subscriptions, graphClient, logger } = build([stillValid]);
    graphClient.renewSubscription.mockRejectedValue(new Error('graph unavailable'));

    await service.renewExpiringSubscriptions();

    expect(logger.error).toHaveBeenCalled();
    expect(subscriptions.setExpiry).not.toHaveBeenCalled();
    expect(subscriptions.deleteById).not.toHaveBeenCalled();
  });

  it('keeps renewing the others when one fails', async () => {
    const failing = row({ subscriptionId: 'sub-a' });
    const healthy = row({ subscriptionId: 'sub-b' });
    const { service, subscriptions, graphClient } = build([failing, healthy]);
    graphClient.renewSubscription.mockRejectedValueOnce(new Error('token expired'));

    await expect(service.renewExpiringSubscriptions()).resolves.toBeUndefined();

    expect(graphClient.renewSubscription).toHaveBeenCalledTimes(2);
    expect(subscriptions.setExpiry).toHaveBeenCalledTimes(1);
    expect(subscriptions.setExpiry).toHaveBeenCalledWith(healthy.id, new Date(RENEWED_UNTIL));
  });
});
