import { PlaybookFlowMailEventLedgerService } from './playbook-flow-mail-event-ledger.service';

describe('PlaybookFlowMailEventLedgerService', () => {
  let service: PlaybookFlowMailEventLedgerService;

  const event = {
    provider: 'm365' as const,
    mailboxAppKey: 'microsoft',
    providerMessageId: 'msg-456',
    providerThreadId: null,
    receivedAt: '2026-04-17T12:00:00Z',
    occurredAt: '2026-04-17T12:00:00Z',
    subject: 'Test',
    bodyText: 'Body',
    bodyHtml: null,
    from: { name: null, address: 'a@b.com' },
    to: [],
    cc: [],
    hasAttachments: false,
    attachments: [],
  };

  beforeEach(() => {
    service = new PlaybookFlowMailEventLedgerService();
  });

  it('builds a dedupe key from provider, mailboxAppKey, and messageId', () => {
    const key = service.buildDedupeKey(event);
    expect(key).toBe('m365:microsoft:msg-456');
  });

  it('creates a ledger entry with nanoid, normalized status, and timestamps', () => {
    const entry = service.createLedgerEntry(event);
    expect(entry.id).toBeDefined();
    expect(typeof entry.id).toBe('string');
    expect(entry.id.length).toBeGreaterThan(0);
    expect(entry.dedupeKey).toBe('m365:microsoft:msg-456');
    expect(entry.status).toBe('normalized');
    expect(entry.event).toBe(event);
    expect(entry.error).toBeNull();
    expect(entry.createdAt).toBeDefined();
  });

  it('creates unique ids for different entries', () => {
    const e1 = service.createLedgerEntry(event);
    const e2 = service.createLedgerEntry(event);
    expect(e1.id).not.toBe(e2.id);
  });

  it('detects duplicates by dedupe key', () => {
    const entries = [
      { dedupeKey: 'm365:microsoft:msg-456' },
      { dedupeKey: 'm365:microsoft:msg-789' },
    ];
    expect(service.isDuplicate(entries, event)).toBe(true);
  });

  it('returns false when no duplicate found', () => {
    const entries = [{ dedupeKey: 'm365:microsoft:msg-789' }];
    expect(service.isDuplicate(entries, event)).toBe(false);
    expect(service.isDuplicate([], event)).toBe(false);
  });
});
