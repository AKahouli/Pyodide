import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { PlaybookMailTriggerOrchestrationService } from './playbook-mail-trigger-orchestration.service';
import { PlaybookMailEventIngestionService } from './playbook-mail-event-ingestion.service';
import { PlaybookMailTriggerMatcherService } from './playbook-mail-trigger-matcher.service';
import { Playbook } from '../schemas/playbook.schema';
import { PlaybookMailEventLedger } from '../schemas/playbook-mail-event-ledger.schema';

describe('PlaybookMailTriggerOrchestrationService', () => {
  let service: PlaybookMailTriggerOrchestrationService;
  let playbookModel: { findById: jest.Mock };
  let ledgerModel: { updateOne: jest.Mock };
  let ingestionService: { ingest: jest.Mock };

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

  beforeEach(async () => {
    playbookModel = {
      findById: jest.fn(),
    };
    ledgerModel = {
      updateOne: jest.fn(),
    };
    ingestionService = {
      ingest: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybookMailTriggerOrchestrationService,
        PlaybookMailTriggerMatcherService,
        { provide: PlaybookMailEventIngestionService, useValue: ingestionService },
        { provide: getModelToken(Playbook.name), useValue: playbookModel },
        { provide: getModelToken(PlaybookMailEventLedger.name), useValue: ledgerModel },
      ],
    }).compile();

    service = module.get(PlaybookMailTriggerOrchestrationService);
  });

  it('marks the ledger entry as matched when filters pass', async () => {
    playbookModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            mailTrigger: {
              filters: {
                from: ['ops@example.com'],
                subjectContains: ['invoice'],
                bodyContains: ['review'],
                hasAttachments: true,
              },
            },
          }),
        }),
      }),
    });
    ingestionService.ingest.mockResolvedValue({
      duplicate: false,
      entry: {
        id: 'evt-1',
        dedupeKey: 'm365:microsoft:msg-123',
        status: 'normalized',
        event,
        error: null,
        createdAt: '2026-04-17T12:00:01Z',
      },
    });
    ledgerModel.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

    const result = await service.ingestAndEvaluate('playbook-1', event);

    expect(result.finalStatus).toBe('matched');
    expect(result.match.matched).toBe(true);
  });

  it('marks the ledger entry as ignored when filters do not pass', async () => {
    playbookModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            mailTrigger: {
              filters: {
                from: ['alerts@example.com'],
                subjectContains: ['receipt'],
                bodyContains: ['tomorrow'],
                hasAttachments: false,
              },
            },
          }),
        }),
      }),
    });
    ingestionService.ingest.mockResolvedValue({
      duplicate: false,
      entry: {
        id: 'evt-1',
        dedupeKey: 'm365:microsoft:msg-123',
        status: 'normalized',
        event,
        error: null,
        createdAt: '2026-04-17T12:00:01Z',
      },
    });
    ledgerModel.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

    const result = await service.ingestAndEvaluate('playbook-1', event);

    expect(result.finalStatus).toBe('ignored');
    expect(result.match.reasons).toEqual(['from', 'subjectContains', 'bodyContains', 'hasAttachments']);
  });

  it('does not rematch duplicate events', async () => {
    playbookModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ mailTrigger: { filters: {} } }) }) }),
    });
    ingestionService.ingest.mockResolvedValue({
      duplicate: true,
      entry: {
        id: 'evt-1',
        dedupeKey: 'm365:microsoft:msg-123',
        status: 'matched',
        event,
        error: null,
        createdAt: '2026-04-17T12:00:01Z',
      },
    });

    const result = await service.ingestAndEvaluate('playbook-1', event);

    expect(result.finalStatus).toBe('matched');
    expect(ledgerModel.updateOne).not.toHaveBeenCalled();
  });
});
