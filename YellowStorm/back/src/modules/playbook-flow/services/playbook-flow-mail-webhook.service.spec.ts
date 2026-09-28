import { PlaybookFlowMailWebhookService } from './playbook-flow-mail-webhook.service';

describe('PlaybookFlowMailWebhookService', () => {
  const logger = () => ({ setContext: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn() });

  it('only handles notifications for an enabled trigger with the matching subscription', async () => {
    const listByTrigger = jest.fn().mockResolvedValue([]);
    const graphClient = { getMessageByResource: jest.fn() };
    const handoffService = { handoffMatchedEvent: jest.fn() };
    const service = new PlaybookFlowMailWebhookService(
      { listByTrigger } as any, {} as any, graphClient as any, {} as any,
      handoffService as any, {} as any, logger() as any,
    );

    expect(await service.handleNotifications({ value: [] })).toEqual({ processed: 0, results: [] });
    await service.handleNotifications({ value: [
      { subscriptionId: { $ne: null }, clientState: 'flow-1', resourceData: { id: 'message-1' } },
      { subscriptionId: 'sub-1', resourceData: { id: 'message-1' } },
      { subscriptionId: 'sub-1', clientState: { $ne: null }, resourceData: { id: 'message-1' } },
    ] });
    expect(listByTrigger).not.toHaveBeenCalled();
    await service.handleNotifications({ value: [{ subscriptionId: 'sub-1', clientState: 'flow-1', resourceData: { id: 'message-1' } }] });

    expect(listByTrigger).toHaveBeenCalledWith('mail', {
      enabled: true,
      subscriptionId: 'sub-1',
      subscriptionClientState: 'flow-1',
    });
    expect(graphClient.getMessageByResource).not.toHaveBeenCalled();
    expect(handoffService.handoffMatchedEvent).not.toHaveBeenCalled();
  });

  it('rejects a mismatched stored subscription before fetching mail', async () => {
    const graphClient = { getMessageByResource: jest.fn() };
    const flow = { id: 'flow-1', ownerId: 'owner-1', workspaces: [], triggerConfig: { params: { subscriptionId: 'other', subscriptionClientState: 'flow-1' } } };
    const listByTrigger = jest.fn().mockResolvedValue([flow]);
    const service = new PlaybookFlowMailWebhookService(
      { listByTrigger } as any, {} as any, graphClient as any, {} as any, {} as any, {} as any, logger() as any,
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
      id: 'flow-1', ownerId: 'owner-1', workspaces: [],
      triggerConfig: { params: { enabled: true, subscriptionId: 'sub-1', subscriptionClientState: 'flow-1', mailboxAppKey: 'microsoft' } },
    };
    const listByTrigger = jest.fn().mockResolvedValue([flow]);
    const graphClient = { getMessageByResource: jest.fn().mockResolvedValue({ id: 'message-1', receivedDateTime: new Date().toISOString() }) };
    const orchestrationService = { ingestAndEvaluate: jest.fn().mockResolvedValue({
      finalStatus: 'matched', match: { matched: true, reasons: [] }, ingestion: { duplicate: false, entry: { id: 'event-1' } },
    }) };
    const handoffService = { handoffMatchedEvent: jest.fn().mockResolvedValue({ executionId: 'execution-1', handedOff: true }) };
    const service = new PlaybookFlowMailWebhookService(
      { listByTrigger } as any, {} as any, graphClient as any, orchestrationService as any,
      handoffService as any, {} as any, logger() as any,
    );

    expect(await service.handleNotifications({ value: [] })).toMatchObject({ processed: 0 });
    expect(handoffService.handoffMatchedEvent).not.toHaveBeenCalled();
    const result = await service.handleNotifications({ value: [
      { subscriptionId: 'sub-1', clientState: 'flow-1', resourceData: { id: 'message-1' } },
    ] });
    expect(result.processed).toBe(1);
    expect(orchestrationService.ingestAndEvaluate).toHaveBeenCalledWith('flow-1', expect.objectContaining({ mailboxAppKey: 'microsoft', providerMessageId: 'message-1' }));
    expect(handoffService.handoffMatchedEvent).toHaveBeenCalledWith('flow-1', 'owner-1', 'event-1');
  });

  it('records the imported attachments on the ledger entry of a new matched message', async () => {
    const workspaceId = '6a272d051f4e6f361ed9846d';
    const flow = {
      id: 'flow-1', ownerId: 'owner-1', workspaces: [workspaceId],
      triggerConfig: { params: { enabled: true, subscriptionId: 'sub-1', subscriptionClientState: 'flow-1', mailboxAppKey: 'microsoft', attachmentImportEnabled: true, allowedAttachmentExtensions: ['pdf'] } },
    };
    const graphClient = {
      getMessageByResource: jest.fn().mockResolvedValue({ id: 'message-1', hasAttachments: true, receivedDateTime: new Date().toISOString() }),
      listAttachments: jest.fn().mockResolvedValue([{ id: 'att-1', name: 'notes.txt', contentType: 'text/plain', size: 3 }]),
    };
    const ledger = { setAttachments: jest.fn().mockResolvedValue(true) };
    const orchestrationService = { ingestAndEvaluate: jest.fn().mockResolvedValue({
      finalStatus: 'matched', match: { matched: true, reasons: [] }, ingestion: { duplicate: false, entry: { id: 'event-1' } },
    }) };
    const handoffService = { handoffMatchedEvent: jest.fn().mockResolvedValue({ executionId: 'execution-1', handedOff: true }) };
    const service = new PlaybookFlowMailWebhookService(
      { listByTrigger: jest.fn().mockResolvedValue([flow]) } as any, ledger as any, graphClient as any, orchestrationService as any,
      handoffService as any, {} as any, logger() as any,
    );

    await service.handleNotifications({ value: [{ subscriptionId: 'sub-1', clientState: 'flow-1', resourceData: { id: 'message-1' } }] });

    expect(ledger.setAttachments).toHaveBeenCalledWith('event-1', [expect.objectContaining({
      providerAttachmentId: 'att-1', filename: 'notes.txt',
      workspaceImport: expect.objectContaining({ workspaceDocumentId: null, error: 'Extension .txt not allowed' }),
    })]);
    expect(handoffService.handoffMatchedEvent).toHaveBeenCalledWith('flow-1', 'owner-1', 'event-1');
  });
});
