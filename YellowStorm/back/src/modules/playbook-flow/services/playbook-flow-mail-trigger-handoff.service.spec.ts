import { PlaybookFlowMailTriggerHandoffService } from './playbook-flow-mail-trigger-handoff.service';

describe('PlaybookFlowMailTriggerHandoffService', () => {
  it('passes trigger output port values to the execution only for a matched mail', async () => {
    const attachment = { filename: 'cv.pdf' };
    const entry = {
      id: 'event-1', status: 'matched', occurredAt: new Date('2026-09-24T08:00:00Z'),
      subject: 'CV', bodyText: 'Attached', from: { address: 'sender@example.com' },
      to: [], cc: [], hasAttachments: true, attachments: [attachment],
    };
    const ledgerModel = {
      findOne: jest.fn().mockReturnValue({ lean: () => ({ exec: async () => entry }) }),
      updateOne: jest.fn().mockReturnValue({ exec: async () => ({ modifiedCount: 1 }) }),
    };
    const executionService = { start: jest.fn().mockResolvedValue({ id: 'execution-1' }) };
    const service = new PlaybookFlowMailTriggerHandoffService(
      ledgerModel as any, executionService as any, { setContext: jest.fn() } as any,
    );

    expect(await service.handoffMatchedEvent('flow-1', 'owner-1', 'event-1')).toMatchObject({
      executionId: 'execution-1', handedOff: true,
    });
    expect(executionService.start).toHaveBeenCalledWith('flow-1', 'owner-1', {
      triggerContext: expect.objectContaining({ type: 'mail' }),
      mail_data: expect.objectContaining({ subject: 'CV', bodyText: 'Attached' }),
      mail_attachments: [attachment],
    }, 'mail:flow-1:event-1');
  });

  it('uses the same execution idempotency key for concurrent handoffs of one event', async () => {
    const entry = { id: 'event-1', status: 'matched', attachments: [] };
    const ledgerModel = {
      findOne: jest.fn().mockReturnValue({ lean: () => ({ exec: async () => entry }) }),
      updateOne: jest.fn().mockReturnValue({ exec: async () => ({ modifiedCount: 1 }) }),
    };
    const executionService = { start: jest.fn().mockResolvedValue({ id: 'execution-1' }) };
    const service = new PlaybookFlowMailTriggerHandoffService(
      ledgerModel as any, executionService as any, { setContext: jest.fn() } as any,
    );

    await Promise.all([
      service.handoffMatchedEvent('flow-1', 'owner-1', 'event-1'),
      service.handoffMatchedEvent('flow-1', 'owner-1', 'event-1'),
    ]);

    expect(executionService.start).toHaveBeenCalledTimes(2);
    expect(executionService.start.mock.calls.map((call) => call[3])).toEqual([
      'mail:flow-1:event-1', 'mail:flow-1:event-1',
    ]);
  });
});
