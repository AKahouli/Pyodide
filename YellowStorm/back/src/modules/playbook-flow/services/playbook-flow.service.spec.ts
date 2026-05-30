import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { PlaybookFlowService } from './playbook-flow.service';
import { Flow } from '../schemas/playbook-flow.schema';
import { FlowExecution } from '../schemas/playbook-flow-execution.schema';
import { PlaybookFlowValidatorService } from './playbook-flow-validator.service';
import { PlaybookFlowReplayService } from './playbook-flow-replay.service';
import { PlaybookFlowReplayReportService } from './playbook-flow-replay-report.service';

describe('PlaybookFlowService', () => {
  it('findOneBase returns the flow without replay enrichment', async () => {
    const flowDocument = {
      ownerId: 'user-1',
      toJSON: jest.fn().mockReturnValue({
        id: 'flow-1',
        name: 'Alpha',
        nodes: [{ id: 'task-1' }],
        controlEdges: [],
        dataBindings: [],
        activeReplays: { stale: true },
      }),
    };
    const flowModel = {
      findById: jest.fn().mockResolvedValue(flowDocument),
    };
    const replayService = { getActiveReplays: jest.fn() };
    const replayReportService = { findLatestScoresForReplays: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlaybookFlowService,
        { provide: getModelToken(Flow.name), useValue: flowModel },
        { provide: getModelToken(FlowExecution.name), useValue: {} },
        { provide: PlaybookFlowValidatorService, useValue: { validate: jest.fn() } },
        { provide: PlaybookFlowReplayService, useValue: replayService },
        { provide: PlaybookFlowReplayReportService, useValue: replayReportService },
      ],
    }).compile();

    const service = moduleRef.get(PlaybookFlowService);
    const result = await service.findOneBase('507f1f77bcf86cd799439011', 'user-1');

    expect(result.activeReplays).toEqual({});
    expect(replayService.getActiveReplays).not.toHaveBeenCalled();
    expect(replayReportService.findLatestScoresForReplays).not.toHaveBeenCalled();
  });

  it('findOneEnriched loads replay metadata and scores', async () => {
    const flowDocument = {
      ownerId: 'user-1',
      toJSON: jest.fn().mockReturnValue({
        id: 'flow-1',
        name: 'Alpha',
        nodes: [{ id: 'task-1' }, { id: 'task-2' }],
        controlEdges: [],
        dataBindings: [],
      }),
    };
    const replay = {
      _id: 'replay-1',
      taskId: 'task-1',
      validationVersion: 3,
      isStale: false,
      staleReasons: [],
      preserveOutputFormat: true,
      outputFormatGuide: 'guide',
      formatGuideStatus: 'ready',
      label: 'Baseline',
    };
    const flowModel = {
      findById: jest.fn().mockResolvedValue(flowDocument),
    };
    const replayService = { getActiveReplays: jest.fn().mockResolvedValue([replay]) };
    const replayReportService = {
      findLatestScoresForReplays: jest.fn().mockResolvedValue(new Map([['replay-1', 91]])),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlaybookFlowService,
        { provide: getModelToken(Flow.name), useValue: flowModel },
        { provide: getModelToken(FlowExecution.name), useValue: {} },
        { provide: PlaybookFlowValidatorService, useValue: { validate: jest.fn() } },
        { provide: PlaybookFlowReplayService, useValue: replayService },
        { provide: PlaybookFlowReplayReportService, useValue: replayReportService },
      ],
    }).compile();

    const service = moduleRef.get(PlaybookFlowService);
    const result = await service.findOneEnriched('507f1f77bcf86cd799439011', 'user-1');

    expect(replayService.getActiveReplays).toHaveBeenCalledWith('507f1f77bcf86cd799439011', ['task-1', 'task-2']);
    expect(replayReportService.findLatestScoresForReplays).toHaveBeenCalledWith(['replay-1']);
    expect(result.activeReplays.taskId).toBeUndefined();
    expect(result.activeReplays['task-1']).toMatchObject({
      id: 'replay-1',
      validationVersion: 3,
      latestOverallScore: 91,
    });
  });

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

  it('applies structural delta patches for nodes, edges, and bindings', async () => {
    const save = jest.fn().mockImplementation(function save(this: any) {
      this.updatedAt = new Date('2026-05-30T06:10:00.000Z');
      return Promise.resolve(this);
    });
    const flowDocument = {
      _id: 'flow-1',
      ownerId: 'user-1',
      updatedAt: new Date('2026-05-30T06:00:00.000Z'),
      name: 'Alpha',
      description: '',
      settings: { recursionLimit: 25, maxParallelism: 5 },
      nodes: [
        {
          id: 'task-1',
          kind: 'step',
          label: 'Draft',
          input: { ports: [{ id: 'input' }] },
          output: { ports: [{ id: 'output' }] },
          metadata: { positionX: 10, positionY: 20 },
        },
        {
          id: 'task-2',
          kind: 'step',
          label: 'Remove',
          input: { ports: [{ id: 'input' }] },
          output: { ports: [{ id: 'output' }] },
          metadata: { positionX: 30, positionY: 40 },
        },
      ],
      controlEdges: [
        { id: 'edge-1', kind: 'sequential', source: 'task-1', target: 'task-2' },
      ],
      dataBindings: [
        {
          id: 'binding-1',
          targetNode: 'task-2',
          targetPort: 'input',
          sourceKind: 'node-output',
          sourceNode: 'task-1',
          sourcePort: 'output',
        },
      ],
      workspaces: ['workspace-1'],
      save,
    };
    const flowModel = {
      findById: jest.fn().mockResolvedValue(flowDocument),
    };
    const validatorService = { validate: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlaybookFlowService,
        { provide: getModelToken(Flow.name), useValue: flowModel },
        { provide: getModelToken(FlowExecution.name), useValue: {} },
        { provide: PlaybookFlowValidatorService, useValue: validatorService },
        { provide: PlaybookFlowReplayService, useValue: { getActiveReplays: jest.fn() } },
        { provide: PlaybookFlowReplayReportService, useValue: { findLatestScoresForReplays: jest.fn() } },
      ],
    }).compile();

    const service = moduleRef.get(PlaybookFlowService);
    const result = await service.applyDeltaPatch('507f1f77bcf86cd799439011', 'user-1', {
      expectedUpdatedAt: '2026-05-30T06:00:00.000Z',
      patch: {
        nodes: {
          deleteIds: ['task-2'],
          upserts: [
            {
              id: 'task-1',
              kind: 'step',
              label: 'Draft revised',
              input: { ports: [{ id: 'input' }] },
              output: { ports: [{ id: 'output' }] },
              metadata: { positionX: 11, positionY: 21 },
            },
            {
              id: 'task-3',
              kind: 'step',
              label: 'Added',
              input: { ports: [{ id: 'input' }] },
              output: { ports: [{ id: 'output' }] },
              metadata: { positionX: 50, positionY: 60 },
            },
          ],
        },
        controlEdges: [
          { id: 'edge-2', kind: 'sequential', source: 'task-1', target: 'task-3' },
        ],
        dataBindings: [
          {
            id: 'binding-2',
            targetNode: 'task-3',
            targetPort: 'input',
            sourceKind: 'node-output',
            sourceNode: 'task-1',
            sourcePort: 'output',
          },
        ],
      },
    } as any);

    expect(validatorService.validate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'task-1', label: 'Draft revised' }),
        expect.objectContaining({ id: 'task-3', label: 'Added' }),
      ]),
      [{ id: 'edge-2', kind: 'sequential', source: 'task-1', target: 'task-3' }],
      [{
        id: 'binding-2',
        targetNode: 'task-3',
        targetPort: 'input',
        sourceKind: 'node-output',
        sourceNode: 'task-1',
        sourcePort: 'output',
      }],
      { allowDraftRouters: true },
    );
    expect(flowDocument.nodes).toEqual([
      expect.objectContaining({ id: 'task-1', label: 'Draft revised' }),
      expect.objectContaining({ id: 'task-3', label: 'Added' }),
    ]);
    expect(flowDocument.controlEdges).toEqual([
      { id: 'edge-2', kind: 'sequential', source: 'task-1', target: 'task-3' },
    ]);
    expect(flowDocument.dataBindings).toEqual([
      {
        id: 'binding-2',
        targetNode: 'task-3',
        targetPort: 'input',
        sourceKind: 'node-output',
        sourceNode: 'task-1',
        sourcePort: 'output',
      },
    ]);
    expect(result.patchSummary).toEqual({
      scalarFields: 0,
      nodesUpserted: 2,
      nodesDeleted: 1,
      edgeChanges: 1,
      dataBindingChanges: 1,
      positionUpdates: 0,
    });
  });
});
