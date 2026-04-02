import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { PlaybookScheduleRunnerService } from './playbook-schedule-runner.service';
import { Playbook } from '../schemas/playbook.schema';
import { PlaybookExecution, ExecutionStatus } from '../schemas/playbook-execution.schema';
import { PlaybookExecutionService } from './playbook-execution.service';
import { PlaybookGrpcService } from './playbook-grpc.service';
import { LoggerService } from '../../logger';
import { isExecutionScheduleDueThisMinute } from '../utils/playbook-schedule.util';

jest.mock('../utils/playbook-schedule.util', () => ({
  isExecutionScheduleDueThisMinute: jest.fn(),
}));

const mockedIsDue = isExecutionScheduleDueThisMinute as jest.MockedFunction<typeof isExecutionScheduleDueThisMinute>;

function asyncIterableFrom<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) {
        yield item;
      }
    },
  };
}

function createFindCursorChain(docs: Record<string, unknown>[]) {
  return {
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        cursor: jest.fn().mockReturnValue(asyncIterableFrom(docs)),
      }),
    }),
  };
}

describe('PlaybookScheduleRunnerService', () => {
  let service: PlaybookScheduleRunnerService;
  let mockPlaybookModel: {
    find: jest.Mock;
    updateOne: jest.Mock;
  };
  let mockExecutionModel: {
    findOne: jest.Mock;
    find: jest.Mock;
  };
  let mockExecutionService: { executePlaybook: jest.Mock };
  let mockGrpcService: { isAvailable: boolean };
  let mockLogger: {
    setContext: jest.Mock;
    log: jest.Mock;
    warn: jest.Mock;
    debug: jest.Mock;
  };

  const userId = new Types.ObjectId();
  const playbookId = new Types.ObjectId();

  const baseSchedule = {
    enabled: true,
    timezone: 'UTC',
    type: 'daily' as const,
    lastScheduledRunAt: null,
    daily: { timesLocal: ['09:00'] },
    weekly: null,
    monthly: null,
    advanced: null,
  };

  const leanDoc = {
    _id: playbookId,
    createdBy: userId,
    executionSchedule: baseSchedule,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPlaybookModel = {
      find: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    };

    mockExecutionModel = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    mockExecutionService = {
      executePlaybook: jest.fn().mockResolvedValue({ executionId: 'exec-1' }),
    };

    mockGrpcService = { isAvailable: true };

    mockLogger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybookScheduleRunnerService,
        { provide: getModelToken(Playbook.name), useValue: mockPlaybookModel },
        { provide: getModelToken(PlaybookExecution.name), useValue: mockExecutionModel },
        { provide: PlaybookExecutionService, useValue: mockExecutionService },
        { provide: PlaybookGrpcService, useValue: mockGrpcService },
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get(PlaybookScheduleRunnerService);
  });

  it('should set logger context on construction', () => {
    expect(mockLogger.setContext).toHaveBeenCalledWith('PlaybookScheduleRunner');
  });

  describe('runDueSchedules', () => {
    it('should skip when gRPC is unavailable', async () => {
      mockGrpcService.isAvailable = false;
      mockPlaybookModel.find.mockReturnValue(createFindCursorChain([leanDoc]));

      await service.runDueSchedules();

      expect(mockLogger.debug).toHaveBeenCalledWith('Schedule tick skipped: gRPC unavailable');
      expect(mockExecutionService.executePlaybook).not.toHaveBeenCalled();
    });

    it('should not call executePlaybook when cursor yields no documents', async () => {
      mockPlaybookModel.find.mockReturnValue(createFindCursorChain([]));
      mockedIsDue.mockReturnValue(true);

      await service.runDueSchedules();

      expect(mockExecutionService.executePlaybook).not.toHaveBeenCalled();
      expect(mockedIsDue).not.toHaveBeenCalled();
    });

    it('should skip playbook when isExecutionScheduleDueThisMinute returns false', async () => {
      mockPlaybookModel.find.mockReturnValue(createFindCursorChain([leanDoc]));
      mockedIsDue.mockReturnValue(false);

      await service.runDueSchedules();

      expect(mockedIsDue).toHaveBeenCalled();
      expect(mockExecutionModel.findOne).not.toHaveBeenCalled();
      expect(mockExecutionService.executePlaybook).not.toHaveBeenCalled();
    });

    it('should skip when an active RUNNING execution exists', async () => {
      mockPlaybookModel.find.mockReturnValue(createFindCursorChain([leanDoc]));
      mockedIsDue.mockReturnValue(true);
      const activeExecId = new Types.ObjectId();
      mockExecutionModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([
              { playbookId, _id: activeExecId },
            ]),
          }),
        }),
      });

      await service.runDueSchedules();

      expect(mockExecutionService.executePlaybook).not.toHaveBeenCalled();
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Scheduled run skipped: playbook already has active execution',
        expect.objectContaining({
          playbookId: playbookId.toString(),
        }),
      );
    });

    it('should skip when an INTERRUPTED execution exists', async () => {
      mockPlaybookModel.find.mockReturnValue(createFindCursorChain([leanDoc]));
      mockedIsDue.mockReturnValue(true);
      mockExecutionModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([
              { playbookId, _id: new Types.ObjectId() },
            ]),
          }),
        }),
      });

      await service.runDueSchedules();

      expect(mockExecutionModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          playbookId: { $in: [playbookId] },
          status: { $in: [ExecutionStatus.RUNNING, ExecutionStatus.INTERRUPTED] },
        }),
      );
      expect(mockExecutionService.executePlaybook).not.toHaveBeenCalled();
    });

    it('should run executePlaybook with scheduled trigger and update lastScheduledRunAt when due and idle', async () => {
      mockPlaybookModel.find.mockReturnValue(createFindCursorChain([leanDoc]));
      mockedIsDue.mockReturnValue(true);
      mockExecutionModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await service.runDueSchedules();

      expect(mockExecutionService.executePlaybook).toHaveBeenCalledWith(
        userId.toString(),
        playbookId.toString(),
        {},
        '',
        { executionTrigger: 'scheduled' },
      );
      expect(mockPlaybookModel.updateOne).toHaveBeenCalledWith(
        { _id: playbookId },
        { $set: { 'executionSchedule.lastScheduledRunAt': expect.any(Date) } },
      );
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Scheduled playbook run started',
        expect.objectContaining({
          playbookId: playbookId.toString(),
          userId: userId.toString(),
        }),
      );
    });

    it('should process multiple playbooks independently', async () => {
      const pb2 = new Types.ObjectId();
      const user2 = new Types.ObjectId();
      const doc2 = {
        _id: pb2,
        createdBy: user2,
        executionSchedule: { ...baseSchedule },
      };
      mockPlaybookModel.find.mockReturnValue(createFindCursorChain([leanDoc, doc2]));
      mockedIsDue.mockReturnValue(true);
      mockExecutionModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await service.runDueSchedules();

      expect(mockExecutionService.executePlaybook).toHaveBeenCalledTimes(2);
      expect(mockPlaybookModel.updateOne).toHaveBeenCalledTimes(2);
    });

    it('should log warn and continue when executePlaybook throws', async () => {
      mockPlaybookModel.find.mockReturnValue(createFindCursorChain([leanDoc]));
      mockedIsDue.mockReturnValue(true);
      mockExecutionModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([]),
          }),
        }),
      });
      mockExecutionService.executePlaybook.mockRejectedValue(new Error('boom'));

      await service.runDueSchedules();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Scheduled playbook run failed',
        expect.objectContaining({ playbookId: playbookId.toString(), error: 'boom' }),
      );
      expect(mockPlaybookModel.updateOne).not.toHaveBeenCalled();
    });
  });
});
