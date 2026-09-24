import { PlaybookFlowMailWebhookService } from './playbook-flow-mail-webhook.service';

describe('PlaybookFlowMailWebhookService', () => {
  it('only handles notifications for an enabled trigger with the matching subscription', async () => {
    const exec = jest.fn().mockResolvedValue(null);
    const findOne = jest.fn().mockReturnValue({ select: () => ({ lean: () => ({ exec }) }) });
    const graphClient = { getMessageByResource: jest.fn() };
    const handoffService = { handoffMatchedEvent: jest.fn() };
    const service = new PlaybookFlowMailWebhookService(
      { findOne } as any, {} as any, graphClient as any, {} as any,
      handoffService as any, {} as any, { setContext: jest.fn() } as any,
    );

    expect(await service.handleNotifications({ value: [] })).toEqual({ processed: 0, results: [] });
    await service.handleNotifications({ value: [
      { subscriptionId: { $ne: null }, clientState: 'flow-1', resourceData: { id: 'message-1' } },
      { subscriptionId: 'sub-1', resourceData: { id: 'message-1' } },
      { subscriptionId: 'sub-1', clientState: { $ne: null }, resourceData: { id: 'message-1' } },
    ] });
    expect(findOne).not.toHaveBeenCalled();
    await service.handleNotifications({ value: [{ subscriptionId: 'sub-1', clientState: 'flow-1', resourceData: { id: 'message-1' } }] });

    expect(findOne).toHaveBeenCalledWith({
      'triggerConfig.kind': 'mail',
      'triggerConfig.params.enabled': true,
      'triggerConfig.params.subscriptionId': 'sub-1',
      'triggerConfig.params.subscriptionClientState': 'flow-1',
    });
    expect(graphClient.getMessageByResource).not.toHaveBeenCalled();
    expect(handoffService.handoffMatchedEvent).not.toHaveBeenCalled();
  });

  it('rejects a mismatched stored subscription before fetching mail', async () => {
    const graphClient = { getMessageByResource: jest.fn() };
    const flow = { triggerConfig: { params: { subscriptionId: 'other', subscriptionClientState: 'flow-1' } } };
    const findOne = jest.fn().mockReturnValue({ select: () => ({ lean: () => ({ exec: async () => flow }) }) });
    const service = new PlaybookFlowMailWebhookService(
      { findOne } as any, {} as any, graphClient as any, {} as any, {} as any, {} as any, { setContext: jest.fn() } as any,
    );

    expect(await service.handleNotifications({ value: [{ subscriptionId: 'sub-1', clientState: 'flow-1', resourceData: { id: 'message-1' } }] }))
      .toEqual({ processed: 0, results: [] });
    flow.triggerConfig.params.subscriptionId = 'sub-1';
    flow.triggerConfig.params.subscriptionClientState = 'wrong';
    expect(await service.handleNotifications({ value: [{ subscriptionId: 'sub-1', clientState: 'flow-1', resourceData: { id: 'message-1' } }] }))
      .toEqual({ processed: 0, results: [] });
    expect(graphClient.getMessageByResource).not.toHaveBeenCalled();
  });

  it('hands off only after a matching incoming message is evaluated', async () => {
    const flow = {
      _id: { toString: () => 'flow-1' }, ownerId: 'owner-1',
      triggerConfig: { params: { enabled: true, subscriptionId: 'sub-1', subscriptionClientState: 'flow-1', mailboxAppKey: 'microsoft' } },
    };
    const findOne = jest.fn().mockReturnValue({ select: () => ({ lean: () => ({ exec: async () => flow }) }) });
    const graphClient = { getMessageByResource: jest.fn().mockResolvedValue({ id: 'message-1', receivedDateTime: new Date().toISOString() }) };
    const orchestrationService = { ingestAndEvaluate: jest.fn().mockResolvedValue({
      finalStatus: 'matched', match: { matched: true, reasons: [] }, ingestion: { duplicate: false, entry: { id: 'event-1' } },
    }) };
    const handoffService = { handoffMatchedEvent: jest.fn().mockResolvedValue({ executionId: 'execution-1', handedOff: true }) };
    const logger = { setContext: jest.fn(), log: jest.fn(), error: jest.fn() };
    const service = new PlaybookFlowMailWebhookService(
      { findOne } as any, {} as any, graphClient as any, orchestrationService as any,
      handoffService as any, {} as any, logger as any,
    );

    expect(await service.handleNotifications({ value: [] })).toMatchObject({ processed: 0 });
    expect(handoffService.handoffMatchedEvent).not.toHaveBeenCalled();
    const result = await service.handleNotifications({ value: [
      { subscriptionId: 'sub-1', clientState: 'flow-1', resourceData: { id: 'message-1' } },
    ] });
    expect(result.processed).toBe(1);
    expect(handoffService.handoffMatchedEvent).toHaveBeenCalledWith('flow-1', 'owner-1', 'event-1');
  });
});
