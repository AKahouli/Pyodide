import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { PlaybookExecutionAdvisorService } from './playbook-execution-advisor.service';
import { PlaybookExecution } from '../schemas/playbook-execution.schema';
import { PlaybookStreamGatewayService } from './playbook-stream-gateway.service';

const objectId = (id = 'a') =>
  new Types.ObjectId(id.padEnd(24, '0').replace(/[^a-f0-9]/gi, 'a').slice(0, 24));

const createChainMock = (value: any) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(value),
});

describe('PlaybookExecutionAdvisorService', () => {
  let service: PlaybookExecutionAdvisorService;
  let mockExecutionModel: any;
  let mockStreamGateway: any;

  beforeEach(async () => {
    mockExecutionModel = {
      findByIdAndUpdate: jest.fn().mockReturnValue(createChainMock(null)),
      updateOne: jest.fn().mockReturnValue(createChainMock(null)),
      findById: jest.fn().mockReturnValue(createChainMock({ taskResults: [] })),
    };

    mockStreamGateway = {
      sendToUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybookExecutionAdvisorService,
        { provide: getModelToken(PlaybookExecution.name), useValue: mockExecutionModel },
        { provide: PlaybookStreamGatewayService, useValue: mockStreamGateway },
      ],
    }).compile();

    service = module.get<PlaybookExecutionAdvisorService>(PlaybookExecutionAdvisorService);
  });

  it('normalizes advisor autopilot config with defaults and bounds', () => {
    expect(service.normalizeAdvisorAutopilotConfig(true, undefined, undefined)).toEqual({
      enabled: true,
      targetScore: 80,
      maxTurns: 2,
    });
    expect(service.normalizeAdvisorAutopilotConfig(true, 150, 99)).toEqual({
      enabled: true,
      targetScore: 100,
      maxTurns: 5,
    });
    expect(service.normalizeAdvisorAutopilotConfig(false, -2, -1)).toEqual({
      enabled: false,
      targetScore: 1,
      maxTurns: 0,
    });
  });

  it('falls back to optimize_step when advisor suggests updating current playbook with rewrite hints', () => {
    expect(
      service.resolveAdvisorAutopilotFixType({
        safeAutoFixType: 'none',
        recommendation: 'update_current_playbook',
        rewriteHints: ['Tighten the task prompt around the baseline contract.'],
      }),
    ).toBe('optimize_step');
  });

  it('updates advisor autopilot execution state and emits SSE', async () => {
    await service.updateAdvisorAutopilotState('user-1', objectId('e1').toString(), {
      status: 'judging',
      attemptCount: 2,
      lastError: null,
      taskId: 'task-1',
    });

    expect(mockExecutionModel.findByIdAndUpdate).toHaveBeenCalledWith(
      objectId('e1').toString(),
      expect.objectContaining({
        $set: expect.objectContaining({
          advisorAutopilotStatus: 'judging',
          advisorAutopilotAttemptCount: 2,
          advisorAutopilotLastError: null,
          advisorAutopilotTaskId: 'task-1',
        }),
      }),
    );
    expect(mockStreamGateway.sendToUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        type: 'playbook_advisor_autopilot_updated',
        data: expect.objectContaining({
          executionId: objectId('e1').toString(),
          advisorAutopilotStatus: 'judging',
        }),
      }),
    );
  });

  it('appends advisor turn history and emits the latest turn update', async () => {
    mockExecutionModel.findById.mockReturnValue(
      createChainMock({
        taskResults: [
          {
            taskId: 'task-1',
            advisorOptimizationHistory: [
              {
                turn: 2,
                createdAt: new Date('2026-04-19T12:00:00Z'),
                changedFields: ['description'],
                beforeTask: { description: 'before' },
                afterTask: { description: 'after' },
              },
            ],
          },
        ],
      }),
    );

    await service.appendAdvisorTurnHistory('user-1', objectId('e1').toString(), 'task-1', {
      turn: 2,
      score: 91,
      recommendation: 'none',
      safeAutoFixType: 'none',
      actionType: 'stop',
      stopReason: 'target_reached',
      scoreDelta: 5,
    });

    expect(mockExecutionModel.updateOne).toHaveBeenCalledWith(
      { _id: objectId('e1'), 'taskResults.taskId': 'task-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          'taskResults.$.advisorTurnCount': 2,
          'taskResults.$.lastAdvisorAction': 'stop',
          'taskResults.$.lastAdvisorScoreDelta': 5,
          'taskResults.$.advisorStopReason': 'target_reached',
        }),
      }),
    );
    expect(mockStreamGateway.sendToUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        type: 'playbook_advisor_autopilot_updated',
        data: expect.objectContaining({
          taskId: 'task-1',
          advisorTurnCount: 2,
          advisorOptimizationHistoryEntry: expect.objectContaining({
            turn: 2,
            changedFields: ['description'],
          }),
        }),
      }),
    );
  });
});
