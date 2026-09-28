import { PlaybookFlowMailTriggerHandoffService } from './playbook-flow-mail-trigger-handoff.service';

describe('PlaybookFlowMailTriggerHandoffService', () => {
  const logger = () => ({ setContext: jest.fn(), warn: jest.fn() });

  it('passes trigger output port values to the execution only for a matched mail', async () => {
    const attachment = { filename: 'cv.pdf' };
    const entry = {
      ledgerId: 'event-1', status: 'matched', occurredAt: new Date('2026-09-24T08:00:00Z'),
      subject: 'CV', bodyText: 'Attached', from: { address: 'sender@example.com' },
      to: [], cc: [], hasAttachments: true, attachments: [attachment], executionId: null,
    };
    const ledger = {
      findByLedgerId: jest.fn().mockResolvedValue(entry),
      markHandedOff: jest.fn().mockResolvedValue(true),
    };
    const executionService = { start: jest.fn().mockResolvedValue({ id: 'execution-1' }) };
    const service = new PlaybookFlowMailTriggerHandoffService(ledger as any, executionService as any, logger() as any);

    expect(await service.handoffMatchedEvent('flow-1', 'owner-1', 'event-1')).toMatchObject({
      executionId: 'execution-1', handedOff: true,
    });
    expect(ledger.findByLedgerId).toHaveBeenCalledWith('event-1', 'flow-1');
    expect(executionService.start).toHaveBeenCalledWith('flow-1', 'owner-1', {
      triggerContext: expect.objectContaining({ type: 'mail', occurredAt: '2026-09-24T08:00:00.000Z' }),
      mail_data: expect.objectContaining({ subject: 'CV', bodyText: 'Attached' }),
      mail_attachments: [attachment],
    }, 'mail:flow-1:event-1');
    expect(ledger.markHandedOff).toHaveBeenCalledWith('event-1', 'execution-1');
  });

  it('uses the same execution idempotency key for concurrent handoffs of one event and reports the loser as duplicate', async () => {
    const entry = { ledgerId: 'event-1', status: 'matched', occurredAt: new Date(), attachments: [] };
    const ledger = {
      findByLedgerId: jest.fn().mockResolvedValue(entry),
      markHandedOff: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    };
    const executionService = { start: jest.fn().mockResolvedValue({ id: 'execution-1' }) };
    const service = new PlaybookFlowMailTriggerHandoffService(ledger as any, executionService as any, logger() as any);

    const results = await Promise.all([
      service.handoffMatchedEvent('flow-1', 'owner-1', 'event-1'),
      service.handoffMatchedEvent('flow-1', 'owner-1', 'event-1'),
    ]);

    expect(executionService.start).toHaveBeenCalledTimes(2);
    expect(executionService.start.mock.calls.map((call) => call[3])).toEqual([
      'mail:flow-1:event-1', 'mail:flow-1:event-1',
    ]);
    expect(results.map((r) => r.skippedReason).sort()).toEqual(['duplicate', null].sort());
  });

  it('does not start a run for an entry that is missing, already handed off or not matched', async () => {
    const executionService = { start: jest.fn() };
    const ledger = { findByLedgerId: jest.fn(), markHandedOff: jest.fn() };
    const service = new PlaybookFlowMailTriggerHandoffService(ledger as any, executionService as any, logger() as any);

    ledger.findByLedgerId.mockResolvedValueOnce(null);
    expect(await service.handoffMatchedEvent('flow-1', 'owner-1', 'event-1')).toEqual({ executionId: null, handedOff: false, skippedReason: 'not-matched' });
    ledger.findByLedgerId.mockResolvedValueOnce({ status: 'handed_off', executionId: 'execution-0' });
    expect(await service.handoffMatchedEvent('flow-1', 'owner-1', 'event-1')).toEqual({ executionId: 'execution-0', handedOff: false, skippedReason: 'already-handed-off' });
    ledger.findByLedgerId.mockResolvedValueOnce({ status: 'ignored', executionId: null });
    expect(await service.handoffMatchedEvent('flow-1', 'owner-1', 'event-1')).toEqual({ executionId: null, handedOff: false, skippedReason: 'not-matched' });
    expect(executionService.start).not.toHaveBeenCalled();
  });
});
