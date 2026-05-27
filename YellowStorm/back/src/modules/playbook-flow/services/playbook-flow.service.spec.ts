import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { PlaybookFlowService } from './playbook-flow.service';
import { Flow } from '../schemas/playbook-flow.schema';
import { FlowExecution } from '../schemas/playbook-flow-execution.schema';
import { PlaybookFlowValidatorService } from './playbook-flow-validator.service';
import { PlaybookFlowReplayService } from './playbook-flow-replay.service';
import { PlaybookFlowReplayReportService } from './playbook-flow-replay-report.service';

describe('PlaybookFlowService', () => {
  it('includes latest execution status and timestamp in list items', async () => {
    const lean = jest.fn().mockResolvedValue([
      {
        _id: 'flow-1',
        ownerId: 'user-1',
        schemaVersion: 1,
        name: 'Alpha',
        description: '',
        settings: { recursionLimit: 25, maxParallelism: 5 },
        nodes: [],
        controlEdges: [],
        dataBindings: [],
        workspaces: [],
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-02T00:00:00.000Z'),
      },
    ]);

    const flowModel = {
      countDocuments: jest.fn().mockResolvedValue(1),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({ lean }),
          }),
        }),
      }),
    };

    const executionModel = {
      aggregate: jest.fn().mockResolvedValue([
        {
          flowId: 'flow-1',
          status: 'running',
          startedAt: new Date('2025-01-03T00:00:00.000Z'),
          endedAt: null,
          createdAt: new Date('2025-01-03T00:00:00.000Z'),
        },
      ]),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlaybookFlowService,
        { provide: getModelToken(Flow.name), useValue: flowModel },
        { provide: getModelToken(FlowExecution.name), useValue: executionModel },
        { provide: PlaybookFlowValidatorService, useValue: { validate: jest.fn() } },
        { provide: PlaybookFlowReplayService, useValue: { getActiveReplays: jest.fn() } },
        { provide: PlaybookFlowReplayReportService, useValue: { findLatestScoresForReplays: jest.fn() } },
      ],
    }).compile();

    const service = moduleRef.get(PlaybookFlowService);
    const result = await service.findAll('user-1', {});

    expect(result.items[0]).toMatchObject({
      id: 'flow-1',
      executionStatus: 'running',
      lastExecutionAt: new Date('2025-01-03T00:00:00.000Z'),
    });
    expect(executionModel.aggregate).toHaveBeenCalled();
  });

  it('returns null execution metadata when a flow has no executions', async () => {
    const lean = jest.fn().mockResolvedValue([
      {
        _id: 'flow-2',
        ownerId: 'user-1',
        schemaVersion: 1,
        name: 'Beta',
        description: '',
        settings: { recursionLimit: 25, maxParallelism: 5 },
        nodes: [],
        controlEdges: [],
        dataBindings: [],
        workspaces: [],
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-02T00:00:00.000Z'),
      },
    ]);

    const flowModel = {
      countDocuments: jest.fn().mockResolvedValue(1),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({ lean }),
          }),
        }),
      }),
    };

    const executionModel = {
      aggregate: jest.fn().mockResolvedValue([]),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlaybookFlowService,
        { provide: getModelToken(Flow.name), useValue: flowModel },
        { provide: getModelToken(FlowExecution.name), useValue: executionModel },
        { provide: PlaybookFlowValidatorService, useValue: { validate: jest.fn() } },
        { provide: PlaybookFlowReplayService, useValue: { getActiveReplays: jest.fn() } },
        { provide: PlaybookFlowReplayReportService, useValue: { findLatestScoresForReplays: jest.fn() } },
      ],
    }).compile();

    const service = moduleRef.get(PlaybookFlowService);
    const result = await service.findAll('user-1', {});

    expect(result.items[0]).toMatchObject({
      id: 'flow-2',
      executionStatus: null,
      lastExecutionAt: null,
    });
  });
});
