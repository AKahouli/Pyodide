import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { PlaybookMailTriggerHandoffService } from './playbook-mail-trigger-handoff.service';
import { PlaybookMailEventLedger } from '../schemas/playbook-mail-event-ledger.schema';
import { PlaybookExecutionService } from './playbook-execution.service';

describe('PlaybookMailTriggerHandoffService', () => {
  let service: PlaybookMailTriggerHandoffService;
  let ledgerModel: { findOne: jest.Mock; updateOne: jest.Mock };
  let executionService: { executePlaybook: jest.Mock };

  beforeEach(async () => {
    ledgerModel = {
      findOne: jest.fn(),
      updateOne: jest.fn(),
    };
    executionService = {
      executePlaybook: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybookMailTriggerHandoffService,
        { provide: getModelToken(PlaybookMailEventLedger.name), useValue: ledgerModel },
        { provide: PlaybookExecutionService, useValue: executionService },
      ],
    }).compile();

    service = module.get(PlaybookMailTriggerHandoffService);
  });

  it('creates an execution and marks the ledger row as handed off', async () => {
    ledgerModel.findOne.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ id: 'evt-1', playbookId: 'p1', status: 'matched', subject: 'Invoice', executionId: null }),
      }),
    });
    executionService.executePlaybook.mockResolvedValue({ executionId: 'exec-1' });
    ledgerModel.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) });

    const result = await service.handoffMatchedEvent('p1', 'u1', 'u@example.com', 'evt-1');

    expect(result).toEqual({ executionId: 'exec-1', handedOff: true, skippedReason: null });
  });

  it('returns already-handed-off when the ledger row is already linked to an execution', async () => {
    ledgerModel.findOne.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ id: 'evt-1', playbookId: 'p1', status: 'handed_off', subject: 'Invoice', executionId: 'exec-1' }),
      }),
    });

    const result = await service.handoffMatchedEvent('p1', 'u1', 'u@example.com', 'evt-1');

    expect(result).toEqual({ executionId: 'exec-1', handedOff: false, skippedReason: 'already-handed-off' });
    expect(executionService.executePlaybook).not.toHaveBeenCalled();
  });
});
