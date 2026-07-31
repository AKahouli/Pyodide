import { PlaybookMailTriggerMatcherService } from './playbook-mail-trigger-matcher.service';

describe('PlaybookMailTriggerMatcherService', () => {
  let service: PlaybookMailTriggerMatcherService;

  const event = {
    provider: 'm365' as const,
    mailboxAppKey: 'microsoft',
    providerMessageId: 'msg-123',
    providerThreadId: 'thread-1',
    receivedAt: '2026-04-17T12:00:00Z',
    occurredAt: '2026-04-17T12:00:00Z',
    subject: 'Urgent invoice received',
    bodyText: 'Please review this invoice today',
    bodyHtml: null,
    from: { name: 'Ops', address: 'ops@example.com' },
    to: [{ name: null, address: 'user@example.com' }],
    cc: [],
    hasAttachments: true,
    attachments: [],
  };

  beforeEach(() => {
    service = new PlaybookMailTriggerMatcherService();
  });

  it('matches when all configured filters pass', () => {
    const result = service.match(
      {
        from: ['ops@example.com'],
        subjectContains: ['invoice'],
        bodyContains: ['review'],
        hasAttachments: true,
      },
      event,
    );

    expect(result).toEqual({ matched: true, reasons: [] });
  });

  it('returns failing filter reasons when conditions do not match', () => {
    const result = service.match(
      {
        from: ['alerts@example.com'],
        subjectContains: ['receipt'],
        bodyContains: ['tomorrow'],
        hasAttachments: false,
      },
      event,
    );

    expect(result.matched).toBe(false);
    expect(result.reasons).toEqual(['from', 'subjectContains', 'bodyContains', 'hasAttachments']);
  });

  it('treats empty filter lists as non-restrictive', () => {
    const result = service.match(
      {
        from: [],
        subjectContains: [],
        bodyContains: [],
        hasAttachments: null,
      },
      event,
    );

    expect(result).toEqual({ matched: true, reasons: [] });
  });
});
