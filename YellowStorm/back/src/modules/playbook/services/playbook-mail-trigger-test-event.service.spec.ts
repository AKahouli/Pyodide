import { Test, TestingModule } from '@nestjs/testing';
import { PlaybookMailTriggerTestEventService } from './playbook-mail-trigger-test-event.service';
import { ConnectedAppTokenService } from '../../connected-app/services/connected-app-token.service';
import { PlaybookMailTriggerOrchestrationService } from './playbook-mail-trigger-orchestration.service';
import { PlaybookMailTriggerHandoffService } from './playbook-mail-trigger-handoff.service';

describe('PlaybookMailTriggerTestEventService', () => {
  let service: PlaybookMailTriggerTestEventService;
  let connectedAppTokenService: { getMailboxCapability: jest.Mock };
  let orchestrationService: { ingestAndEvaluate: jest.Mock };
  let handoffService: { handoffMatchedEvent: jest.Mock };

  beforeEach(async () => {
    connectedAppTokenService = {
      getMailboxCapability: jest.fn().mockResolvedValue({
        appKey: 'microsoft',
        connected: true,
        mailboxReady: true,
        missingScopes: [],
        grantedScopes: ['mail.read'],
      }),
    };
    orchestrationService = {
      ingestAndEvaluate: jest.fn(),
    };
    handoffService = {
      handoffMatchedEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybookMailTriggerTestEventService,
        { provide: ConnectedAppTokenService, useValue: connectedAppTokenService },
        { provide: PlaybookMailTriggerOrchestrationService, useValue: orchestrationService },
        { provide: PlaybookMailTriggerHandoffService, useValue: handoffService },
      ],
    }).compile();

    service = module.get(PlaybookMailTriggerTestEventService);
  });

  it('hands off when the synthetic event matches', async () => {
    orchestrationService.ingestAndEvaluate.mockResolvedValue({
      ingestion: { entry: { id: 'evt-1' } },
      match: { matched: true, reasons: [] },
      finalStatus: 'matched',
    });
    handoffService.handoffMatchedEvent.mockResolvedValue({
      executionId: 'exec-1',
      handedOff: true,
      skippedReason: null,
    });

    const result = await service.processTestEvent('p1', 'u1', 'u@example.com', {
      mailboxAppKey: 'microsoft',
      providerMessageId: 'msg-123',
      receivedAt: '2026-04-17T12:00:00Z',
      occurredAt: '2026-04-17T12:00:00Z',
      subject: 'Invoice',
      bodyText: 'Please review',
      from: { address: 'ops@example.com' },
    } as any);

    expect(orchestrationService.ingestAndEvaluate).toHaveBeenCalled();
    expect(handoffService.handoffMatchedEvent).toHaveBeenCalledWith('p1', 'u1', 'u@example.com', 'evt-1');
    expect(result.handoff.executionId).toBe('exec-1');
  });

  it('does not hand off when the synthetic event is ignored', async () => {
    orchestrationService.ingestAndEvaluate.mockResolvedValue({
      ingestion: { entry: { id: 'evt-1' } },
      match: { matched: false, reasons: ['from'] },
      finalStatus: 'ignored',
    });

    const result = await service.processTestEvent('p1', 'u1', 'u@example.com', {
      mailboxAppKey: 'microsoft',
      providerMessageId: 'msg-123',
      receivedAt: '2026-04-17T12:00:00Z',
      occurredAt: '2026-04-17T12:00:00Z',
      from: { address: 'ops@example.com' },
    } as any);

    expect(handoffService.handoffMatchedEvent).not.toHaveBeenCalled();
    expect(result.handoff.skippedReason).toBe('not-matched');
  });
});
