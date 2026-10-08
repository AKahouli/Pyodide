import { PlaybookFlowMailSubscriptionRenewalService } from './playbook-flow-mail-subscription-renewal.service';

describe('PlaybookFlowMailSubscriptionRenewalService', () => {
  const inMinutes = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();
  const mailFlow = (id: string, params: Record<string, unknown>) => ({
    id, ownerId: 'owner-1', workspaces: [],
    triggerConfig: { kind: 'mail', params: { runtimeEnabled: true, mailboxAppKey: 'microsoft', subscriptionId: `sub-${id}`, ...params } },
  });
  const logger = () => ({ setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() });

  it('renews the runtime-enabled subscriptions whose stored ISO expiry falls within the window', async () => {
    const flows = {
      listByTrigger: jest.fn().mockResolvedValue([
        mailFlow('due', { subscriptionExpiresAt: inMinutes(5), subscriptionClientState: 'random-secret' }),
        mailFlow('later', { subscriptionExpiresAt: inMinutes(60), subscriptionClientState: 'random-secret' }),
        mailFlow('expired', { subscriptionExpiresAt: inMinutes(-1), subscriptionClientState: 'random-secret' }),
        mailFlow('none', { subscriptionId: null, subscriptionExpiresAt: inMinutes(5), subscriptionClientState: 'random-secret' }),
        mailFlow('unreadable', { subscriptionExpiresAt: 'soon', subscriptionClientState: 'random-secret' }),
        mailFlow('capped', { subscriptionExpiresAt: inMinutes(5), autoRenewUntil: inMinutes(-5), subscriptionClientState: 'random-secret' }),
      ]),
    };
    const graphClient = { renewSubscription: jest.fn().mockResolvedValue({ expirationDateTime: '2026-10-01T00:00:00.000Z' }) };
    const flowService = { update: jest.fn().mockResolvedValue({}) };
    const service = new PlaybookFlowMailSubscriptionRenewalService(flows as any, graphClient as any, flowService as any, logger() as any);

    await service.renewExpiringSubscriptions();

    expect(flows.listByTrigger).toHaveBeenCalledWith('mail', { runtimeEnabled: true });
    expect(graphClient.renewSubscription).toHaveBeenCalledTimes(1);
    expect(graphClient.renewSubscription).toHaveBeenCalledWith('owner-1', 'microsoft', 'sub-due', undefined);
    expect(flowService.update).toHaveBeenCalledWith('due', 'owner-1', {
      triggerConfig: { kind: 'mail', params: expect.objectContaining({ subscriptionId: 'sub-due', subscriptionExpiresAt: '2026-10-01T00:00:00.000Z' }) },
    });
  });

  it('logs a failed renewal and carries on', async () => {
    const flows = { listByTrigger: jest.fn().mockResolvedValue([
      mailFlow('a', { subscriptionExpiresAt: inMinutes(5), subscriptionClientState: 'random-secret' }),
      mailFlow('b', { subscriptionExpiresAt: inMinutes(5), subscriptionClientState: 'random-secret' }),
    ]) };
    const graphClient = { renewSubscription: jest.fn().mockRejectedValueOnce(new Error('graph down')).mockResolvedValueOnce({ expirationDateTime: null }) };
    const flowService = { update: jest.fn().mockResolvedValue({}) };
    const mockLogger = logger();
    const service = new PlaybookFlowMailSubscriptionRenewalService(flows as any, graphClient as any, flowService as any, mockLogger as any);

    await service.renewExpiringSubscriptions();

    expect(mockLogger.error).toHaveBeenCalledWith('Mail subscription renewal failed', { flowId: 'a', subscriptionId: 'sub-a', error: 'graph down' });
    expect(flowService.update).toHaveBeenCalledTimes(1);
    expect(flowService.update.mock.calls[0][2].triggerConfig.params.subscriptionExpiresAt).toBeNull();
  });

  it('rotates a legacy subscription (clientState = flow id) by re-creating it with a random secret', async () => {
    // Existing flows subscribed before random clientStates stored the flow id
    // as the clientState — the guessable-secret era. PATCH cannot rotate a
    // clientState, so renewal re-creates the subscription instead.
    const flows = {
      listByTrigger: jest.fn().mockResolvedValue([
        mailFlow('legacy', {
          subscriptionExpiresAt: inMinutes(5),
          subscriptionClientState: 'legacy',
          subscriptionNotificationUrl: 'https://example.test/webhook',
        }),
      ]),
    };
    const graphClient = {
      createInboxSubscription: jest.fn().mockResolvedValue({
        subscription: { id: 'sub-new', expirationDateTime: '2026-10-02T00:00:00.000Z' },
        resolvedAppKey: 'm365',
      }),
      deleteSubscription: jest.fn().mockResolvedValue(undefined),
      renewSubscription: jest.fn(),
    };
    const flowService = { update: jest.fn().mockResolvedValue({}) };
    const service = new PlaybookFlowMailSubscriptionRenewalService(flows as any, graphClient as any, flowService as any, logger() as any);

    await service.renewExpiringSubscriptions();

    expect(graphClient.renewSubscription).not.toHaveBeenCalled();
    const [, , url, clientState] = graphClient.createInboxSubscription.mock.calls[0];
    expect(url).toBe('https://example.test/webhook');
    expect(clientState).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(clientState).not.toBe('legacy');
    expect(graphClient.deleteSubscription).toHaveBeenCalledWith('owner-1', 'microsoft', 'sub-legacy');
    expect(flowService.update).toHaveBeenCalledWith('legacy', 'owner-1', {
      triggerConfig: { kind: 'mail', params: expect.objectContaining({
        subscriptionId: 'sub-new',
        subscriptionClientState: clientState,
        subscriptionExpiresAt: '2026-10-02T00:00:00.000Z',
      }) },
    });
  });

  it('renews a legacy subscription without a stored URL and says why rotation did not happen', async () => {
    const flows = {
      listByTrigger: jest.fn().mockResolvedValue([
        mailFlow('legacy-nourl', { subscriptionExpiresAt: inMinutes(5), subscriptionClientState: 'legacy-nourl' }),
      ]),
    };
    const graphClient = { renewSubscription: jest.fn().mockResolvedValue({ expirationDateTime: '2026-10-01T00:00:00.000Z' }) };
    const flowService = { update: jest.fn().mockResolvedValue({}) };
    const mockLogger = logger();
    const service = new PlaybookFlowMailSubscriptionRenewalService(flows as any, graphClient as any, flowService as any, mockLogger as any);

    await service.renewExpiringSubscriptions();

    expect(mockLogger.warn).toHaveBeenCalled();
    expect(graphClient.renewSubscription).toHaveBeenCalledWith('owner-1', 'microsoft', 'sub-legacy-nourl', undefined);
  });
});
