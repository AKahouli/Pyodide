import { PlaybookMailEventLedgerService } from './playbook-mail-event-ledger.service';

describe('PlaybookMailEventLedgerService', () => {
  let service: PlaybookMailEventLedgerService;

  beforeEach(() => {
    service = new PlaybookMailEventLedgerService();
  });

  const event = {
    provider: 'm365' as const,
    mailboxAppKey: 'microsoft',
    providerMessageId: 'msg-123',
    providerThreadId: 'thread-1',
    receivedAt: '2026-04-17T12:00:00Z',
    occurredAt: '2026-04-17T12:00:00Z',
    subject: 'Invoice',
    bodyText: 'Please review',
    bodyHtml: null,
    from: { name: 'Ops', address: 'ops@example.com' },
    to: [{ name: null, address: 'user@example.com' }],
    cc: [],
    hasAttachments: false,
    attachments: [],
  };

  it('builds a stable dedupe key from provider, mailbox, and message id', () => {
    expect(service.buildDedupeKey(event)).toBe('m365:microsoft:msg-123');
  });

  it('creates a normalized ledger entry', () => {
    const entry = service.createLedgerEntry(event);
    expect(entry.dedupeKey).toBe('m365:microsoft:msg-123');
    expect(entry.status).toBe('normalized');
    expect(entry.event.providerMessageId).toBe('msg-123');
  });

  it('detects duplicate events by dedupe key', () => {
    expect(service.isDuplicate([{ dedupeKey: 'm365:microsoft:msg-123' }], event)).toBe(true);
    expect(service.isDuplicate([{ dedupeKey: 'm365:microsoft:msg-999' }], event)).toBe(false);
  });
});
