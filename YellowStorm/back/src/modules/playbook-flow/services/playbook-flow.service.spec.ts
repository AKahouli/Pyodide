import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';

import { PlaybookFlowService } from './playbook-flow.service';
import { Flow } from '../schemas/playbook-flow.schema';
import { FlowExecution } from '../schemas/playbook-flow-execution.schema';
import { PlaybookFlowValidatorService } from './playbook-flow-validator.service';
import { PlaybookFlowReplayService } from './playbook-flow-replay.service';
import { PlaybookFlowReplayReportService } from './playbook-flow-replay-report.service';
import { FlowAccessService } from '../domain/flow-access.service';
import { FlowResponseAssemblerService } from '../domain/flow-response-assembler.service';
import { FlowWorkspacePolicyService } from '../domain/flow-workspace-policy.service';
import { FlowGraphSanitizerService } from '../domain/flow-graph-sanitizer.service';
import { FlowDeltaPatchService } from '../domain/flow-delta-patch.service';
import { PlaybookFlowIdempotencyService } from './playbook-flow-idempotency.service';
import { PlaybookShareService } from './playbook-share.service';

describe('PlaybookFlowService', () => {
  const idempotencyService = {
    reserveSave: jest.fn().mockResolvedValue({ type: 'reserved' }),
    confirmSaveResult: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const playbookShareService = {
    getSharePermission: jest.fn().mockResolvedValue(null),
    getSharedPlaybookIdsForUser: jest.fn().mockResolvedValue([]),
    getShareInfoMapForUser: jest.fn().mockResolvedValue(new Map()),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    idempotencyService.reserveSave.mockResolvedValue({ type: 'reserved' });
  });

  describe('persistSanitizedExecutionGraph', () => {
    it('atomically scopes graph cleanup to the owner and loaded revision', async () => {
      const flowModel = {
        findOneAndUpdate: jest.fn().mockResolvedValue({ definitionRevision: 8 }),
      };
      const service = Object.create(PlaybookFlowService.prototype) as PlaybookFlowService;
      (service as any).flowModel = flowModel;

      await expect(service.persistSanitizedExecutionGraph(
        'flow-1',
        'owner-1',
        7,
        [{ id: 'edge-1', source: 'a', target: 'b' } as any],
        [],
      )).resolves.toBe(8);

      expect(flowModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'flow-1', ownerId: 'owner-1', definitionRevision: 7 },
        {
          $set: {
            controlEdges: [{ id: 'edge-1', source: 'a', target: 'b' }],
            dataBindings: [],
          },
          $inc: { definitionRevision: 1 },
        },
        { new: true, runValidators: true },
      );
    });

    it('rejects cleanup when the loaded revision lost the compare-and-swap race', async () => {
      const service = Object.create(PlaybookFlowService.prototype) as PlaybookFlowService;
      (service as any).flowModel = { findOneAndUpdate: jest.fn().mockResolvedValue(null) };

      await expect(service.persistSanitizedExecutionGraph('flow-1', 'owner-1', 7, [], []))
        .rejects.toThrow('Playbook changed while preparing execution.');
    });
  });

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
        FlowAccessService,
        FlowResponseAssemblerService,
        FlowWorkspacePolicyService,
        FlowGraphSanitizerService,
        FlowDeltaPatchService,
        { provide: PlaybookFlowIdempotencyService, useValue: idempotencyService },
        { provide: PlaybookShareService, useValue: playbookShareService },
        { provide: getModelToken(Flow.name), useValue: flowModel },
        { provide: getModelToken(FlowExecution.name), useValue: {} },
        { provide: PlaybookFlowValidatorService, useValue: { validate: jest.fn() } },
        { provide: PlaybookFlowReplayService, useValue: replayService },
        { provide: PlaybookFlowReplayReportService, useValue: replayReportService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(true) } },
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
        FlowAccessService,
        FlowResponseAssemblerService,
        FlowWorkspacePolicyService,
        FlowGraphSanitizerService,
        FlowDeltaPatchService,
        { provide: PlaybookFlowIdempotencyService, useValue: idempotencyService },
        { provide: PlaybookShareService, useValue: playbookShareService },
        { provide: getModelToken(Flow.name), useValue: flowModel },
        { provide: getModelToken(FlowExecution.name), useValue: {} },
        { provide: PlaybookFlowValidatorService, useValue: { validate: jest.fn() } },
        { provide: PlaybookFlowReplayService, useValue: replayService },
        { provide: PlaybookFlowReplayReportService, useValue: replayReportService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(true) } },
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
        FlowAccessService,
        FlowResponseAssemblerService,
        FlowWorkspacePolicyService,
        FlowGraphSanitizerService,
        FlowDeltaPatchService,
        { provide: PlaybookFlowIdempotencyService, useValue: idempotencyService },
        { provide: PlaybookShareService, useValue: playbookShareService },
        { provide: getModelToken(Flow.name), useValue: flowModel },
        { provide: getModelToken(FlowExecution.name), useValue: executionModel },
        { provide: PlaybookFlowValidatorService, useValue: { validate: jest.fn() } },
        { provide: PlaybookFlowReplayService, useValue: { getActiveReplays: jest.fn() } },
        { provide: PlaybookFlowReplayReportService, useValue: { findLatestScoresForReplays: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(true) } },
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
        FlowAccessService,
        FlowResponseAssemblerService,
        FlowWorkspacePolicyService,
        FlowGraphSanitizerService,
        FlowDeltaPatchService,
        { provide: PlaybookFlowIdempotencyService, useValue: idempotencyService },
        { provide: PlaybookShareService, useValue: playbookShareService },
        { provide: getModelToken(Flow.name), useValue: flowModel },
        { provide: getModelToken(FlowExecution.name), useValue: executionModel },
        { provide: PlaybookFlowValidatorService, useValue: { validate: jest.fn() } },
        { provide: PlaybookFlowReplayService, useValue: { getActiveReplays: jest.fn() } },
        { provide: PlaybookFlowReplayReportService, useValue: { findLatestScoresForReplays: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(true) } },
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
    const flowDocument = {
      _id: '507f1f77bcf86cd799439011',
      ownerId: 'user-1',
      definitionRevision: 4,
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
    };
    const flowModel = {
      findById: jest.fn().mockResolvedValue(flowDocument),
      findOneAndUpdate: jest.fn().mockImplementation(async (_filter, update) => ({
        ...flowDocument,
        ...update.$set,
        definitionRevision: 5,
        updatedAt: new Date('2026-05-30T06:10:00.000Z'),
      })),
    };
    const validatorService = { validate: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlaybookFlowService,
        FlowAccessService,
        FlowResponseAssemblerService,
        FlowWorkspacePolicyService,
        FlowGraphSanitizerService,
        FlowDeltaPatchService,
        { provide: PlaybookFlowIdempotencyService, useValue: idempotencyService },
        { provide: PlaybookShareService, useValue: playbookShareService },
        { provide: getModelToken(Flow.name), useValue: flowModel },
        { provide: getModelToken(FlowExecution.name), useValue: {} },
        { provide: PlaybookFlowValidatorService, useValue: validatorService },
        { provide: PlaybookFlowReplayService, useValue: { getActiveReplays: jest.fn() } },
        { provide: PlaybookFlowReplayReportService, useValue: { findLatestScoresForReplays: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(true) } },
      ],
    }).compile();

    const service = moduleRef.get(PlaybookFlowService);
    const result = await service.applyDeltaPatch('507f1f77bcf86cd799439011', 'user-1', {
      expectedDefinitionRevision: 4,
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
      {
        allowDraftRouters: true,
        allowUnboundRequiredPorts: true,
        allowIncompleteNodeOutputBindings: true,
      },
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
    expect(flowModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: '507f1f77bcf86cd799439011',
        ownerId: 'user-1',
        $or: [{ definitionRevision: 4 }],
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          nodes: [
            expect.objectContaining({ id: 'task-1', label: 'Draft revised' }),
            expect.objectContaining({ id: 'task-3', label: 'Added' }),
          ],
          controlEdges: [
            { id: 'edge-2', kind: 'sequential', source: 'task-1', target: 'task-3' },
          ],
          dataBindings: [
            expect.objectContaining({ id: 'binding-2', targetNode: 'task-3' }),
          ],
        }),
        $inc: { definitionRevision: 1 },
      }),
      { new: true, runValidators: true },
    );
    expect(result.definitionRevision).toBe(5);
  });

  it('throws conflict when a delta save loses the compare-and-swap race', async () => {
    const flowDocument = {
      _id: 'flow-1',
      ownerId: 'user-1',
      definitionRevision: 4,
      updatedAt: new Date('2026-05-30T06:00:00.000Z'),
      name: 'Alpha',
      description: '',
      settings: { recursionLimit: 25, maxParallelism: 5 },
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      workspaces: ['workspace-1'],
    };
    const flowModel = {
      findById: jest.fn().mockResolvedValue(flowDocument),
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlaybookFlowService,
        FlowAccessService,
        FlowResponseAssemblerService,
        FlowWorkspacePolicyService,
        FlowGraphSanitizerService,
        FlowDeltaPatchService,
        { provide: PlaybookFlowIdempotencyService, useValue: idempotencyService },
        { provide: PlaybookShareService, useValue: playbookShareService },
        { provide: getModelToken(Flow.name), useValue: flowModel },
        { provide: getModelToken(FlowExecution.name), useValue: {} },
        { provide: PlaybookFlowValidatorService, useValue: { validate: jest.fn() } },
        { provide: PlaybookFlowReplayService, useValue: { getActiveReplays: jest.fn() } },
        { provide: PlaybookFlowReplayReportService, useValue: { findLatestScoresForReplays: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(true) } },
      ],
    }).compile();

    const service = moduleRef.get(PlaybookFlowService);

    await expect(service.applyDeltaPatch('507f1f77bcf86cd799439011', 'user-1', {
      expectedDefinitionRevision: 4,
      patch: {
        fields: { description: 'revised' },
      },
    } as any)).rejects.toMatchObject({ message: 'Playbook changed since this autosave started.' });
  });

  it('uses compare-and-swap persistence for full editor updates', async () => {
    const flowDocument = {
      _id: 'flow-1',
      ownerId: 'user-1',
      definitionRevision: 2,
      updatedAt: new Date('2026-05-30T06:00:00.000Z'),
      name: 'Alpha',
      description: '',
      settings: { recursionLimit: 25, maxParallelism: 5 },
      hitlPolicy: { mode: 'auto' },
      hitlBlockers: [],
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      workspaces: ['workspace-1'],
      toJSON: jest.fn().mockReturnValue({
        id: '507f1f77bcf86cd799439011',
        name: 'Alpha revised',
        description: 'updated',
        nodes: [],
        controlEdges: [],
        dataBindings: [],
      }),
    };
    const savedDocument = {
      ...flowDocument,
      name: 'Alpha revised',
      description: 'updated',
      definitionRevision: 3,
      updatedAt: new Date('2026-05-30T06:10:00.000Z'),
      toJSON: jest.fn().mockReturnValue({
        id: 'flow-1',
        name: 'Alpha revised',
        description: 'updated',
        nodes: [],
        controlEdges: [],
        dataBindings: [],
      }),
    };
    const flowModel = {
      findById: jest.fn().mockResolvedValue(flowDocument),
      findOneAndUpdate: jest.fn().mockResolvedValue(savedDocument),
    };
    const validatorService = { validate: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlaybookFlowService,
        FlowAccessService,
        FlowResponseAssemblerService,
        FlowWorkspacePolicyService,
        FlowGraphSanitizerService,
        FlowDeltaPatchService,
        { provide: PlaybookFlowIdempotencyService, useValue: idempotencyService },
        { provide: PlaybookShareService, useValue: playbookShareService },
        { provide: getModelToken(Flow.name), useValue: flowModel },
        { provide: getModelToken(FlowExecution.name), useValue: {} },
        { provide: PlaybookFlowValidatorService, useValue: validatorService },
        { provide: PlaybookFlowReplayService, useValue: { getActiveReplays: jest.fn() } },
        { provide: PlaybookFlowReplayReportService, useValue: { findLatestScoresForReplays: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(true) } },
      ],
    }).compile();

    const service = moduleRef.get(PlaybookFlowService);
    await service.update('507f1f77bcf86cd799439011', 'user-1', {
      name: 'Alpha revised',
      description: 'updated',
      expectedDefinitionRevision: 2,
    } as any);

    expect(flowModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: '507f1f77bcf86cd799439011',
        ownerId: 'user-1',
        $or: [{ definitionRevision: 2 }],
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          name: 'Alpha revised',
          description: 'updated',
        }),
        $inc: { definitionRevision: 1 },
      }),
      { new: true, runValidators: true },
    );
  });

  it('validates full-save constant bindings as plain objects after Mongoose casts them', async () => {
    let bindings: any[] = [];
    const flowDocument: Record<string, any> = {
      _id: 'flow-1',
      ownerId: 'user-1',
      definitionRevision: 2,
      settings: { recursionLimit: 25, maxParallelism: 5 },
      hitlPolicy: { mode: 'auto' },
      hitlBlockers: [],
      nodes: [{ id: 'target', input: { ports: [{ id: 'destination', type: 'data', required: true }] } }],
      controlEdges: [],
      workspaces: [],
    };
    Object.defineProperty(flowDocument, 'dataBindings', {
      get: () => bindings,
      set: (value: any[]) => {
        bindings = value.map((binding) => {
          const { constantValue, ...fields } = binding;
          return Object.assign(
            Object.create({ constantValue }),
            fields,
            { toObject: () => ({ ...binding }) },
          );
        });
      },
    });
    const savedDocument = {
      toJSON: () => ({ id: 'flow-1', definitionRevision: 3, nodes: flowDocument.nodes, controlEdges: [], dataBindings: bindings }),
    };
    const validatorService = { validate: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlaybookFlowService,
        FlowAccessService,
        FlowResponseAssemblerService,
        FlowWorkspacePolicyService,
        FlowGraphSanitizerService,
        FlowDeltaPatchService,
        { provide: PlaybookFlowIdempotencyService, useValue: idempotencyService },
        { provide: PlaybookShareService, useValue: playbookShareService },
        { provide: getModelToken(Flow.name), useValue: { findById: jest.fn().mockResolvedValue(flowDocument), findOneAndUpdate: jest.fn().mockResolvedValue(savedDocument) } },
        { provide: getModelToken(FlowExecution.name), useValue: {} },
        { provide: PlaybookFlowValidatorService, useValue: validatorService },
        { provide: PlaybookFlowReplayService, useValue: { getActiveReplays: jest.fn() } },
        { provide: PlaybookFlowReplayReportService, useValue: { findLatestScoresForReplays: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(true) } },
      ],
    }).compile();

    const constantValue = { workspaceId: 'workspace-1', workspaceName: 'Workspace' };
    await moduleRef.get(PlaybookFlowService).update('507f1f77bcf86cd799439011', 'user-1', {
      expectedDefinitionRevision: 2,
      dataBindings: [{ id: 'binding-1', targetNode: 'target', targetPort: 'destination', sourceKind: 'constant', constantValue }],
    } as any);

    const validatedBindings = validatorService.validate.mock.calls[0][2];
    expect(validatedBindings[0]).toEqual(expect.objectContaining({ constantValue }));
    expect(Object.prototype.hasOwnProperty.call(validatedBindings[0], 'constantValue')).toBe(true);
  });

  it('throws conflict when a full editor update loses the compare-and-swap race', async () => {
    const flowDocument = {
      _id: 'flow-1',
      ownerId: 'user-1',
      definitionRevision: 2,
      updatedAt: new Date('2026-05-30T06:00:00.000Z'),
      name: 'Alpha',
      description: '',
      settings: { recursionLimit: 25, maxParallelism: 5 },
      hitlPolicy: { mode: 'auto' },
      hitlBlockers: [],
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      workspaces: ['workspace-1'],
    };
    const flowModel = {
      findById: jest.fn().mockResolvedValue(flowDocument),
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlaybookFlowService,
        FlowAccessService,
        FlowResponseAssemblerService,
        FlowWorkspacePolicyService,
        FlowGraphSanitizerService,
        FlowDeltaPatchService,
        { provide: PlaybookFlowIdempotencyService, useValue: idempotencyService },
        { provide: PlaybookShareService, useValue: playbookShareService },
        { provide: getModelToken(Flow.name), useValue: flowModel },
        { provide: getModelToken(FlowExecution.name), useValue: {} },
        { provide: PlaybookFlowValidatorService, useValue: { validate: jest.fn() } },
        { provide: PlaybookFlowReplayService, useValue: { getActiveReplays: jest.fn() } },
        { provide: PlaybookFlowReplayReportService, useValue: { findLatestScoresForReplays: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(true) } },
      ],
    }).compile();

    const service = moduleRef.get(PlaybookFlowService);

    await expect(service.update('507f1f77bcf86cd799439011', 'user-1', {
      name: 'Alpha revised',
      expectedDefinitionRevision: 2,
    } as any)).rejects.toMatchObject({
      message: 'Playbook changed since this suggestion was generated. Refresh and retry the suggestion.',
    });
  });

  it('returns stored full-save result for duplicate client mutation ids', async () => {
    idempotencyService.reserveSave.mockResolvedValueOnce({
      type: 'duplicate',
      responseBody: {
        id: 'flow-1',
        name: 'Saved',
        description: 'done',
        definitionRevision: 4,
        activeReplays: {},
      },
    });
    const flowModel = { findById: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlaybookFlowService,
        FlowAccessService,
        FlowResponseAssemblerService,
        FlowWorkspacePolicyService,
        FlowGraphSanitizerService,
        FlowDeltaPatchService,
        { provide: PlaybookFlowIdempotencyService, useValue: idempotencyService },
        { provide: PlaybookShareService, useValue: playbookShareService },
        { provide: getModelToken(Flow.name), useValue: flowModel },
        { provide: getModelToken(FlowExecution.name), useValue: {} },
        { provide: PlaybookFlowValidatorService, useValue: { validate: jest.fn() } },
        { provide: PlaybookFlowReplayService, useValue: { getActiveReplays: jest.fn() } },
        { provide: PlaybookFlowReplayReportService, useValue: { findLatestScoresForReplays: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(true) } },
      ],
    }).compile();

    const service = moduleRef.get(PlaybookFlowService);
    const result = await service.update('507f1f77bcf86cd799439011', 'user-1', {
      name: 'Saved',
      clientMutationId: 'mutation-1',
      expectedDefinitionRevision: 3,
    } as any);

    expect(result).toMatchObject({ id: 'flow-1', definitionRevision: 4 });
    expect(flowModel.findById).not.toHaveBeenCalled();
  });

  it('returns stored delta-save result for duplicate client mutation ids', async () => {
    idempotencyService.reserveSave.mockResolvedValueOnce({
      type: 'duplicate',
      responseBody: {
        id: 'flow-1',
        updatedAt: '2026-05-30T06:10:00.000Z',
        definitionRevision: 5,
        applied: true,
        patchSummary: {
          scalarFields: 1,
          nodesUpserted: 0,
          nodesDeleted: 0,
          edgeChanges: 0,
          dataBindingChanges: 0,
          positionUpdates: 0,
        },
      },
    });
    const flowModel = { findById: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlaybookFlowService,
        FlowAccessService,
        FlowResponseAssemblerService,
        FlowWorkspacePolicyService,
        FlowGraphSanitizerService,
        FlowDeltaPatchService,
        { provide: PlaybookFlowIdempotencyService, useValue: idempotencyService },
        { provide: PlaybookShareService, useValue: playbookShareService },
        { provide: getModelToken(Flow.name), useValue: flowModel },
        { provide: getModelToken(FlowExecution.name), useValue: {} },
        { provide: PlaybookFlowValidatorService, useValue: { validate: jest.fn() } },
        { provide: PlaybookFlowReplayService, useValue: { getActiveReplays: jest.fn() } },
        { provide: PlaybookFlowReplayReportService, useValue: { findLatestScoresForReplays: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(true) } },
      ],
    }).compile();

    const service = moduleRef.get(PlaybookFlowService);
    const result = await service.applyDeltaPatch('flow-1', 'user-1', {
      expectedDefinitionRevision: 4,
      clientMutationId: 'mutation-1',
      patch: { fields: { description: 'saved' } },
    } as any);

    expect(result).toMatchObject({ id: 'flow-1', definitionRevision: 5, applied: true });
    expect(flowModel.findById).not.toHaveBeenCalled();
  });

  it('reconstructs a full-save response when a duplicate retry arrives after commit but before response recording', async () => {
    idempotencyService.reserveSave.mockResolvedValueOnce({
      type: 'duplicate-pending',
      expectedDefinitionRevision: 4,
      expectedStateHash: '{"advisorAutopilotEnabled":undefined,"advisorAutopilotMaxTurns":undefined,"advisorAutopilotTargetScore":undefined,"advisorScoringMode":undefined,"controlEdges":[],"dataBindings":[],"description":"done","designSettings":undefined,"hitlBlockers":undefined,"hitlPolicy":undefined,"name":"Saved","nodes":[],"reflectionEnabled":undefined,"settings":{"maxParallelism":5,"recursionLimit":25},"triggerConfig":undefined,"workspaces":[]}',
    });
    const flowDocument = {
      _id: 'flow-1',
      ownerId: 'user-1',
      definitionRevision: 4,
      name: 'Saved',
      description: 'done',
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      workspaces: [],
      settings: { recursionLimit: 25, maxParallelism: 5 },
      toJSON: jest.fn().mockReturnValue({
        id: 'flow-1',
        definitionRevision: 4,
        name: 'Saved',
        description: 'done',
        nodes: [],
        controlEdges: [],
        dataBindings: [],
        workspaces: [],
        settings: { recursionLimit: 25, maxParallelism: 5 },
      }),
    };
    const flowModel = { findById: jest.fn().mockResolvedValue(flowDocument) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlaybookFlowService,
        FlowAccessService,
        FlowResponseAssemblerService,
        FlowWorkspacePolicyService,
        FlowGraphSanitizerService,
        FlowDeltaPatchService,
        { provide: PlaybookFlowIdempotencyService, useValue: idempotencyService },
        { provide: PlaybookShareService, useValue: playbookShareService },
        { provide: getModelToken(Flow.name), useValue: flowModel },
        { provide: getModelToken(FlowExecution.name), useValue: {} },
        { provide: PlaybookFlowValidatorService, useValue: { validate: jest.fn() } },
        { provide: PlaybookFlowReplayService, useValue: { getActiveReplays: jest.fn() } },
        { provide: PlaybookFlowReplayReportService, useValue: { findLatestScoresForReplays: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(true) } },
      ],
    }).compile();

    const service = moduleRef.get(PlaybookFlowService);
    const result = await service.update('507f1f77bcf86cd799439011', 'user-1', {
      name: 'Saved',
      expectedDefinitionRevision: 3,
      clientMutationId: 'mutation-2',
    } as any);

    expect(result).toMatchObject({ id: 'flow-1', definitionRevision: 4, name: 'Saved' });
    expect(idempotencyService.confirmSaveResult).toHaveBeenCalled();
  });

  it('buildEditorStateHash handles circular flow graphs without recursion errors', async () => {
    const flowId = '507f1f77bcf86cd799439011';
    const sharedNode: Record<string, unknown> = { id: 'node-1' };
    const circularFlow: Record<string, unknown> = {
      _id: flowId,
      ownerId: 'user-1',
      definitionRevision: 1,
      name: 'Saved',
      description: 'Circular',
      nodes: [sharedNode],
      controlEdges: [],
      dataBindings: [sharedNode],
      workspaces: [],
      settings: { recursionLimit: 25, maxParallelism: 5 },
    };
    sharedNode.parent = circularFlow;

    const flowModel = { findById: jest.fn().mockResolvedValue(circularFlow) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlaybookFlowService,
        FlowAccessService,
        FlowResponseAssemblerService,
        FlowWorkspacePolicyService,
        FlowGraphSanitizerService,
        FlowDeltaPatchService,
        { provide: PlaybookFlowIdempotencyService, useValue: idempotencyService },
        { provide: PlaybookShareService, useValue: playbookShareService },
        { provide: getModelToken(Flow.name), useValue: flowModel },
        { provide: getModelToken(FlowExecution.name), useValue: {} },
        { provide: PlaybookFlowValidatorService, useValue: { validate: jest.fn() } },
        { provide: PlaybookFlowReplayService, useValue: { getActiveReplays: jest.fn() } },
        { provide: PlaybookFlowReplayReportService, useValue: { findLatestScoresForReplays: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(true) } },
      ],
    }).compile();

    const service = moduleRef.get(PlaybookFlowService);

    const hash = (service as any).buildEditorStateHash(circularFlow);

    expect(hash).toContain('"nodes":[{');
    expect(hash).toContain('"dataBindings":[{');
    expect(hash).toContain('[Circular]');
  });

  it('does not treat an unrelated revision bump as a successful duplicate full save', async () => {
    idempotencyService.reserveSave.mockResolvedValueOnce({
      type: 'duplicate-pending',
      expectedDefinitionRevision: 4,
      expectedStateHash: '{"advisorAutopilotEnabled":undefined,"advisorAutopilotMaxTurns":undefined,"advisorAutopilotTargetScore":undefined,"advisorScoringMode":undefined,"controlEdges":[],"dataBindings":[],"description":"done","designSettings":undefined,"hitlBlockers":undefined,"hitlPolicy":undefined,"name":"Saved","nodes":[],"reflectionEnabled":undefined,"settings":{"maxParallelism":5,"recursionLimit":25},"triggerConfig":undefined,"workspaces":[]}',
    });
    const flowDocument = {
      _id: '507f1f77bcf86cd799439011',
      ownerId: 'user-1',
      definitionRevision: 4,
      name: 'Different',
      description: 'other change',
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      workspaces: [],
      settings: { recursionLimit: 25, maxParallelism: 5 },
      toJSON: jest.fn().mockReturnValue({
        id: 'flow-1',
        definitionRevision: 4,
        name: 'Different',
        description: 'other change',
      }),
    };
    const flowModel = { findById: jest.fn().mockResolvedValue(flowDocument) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlaybookFlowService,
        FlowAccessService,
        FlowResponseAssemblerService,
        FlowWorkspacePolicyService,
        FlowGraphSanitizerService,
        FlowDeltaPatchService,
        { provide: PlaybookFlowIdempotencyService, useValue: idempotencyService },
        { provide: PlaybookShareService, useValue: playbookShareService },
        { provide: getModelToken(Flow.name), useValue: flowModel },
        { provide: getModelToken(FlowExecution.name), useValue: {} },
        { provide: PlaybookFlowValidatorService, useValue: { validate: jest.fn() } },
        { provide: PlaybookFlowReplayService, useValue: { getActiveReplays: jest.fn() } },
        { provide: PlaybookFlowReplayReportService, useValue: { findLatestScoresForReplays: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(true) } },
      ],
    }).compile();

    const service = moduleRef.get(PlaybookFlowService);
    await expect(service.update('507f1f77bcf86cd799439011', 'user-1', {
      name: 'Saved',
      expectedDefinitionRevision: 3,
      clientMutationId: 'mutation-3',
    } as any)).rejects.toMatchObject({
      message: 'Idempotency key reservation exists but save result was not recorded yet. Retry shortly with the same payload.',
    });
  });

  it('sorts overlapping executions by completion activity before pagination', async () => {
    const flowModel = {
      countDocuments: jest.fn().mockResolvedValue(1),
      aggregate: jest.fn().mockResolvedValue([{ _id: 'flow-old', ownerId: 'user-1', name: 'Recently executed', updatedAt: new Date('2025-01-15T00:00:00Z') }]),
    };
    const executionModel = {
      collection: { name: 'flowexecutions' },
      aggregate: jest.fn().mockResolvedValue([{ flowId: 'flow-old', status: 'completed', createdAt: new Date('2025-01-01T00:00:00Z'), endedAt: new Date('2025-02-01T00:00:00Z') }]),
    };
    const service = Object.create(PlaybookFlowService.prototype) as PlaybookFlowService;
    Object.assign(service as any, { flowModel, executionModel, playbookShareService });

    const result = await service.findAll('user-1', { page: 1, limit: 6, sortBy: 'activityAt', sortOrder: 'desc' });

    expect(result.items[0]).toMatchObject({ id: 'flow-old', lastExecutionAt: new Date('2025-02-01T00:00:00Z') });
    expect(flowModel.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      { $sort: { activityAt: -1, _id: 1 } },
      { $limit: 6 },
    ]));
    const pipeline = JSON.stringify(flowModel.aggregate.mock.calls[0][0]);
    expect(pipeline).toContain('latestActivityExecution.activityAt');
    expect(pipeline).toContain('"$sort":{"activityAt":-1,"_id":1}');
  });

  it('creates a Playbook without a default workspace', async () => {
    const flowModel = Object.assign(jest.fn().mockImplementation((payload: Record<string, unknown>) => {
      const document = {
        ...payload,
        toJSON: jest.fn().mockReturnValue({ id: 'flow-new', ...payload }),
        save: jest.fn(),
      };
      document.save.mockResolvedValue(document);
      return document;
    }), { exists: jest.fn().mockResolvedValue(false) });
    const service = new PlaybookFlowService(
      flowModel as any,
      {} as any,
      { validate: jest.fn() } as any,
      {} as any,
      {} as any,
      new FlowWorkspacePolicyService(),
      { sanitize: jest.fn((graph) => graph) } as any,
      { buildPatchedGraph: jest.fn() } as any,
      idempotencyService as any,
      { get: jest.fn().mockReturnValue(true) } as any,
      playbookShareService as any,
    );

    const result = await service.create('user-1', { name: 'Workspace-free draft' });

    expect((flowModel as jest.Mock).mock.calls[0][0].workspaces).toEqual([]);
    expect(result.workspaces).toEqual([]);
  });

  it('createWithNodesAndEdges seeds smart HITL defaults by default', async () => {
    const executionModel = {} as any;
    const flowModel = Object.assign(
      jest.fn().mockImplementation((payload: Record<string, unknown>) => {
        const doc = {
          ...payload,
          toJSON: jest.fn().mockReturnValue({ id: 'flow-new', ...(payload as Record<string, unknown>) }),
          save: jest.fn().mockResolvedValue(undefined),
        };
        doc.save = jest.fn().mockResolvedValue(doc);
        return doc;
      }),
      {
        findById: jest.fn(),
      },
    );

    const service = new PlaybookFlowService(
      flowModel as any,
      {} as any,
      { validate: jest.fn() } as any,
      {} as any,
      {} as any,
      new FlowWorkspacePolicyService(),
      { sanitize: jest.fn((graph) => graph) } as any,
      { buildPatchedGraph: jest.fn() } as any,
      idempotencyService as any,
      { get: jest.fn().mockReturnValue(true) } as any,
      { getSharedPlaybookIdsForUser: jest.fn(), getShareInfoMapForUser: jest.fn(), getSharePermission: jest.fn(), removeAllSharesForPlaybook: jest.fn() } as any,
    );

    await service.createWithNodesAndEdges('user-1', 'Base', '', [], [], [], []);

    const created = (flowModel as jest.Mock).mock.calls[0][0];
    expect(created.workspaces).toEqual([]);
    expect(created.hitlPolicy).toMatchObject({ mode: 'auto', sensitivity: 'balanced' });
    expect(Array.isArray(created.hitlBlockers)).toBe(true);
    expect(created.hitlBlockers).toEqual([]);
  });

  it('clone copies existing HITL policy and blockers for compatibility', async () => {
    const existing = {
      _id: 'flow-1',
      ownerId: 'user-1',
      schemaVersion: 1,
      name: 'Original',
      description: 'desc',
      triggerConfig: { kind: 'manual' },
      settings: { recursionLimit: 25, maxParallelism: 5 },
      hitlPolicy: { mode: 'manual' },
      hitlBlockers: [{ id: 'custom' }],
      nodes: [{ id: 'task-1' }],
      controlEdges: [],
      dataBindings: [],
      workspaces: [],
      designSettings: { canvas: {} },
      isFavorite: false,
      reflectionEnabled: false,
      advisorScoringMode: 'llm',
      advisorAutopilotEnabled: false,
      advisorAutopilotTargetScore: undefined,
      advisorAutopilotMaxTurns: undefined,
      toJSON: jest.fn().mockReturnValue({
        id: 'flow-1',
        ownerId: 'user-1',
        name: 'Original',
      }),
    };
    const flowModel = Object.assign(
      jest.fn().mockImplementation((payload: Record<string, unknown>) => ({
        ...payload,
        save: jest.fn().mockImplementation(function save(this: { toJSON: () => unknown }) {
          return Promise.resolve(this);
        }),
        toJSON: jest.fn().mockReturnValue({ id: 'flow-clone', ...(payload as Record<string, unknown>) }),
      })),
      {
        findById: jest.fn(),
      },
    );

    const service = new PlaybookFlowService(
      flowModel as any,
      {} as any,
      { validate: jest.fn() } as any,
      { findOwnedFlow: jest.fn().mockResolvedValue(existing) } as any,
      {} as any,
      {
        normalizeWorkspaces: (workspaces: string[]) => workspaces,
      } as any,
      { sanitize: jest.fn((graph) => graph) } as any,
      { buildPatchedGraph: jest.fn() } as any,
      idempotencyService as any,
      { get: jest.fn().mockReturnValue(true) } as any,
      { getSharedPlaybookIdsForUser: jest.fn(), getShareInfoMapForUser: jest.fn(), getSharePermission: jest.fn(), removeAllSharesForPlaybook: jest.fn() } as any,
    );

    await service.clone('flow-1', 'user-1');

    const created = (flowModel as jest.Mock).mock.calls[0][0];
    expect(created.hitlPolicy).toEqual(existing.hitlPolicy);
    expect(created.hitlBlockers).toEqual(existing.hitlBlockers);
  });
});
