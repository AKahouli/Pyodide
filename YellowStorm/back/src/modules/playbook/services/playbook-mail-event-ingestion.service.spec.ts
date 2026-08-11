import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { PlaybookMailEventIngestionService } from './playbook-mail-event-ingestion.service';
import { PlaybookMailEventLedgerService } from './playbook-mail-event-ledger.service';
import { Playbook } from '../schemas/playbook.schema';
import { PlaybookMailEventLedger } from '../schemas/playbook-mail-event-ledger.schema';
import { NotFoundException } from '../../exceptions';

describe('PlaybookMailEventIngestionService', () => {
  let service: PlaybookMailEventIngestionService;
  let playbookModel: {
    findById: jest.Mock;
  };
  let ledgerModel: {
    create: jest.Mock;
    findOne: jest.Mock;
  };

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

  beforeEach(async () => {
    playbookModel = {
      findById: jest.fn(),
    };
    ledgerModel = {
      create: jest.fn(),
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybookMailEventIngestionService,
        PlaybookMailEventLedgerService,
        { provide: getModelToken(Playbook.name), useValue: playbookModel },
        { provide: getModelToken(PlaybookMailEventLedger.name), useValue: ledgerModel },
      ],
    }).compile();

    service = module.get(PlaybookMailEventIngestionService);
  });

  it('appends a new ledger entry when the event is not a duplicate', async () => {
    playbookModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'playbook-1' }) }) }),
    });
    ledgerModel.create.mockResolvedValue({});

    const result = await service.ingest('playbook-1', event);

    expect(result.duplicate).toBe(false);
    expect(result.entry.dedupeKey).toBe('m365:microsoft:msg-123');
    expect(ledgerModel.create).toHaveBeenCalled();
  });

  it('returns the existing entry when the event is a duplicate', async () => {
    playbookModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'playbook-1' }) }) }),
    });
    const duplicateError = { code: 11000 };
    ledgerModel.create.mockRejectedValue(duplicateError);
    ledgerModel.findOne.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          id: 'evt-1',
          dedupeKey: 'm365:microsoft:msg-123',
          status: 'normalized',
          provider: 'm365',
          mailboxAppKey: 'microsoft',
          providerMessageId: 'msg-123',
          providerThreadId: 'thread-1',
          receivedAt: new Date('2026-04-17T12:00:00Z'),
          occurredAt: new Date('2026-04-17T12:00:00Z'),
          subject: 'Invoice',
          bodyText: 'Please review',
          bodyHtml: null,
          from: { name: 'Ops', address: 'ops@example.com' },
          to: [],
          cc: [],
          hasAttachments: false,
          attachments: [],
          error: null,
          createdAt: new Date('2026-04-17T12:00:01Z'),
        }),
      }),
    });

    const result = await service.ingest('playbook-1', event);

    expect(result.duplicate).toBe(true);
    expect(result.entry.id).toBe('evt-1');
    expect(ledgerModel.findOne).toHaveBeenCalled();
  });

  it('throws when the playbook does not exist', async () => {
    playbookModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }) }),
    });

    await expect(service.ingest('missing-playbook', event)).rejects.toThrow(NotFoundException);
  });
});
