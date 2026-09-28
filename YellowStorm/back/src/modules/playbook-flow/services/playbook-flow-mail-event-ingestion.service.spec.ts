import { NotFoundException } from '@nestjs/common';
import { PlaybookFlowMailEventIngestionService } from './playbook-flow-mail-event-ingestion.service';
import { PlaybookFlowMailEventLedgerService } from './playbook-flow-mail-event-ledger.service';

describe('PlaybookFlowMailEventIngestionService', () => {
  const flowId = '6a272d051f4e6f361ed9846d';
  const event = {
    provider: 'm365' as const,
    mailboxAppKey: 'microsoft',
    providerMessageId: 'msg-1',
    providerThreadId: null,
    receivedAt: '2026-09-24T08:00:00.000Z',
    occurredAt: '2026-09-24T08:00:00.000Z',
    subject: 'Invoice',
    bodyText: 'Body',
    bodyHtml: null,
    from: { name: null, address: 'a@example.com' },
    to: [],
    cc: [],
    hasAttachments: false,
    attachments: [],
  };

  it('records a new event under its generated ledger id and returns the entry', async () => {
    const ledger = { insertIfNew: jest.fn().mockImplementation(async (row) => ({ ...row, id: 'row-id', executionId: null })), findByDedupeKey: jest.fn() };
    const service = new PlaybookFlowMailEventIngestionService(
      { findOwnerRef: jest.fn().mockResolvedValue({ id: flowId, ownerId: 'o' }) } as any, ledger as any, new PlaybookFlowMailEventLedgerService(),
    );

    const result = await service.ingest(flowId.toUpperCase(), event);

    expect(result.duplicate).toBe(false);
    expect(result.entry).toMatchObject({ dedupeKey: 'm365:microsoft:msg-1', status: 'normalized', event, error: null });
    expect(ledger.insertIfNew).toHaveBeenCalledWith(expect.objectContaining({
      ledgerId: result.entry.id,
      flowId,
      dedupeKey: 'm365:microsoft:msg-1',
      status: 'normalized',
      receivedAt: new Date(event.receivedAt),
      from: event.from,
      createdAt: new Date(result.entry.createdAt),
    }));
    expect(ledger.findByDedupeKey).not.toHaveBeenCalled();
  });

  it('returns the stored entry of a duplicate, keyed by its ledger id', async () => {
    const stored = {
      id: 'row-id', ledgerId: 'ledger-0', flowId, dedupeKey: 'm365:microsoft:msg-1', status: 'matched', provider: 'm365',
      mailboxAppKey: 'microsoft', providerMessageId: 'msg-1', providerThreadId: null,
      receivedAt: new Date(event.receivedAt), occurredAt: new Date(event.occurredAt), subject: 'Invoice', bodyText: 'Body', bodyHtml: null,
      from: event.from, to: [], cc: [], hasAttachments: false, attachments: [], error: null, executionId: null,
      createdAt: new Date('2026-09-24T08:00:01.000Z'),
    };
    const ledger = { insertIfNew: jest.fn().mockResolvedValue(null), findByDedupeKey: jest.fn().mockResolvedValue(stored) };
    const service = new PlaybookFlowMailEventIngestionService(
      { findOwnerRef: jest.fn().mockResolvedValue({ id: flowId, ownerId: 'o' }) } as any, ledger as any, new PlaybookFlowMailEventLedgerService(),
    );

    expect(await service.ingest(flowId, event)).toEqual({
      duplicate: true,
      entry: { id: 'ledger-0', dedupeKey: 'm365:microsoft:msg-1', status: 'matched', event, error: null, createdAt: '2026-09-24T08:00:01.000Z' },
    });
    expect(ledger.findByDedupeKey).toHaveBeenCalledWith(flowId, 'm365:microsoft:msg-1');
  });

  it('refuses a flow that does not exist', async () => {
    const ledger = { insertIfNew: jest.fn() };
    const service = new PlaybookFlowMailEventIngestionService(
      { findOwnerRef: jest.fn().mockResolvedValue(null) } as any, ledger as any, new PlaybookFlowMailEventLedgerService(),
    );
    await expect(service.ingest(flowId, event)).rejects.toBeInstanceOf(NotFoundException);
    expect(ledger.insertIfNew).not.toHaveBeenCalled();
  });
});
