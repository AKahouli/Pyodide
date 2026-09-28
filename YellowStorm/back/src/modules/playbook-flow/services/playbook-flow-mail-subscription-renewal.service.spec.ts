import { PlaybookFlowMailSubscriptionRenewalService } from './playbook-flow-mail-subscription-renewal.service';

describe('PlaybookFlowMailSubscriptionRenewalService', () => {
  const inMinutes = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();
  const mailFlow = (id: string, params: Record<string, unknown>) => ({
    id, ownerId: 'owner-1', workspaces: [],
    triggerConfig: { kind: 'mail', params: { runtimeEnabled: true, mailboxAppKey: 'microsoft', subscriptionId: `sub-${id}`, ...params } },
  });

  it('renews the runtime-enabled subscriptions whose stored ISO expiry falls within the window', async () => {
    const flows = {
      listByTrigger: jest.fn().mockResolvedValue([
        mailFlow('due', { subscriptionExpiresAt: inMinutes(5) }),
        mailFlow('later', { subscriptionExpiresAt: inMinutes(60) }),
        mailFlow('expired', { subscriptionExpiresAt: inMinutes(-1) }),
        mailFlow('none', { subscriptionId: null, subscriptionExpiresAt: inMinutes(5) }),
        mailFlow('unreadable', { subscriptionExpiresAt: 'soon' }),
        mailFlow('capped', { subscriptionExpiresAt: inMinutes(5), autoRenewUntil: inMinutes(-5) }),
      ]),
    };
    const graphClient = { renewSubscription: jest.fn().mockResolvedValue({ expirationDateTime: '2026-10-01T00:00:00.000Z' }) };
    const flowService = { update: jest.fn().mockResolvedValue({}) };
    const logger = { setContext: jest.fn(), log: jest.fn(), error: jest.fn() };
    const service = new PlaybookFlowMailSubscriptionRenewalService(flows as any, graphClient as any, flowService as any, logger as any);

    await service.renewExpiringSubscriptions();

    expect(flows.listByTrigger).toHaveBeenCalledWith('mail', { runtimeEnabled: true });
    expect(graphClient.renewSubscription).toHaveBeenCalledTimes(1);
    expect(graphClient.renewSubscription).toHaveBeenCalledWith('owner-1', 'microsoft', 'sub-due', undefined);
    expect(flowService.update).toHaveBeenCalledWith('due', 'owner-1', {
      triggerConfig: { kind: 'mail', params: expect.objectContaining({ subscriptionId: 'sub-due', subscriptionExpiresAt: '2026-10-01T00:00:00.000Z' }) },
    });
    expect(logger.log).toHaveBeenCalledWith('Renewing expiring mail subscriptions', { count: 2 });
  });

  it('logs a failed renewal and carries on', async () => {
    const flows = { listByTrigger: jest.fn().mockResolvedValue([mailFlow('a', { subscriptionExpiresAt: inMinutes(5) }), mailFlow('b', { subscriptionExpiresAt: inMinutes(5) })]) };
    const graphClient = { renewSubscription: jest.fn().mockRejectedValueOnce(new Error('graph down')).mockResolvedValueOnce({ expirationDateTime: null }) };
    const flowService = { update: jest.fn().mockResolvedValue({}) };
    const logger = { setContext: jest.fn(), log: jest.fn(), error: jest.fn() };
    const service = new PlaybookFlowMailSubscriptionRenewalService(flows as any, graphClient as any, flowService as any, logger as any);

    await service.renewExpiringSubscriptions();

    expect(logger.error).toHaveBeenCalledWith('Mail subscription renewal failed', { flowId: 'a', subscriptionId: 'sub-a', error: 'graph down' });
    expect(flowService.update).toHaveBeenCalledTimes(1);
    expect(flowService.update.mock.calls[0][2].triggerConfig.params.subscriptionExpiresAt).toBeNull();
  });
});
