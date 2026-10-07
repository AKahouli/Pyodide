import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { PlaybookFlowService } from './playbook-flow.service';
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
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { FlowRepository, type FlowRecord } from '../persistence/flow.repository';
import { ExecutionRepository } from '../persistence/execution.repository';

const FLOW_ID = '507f1f77bcf86cd799439011';

const makeFlow = (over: Partial<FlowRecord> = {}): FlowRecord => ({
  id: FLOW_ID,
  ownerId: 'user-1',
  assistantOperationId: null,
  generationProvenance: null,
  schemaVersion: 1,
  definitionRevision: 0,
  name: 'Alpha',
  description: null,
  triggerConfig: null,
  settings: { recursionLimit: 25, maxParallelism: 5 },
  hitlPolicy: { mode: 'auto', sensitivity: 'balanced' } as FlowRecord['hitlPolicy'],
  hitlBlockers: [],
  nodes: [],
  controlEdges: [],
  dataBindings: [],
  workspaces: [],
  designSettings: null,
  isFavorite: false,
  reflectionEnabled: false,
  advisorScoringMode: 'llm',
  advisorAutopilotEnabled: false,
  advisorAutopilotTargetScore: null,
  advisorAutopilotMaxTurns: null,
  createdAt: new Date('2026-05-30T05:00:00.000Z'),
  updatedAt: new Date('2026-05-30T06:00:00.000Z'),
  ...over,
});

const uniqueViolation = (constraint: string) => Object.assign(new Error('duplicate key value'), { code: '23505', constraint });

type FlowRepositoryMock = { [K in keyof FlowRepository]: jest.Mock };

describe('PlaybookFlowService', () => {
  const idempotencyService = {
    reserveSave: jest.fn().mockResolvedValue({ type: 'reserved' }),
    recordExpectedSaveState: jest.fn().mockResolvedValue(undefined),
    confirmSaveResult: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const playbookShareService = {
    getSharePermission: jest.fn().mockResolvedValue(null),
    getSharedPlaybookIdsForUser: jest.fn().mockResolvedValue([]),
    getShareInfoMapForUser: jest.fn().mockResolvedValue(new Map()),
  };

  const flowRepository = (): FlowRepositoryMock => ({
    create: jest.fn(),
    findById: jest.fn().mockResolvedValue(null),
    findByIds: jest.fn().mockResolvedValue([]),
    findOwned: jest.fn().mockResolvedValue(null),
    findByAssistantOperationId: jest.fn().mockResolvedValue(null),
    exists: jest.fn().mockResolvedValue(false),
    findOwnerRef: jest.fn().mockResolvedValue(null),
    listIdsByOwner: jest.fn().mockResolvedValue([]),
    nameTaken: jest.fn().mockResolvedValue(false),
    listNamesWithPrefix: jest.fn().mockResolvedValue([]),
    listByTrigger: jest.fn().mockResolvedValue([]),
    updateFields: jest.fn().mockResolvedValue(null),
    toggleFavorite: jest.fn().mockResolvedValue(null),
    setTriggerParam: jest.fn().mockResolvedValue(true),
    setNodeHitlPolicy: jest.fn().mockResolvedValue(true),
    deleteOwned: jest.fn().mockResolvedValue(true),
    deleteManyOwned: jest.fn().mockResolvedValue([]),
    deleteAssistantDraft: jest.fn().mockResolvedValue(false),
    removeWorkspaceReference: jest.fn().mockResolvedValue(0),
    listAccessible: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    search: jest.fn().mockResolvedValue([]),
    listNodeIndex: jest.fn().mockResolvedValue([]),
  });

  const build = async (options: {
    flows?: FlowRepositoryMock;
    executions?: Partial<Record<keyof ExecutionRepository, jest.Mock>>;
    validator?: { validate: jest.Mock };
    replayService?: { getActiveReplays: jest.Mock };
    replayReportService?: { findLatestScoresForReplays: jest.Mock };
    config?: boolean;
  } = {}) => {
    const flows = options.flows ?? flowRepository();
    const validator = options.validator ?? { validate: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlaybookFlowService,
        FlowAccessService,
        FlowResponseAssemblerService,
        FlowWorkspacePolicyService,
        FlowGraphSanitizerService,
        FlowDeltaPatchService,
        { provide: FlowRepository, useValue: flows },
        { provide: ExecutionRepository, useValue: options.executions ?? {} },
        { provide: PlaybookFlowIdempotencyService, useValue: idempotencyService },
        { provide: PlaybookShareService, useValue: playbookShareService },
        { provide: PlaybookFlowValidatorService, useValue: validator },
        { provide: PlaybookFlowReplayService, useValue: options.replayService ?? { getActiveReplays: jest.fn() } },
        { provide: PlaybookFlowReplayReportService, useValue: options.replayReportService ?? { findLatestScoresForReplays: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(options.config ?? true) } },
      ],
    }).compile();
    return { service: moduleRef.get(PlaybookFlowService), flows, validator };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    idempotencyService.reserveSave.mockResolvedValue({ type: 'reserved' });
    playbookShareService.getSharedPlaybookIdsForUser.mockResolvedValue([]);
    playbookShareService.getShareInfoMapForUser.mockResolvedValue(new Map());
  });

  describe('persistSanitizedExecutionGraph', () => {
    it('atomically scopes graph cleanup to the owner and loaded revision', async () => {
      const flows = flowRepository();
      flows.updateFields.mockResolvedValue(makeFlow({ definitionRevision: 8 }));
      const { service } = await build({ flows });

      await expect(service.persistSanitizedExecutionGraph(
        'flow-1',
        'owner-1',
        7,
        [{ id: 'edge-1', source: 'a', target: 'b' } as any],
        [],
      )).resolves.toBe(8);

      expect(flows.updateFields).toHaveBeenCalledWith(
        'flow-1',
        { controlEdges: [{ id: 'edge-1', source: 'a', target: 'b' }], dataBindings: [] },
        { ownerId: 'owner-1', expectedRevision: 7, incrementRevision: true },
      );
    });

    it('rejects cleanup when the loaded revision lost the compare-and-swap race', async () => {
      const { service } = await build();

      await expect(service.persistSanitizedExecutionGraph('flow-1', 'owner-1', 7, [], []))
        .rejects.toThrow('Playbook changed while preparing execution.');
    });
  });

  it('findOneBase returns the flow without replay enrichment, as the document JSON', async () => {
    const flows = flowRepository();
    flows.findById.mockResolvedValue(makeFlow({ nodes: [{ id: 'task-1' } as any] }));
    const replayService = { getActiveReplays: jest.fn() };
    const replayReportService = { findLatestScoresForReplays: jest.fn() };
    const { service } = await build({ flows, replayService, replayReportService });

    const result = await service.findOneBase(FLOW_ID, 'user-1');

    expect(result.activeReplays).toEqual({});
    expect(result).toMatchObject({ id: FLOW_ID, accessLevel: 'owner', definitionRevision: 0 });
    // Fields the document never set are absent, not null.
    expect(result).not.toHaveProperty('description');
    expect(result).not.toHaveProperty('triggerConfig');
    expect(result).not.toHaveProperty('_id');
    expect(replayService.getActiveReplays).not.toHaveBeenCalled();
    expect(replayReportService.findLatestScoresForReplays).not.toHaveBeenCalled();
  });

  it('findOneEnriched loads replay metadata and scores', async () => {
    const flows = flowRepository();
    flows.findById.mockResolvedValue(makeFlow({ nodes: [{ id: 'task-1' }, { id: 'task-2' }] as any }));
    const replay = {
      id: 'replay-1',
      taskId: 'task-1',
      validationVersion: 3,
      isStale: false,
      staleReasons: [],
      preserveOutputFormat: true,
      outputFormatGuide: 'guide',
      formatGuideStatus: 'ready',
      label: 'Baseline',
    };
    const replayService = { getActiveReplays: jest.fn().mockResolvedValue([replay]) };
    const replayReportService = { findLatestScoresForReplays: jest.fn().mockResolvedValue(new Map([['replay-1', 91]])) };
    const { service } = await build({ flows, replayService, replayReportService });

    const result = await service.findOneEnriched(FLOW_ID, 'user-1');

    expect(replayService.getActiveReplays).toHaveBeenCalledWith(FLOW_ID, ['task-1', 'task-2']);
    expect(replayReportService.findLatestScoresForReplays).toHaveBeenCalledWith(['replay-1']);
    expect(result.activeReplays.taskId).toBeUndefined();
    expect(result.activeReplays['task-1']).toMatchObject({
      id: 'replay-1',
      validationVersion: 3,
      latestOverallScore: 91,
    });
  });

  it('reads a shared flow with the share permission as access level, and refuses one without a share', async () => {
    const flows = flowRepository();
    flows.findById.mockResolvedValue(makeFlow({ ownerId: 'owner-2' }));
    playbookShareService.getSharePermission.mockResolvedValue('write');
    const { service } = await build({ flows });

    await expect(service.findOneBase(FLOW_ID, 'user-1')).resolves.toMatchObject({ accessLevel: 'write' });
    playbookShareService.getSharePermission.mockResolvedValue(null);
    await expect(service.findOneBase(FLOW_ID, 'user-1')).rejects.toMatchObject({ message: 'You do not have access to this flow' });
    flows.findById.mockResolvedValue(null);
    await expect(service.findOneBase(FLOW_ID, 'user-1')).rejects.toMatchObject({ message: 'Playbook flow not found' });
  });

  it('includes latest execution status and timestamp in list items', async () => {
    const flows = flowRepository();
    flows.listAccessible.mockResolvedValue({
      total: 1,
      items: [{ flow: makeFlow({ id: 'flow-1' }), latestExecution: { status: 'running', activityAt: new Date('2025-01-03T00:00:00.000Z') } }],
    });
    const { service } = await build({ flows });

    const result = await service.findAll('user-1', {});

    expect(result.items[0]).toMatchObject({
      id: 'flow-1',
      accessLevel: 'owner',
      shareInfo: null,
      executionStatus: 'running',
      lastExecutionAt: new Date('2025-01-03T00:00:00.000Z'),
      activeReplays: {},
    });
    expect(result.pagination).toEqual({ page: 1, limit: 10, total: 1, totalPages: 1 });
    expect(flows.listAccessible).toHaveBeenCalledWith({
      ownerId: 'user-1', sharedFlowIds: [], search: undefined, sortBy: 'updatedAt', sortOrder: 'desc', page: 1, limit: 10,
    });
  });

  it('returns null execution metadata when a flow has no executions', async () => {
    const flows = flowRepository();
    flows.listAccessible.mockResolvedValue({ total: 1, items: [{ flow: makeFlow({ id: 'flow-2' }), latestExecution: null }] });
    const { service } = await build({ flows });

    const result = await service.findAll('user-1', {});

    expect(result.items[0]).toMatchObject({
      id: 'flow-2',
      executionStatus: null,
      lastExecutionAt: null,
    });
  });

  it('passes the activity sort and the shared flows to the list query, and labels shared items', async () => {
    const flows = flowRepository();
    playbookShareService.getSharedPlaybookIdsForUser.mockResolvedValue(['flow-shared']);
    const shareInfo = { shareId: 'share-1', permission: 'write', sharedBy: { id: 'owner-2', email: 'o@example.com' } };
    playbookShareService.getShareInfoMapForUser.mockResolvedValue(new Map([['flow-shared', shareInfo]]));
    flows.listAccessible.mockResolvedValue({
      total: 13,
      items: [{ flow: makeFlow({ id: 'flow-shared', ownerId: 'owner-2' }), latestExecution: { status: 'completed', activityAt: new Date('2025-02-01T00:00:00Z') } }],
    });
    const { service } = await build({ flows });

    const result = await service.findAll('user-1', { page: 2, limit: 6, sortBy: 'activityAt', sortOrder: 'desc', search: 'Recent' });

    expect(flows.listAccessible).toHaveBeenCalledWith({
      ownerId: 'user-1', sharedFlowIds: ['flow-shared'], search: 'Recent', sortBy: 'activityAt', sortOrder: 'desc', page: 2, limit: 6,
    });
    expect(result.items[0]).toMatchObject({ id: 'flow-shared', accessLevel: 'write', shareInfo, lastExecutionAt: new Date('2025-02-01T00:00:00Z') });
    expect(result.pagination).toEqual({ page: 2, limit: 6, total: 13, totalPages: 3 });
  });

  it('applies structural delta patches for nodes, edges, and bindings', async () => {
    const existing = makeFlow({
      ownerId: 'user-1',
      definitionRevision: 4,
      description: '',
      nodes: [
        { id: 'task-1', kind: 'step', label: 'Draft', input: { ports: [{ id: 'input' }] }, output: { ports: [{ id: 'output' }] }, metadata: { positionX: 10, positionY: 20 } },
        { id: 'task-2', kind: 'step', label: 'Remove', input: { ports: [{ id: 'input' }] }, output: { ports: [{ id: 'output' }] }, metadata: { positionX: 30, positionY: 40 } },
      ] as any,
      controlEdges: [{ id: 'edge-1', kind: 'sequential', source: 'task-1', target: 'task-2' }] as any,
      dataBindings: [{ id: 'binding-1', targetNode: 'task-2', targetPort: 'input', sourceKind: 'node-output', sourceNode: 'task-1', sourcePort: 'output' }] as any,
      workspaces: ['workspace-1'],
    });
    const flows = flowRepository();
    flows.findById.mockResolvedValue(existing);
    flows.updateFields.mockImplementation(async (_id, patch) => ({
      ...existing,
      ...patch,
      definitionRevision: 5,
      updatedAt: new Date('2026-05-30T06:10:00.000Z'),
    }));
    const { service, validator } = await build({ flows });

    const result = await service.applyDeltaPatch(FLOW_ID, 'user-1', {
      expectedDefinitionRevision: 4,
      patch: {
        nodes: {
          deleteIds: ['task-2'],
          upserts: [
            { id: 'task-1', kind: 'step', label: 'Draft revised', input: { ports: [{ id: 'input' }] }, output: { ports: [{ id: 'output' }] }, metadata: { positionX: 11, positionY: 21 } },
            { id: 'task-3', kind: 'step', label: 'Added', input: { ports: [{ id: 'input' }] }, output: { ports: [{ id: 'output' }] }, metadata: { positionX: 50, positionY: 60 } },
          ],
        },
        controlEdges: [{ id: 'edge-2', kind: 'sequential', source: 'task-1', target: 'task-3' }],
        dataBindings: [{ id: 'binding-2', targetNode: 'task-3', targetPort: 'input', sourceKind: 'node-output', sourceNode: 'task-1', sourcePort: 'output' }],
      },
    } as any);

    expect(validator.validate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'task-1', label: 'Draft revised' }),
        expect.objectContaining({ id: 'task-3', label: 'Added' }),
      ]),
      [{ id: 'edge-2', kind: 'sequential', source: 'task-1', target: 'task-3' }],
      [{ id: 'binding-2', targetNode: 'task-3', targetPort: 'input', sourceKind: 'node-output', sourceNode: 'task-1', sourcePort: 'output' }],
      { allowDraftRouters: true, allowUnboundRequiredPorts: true, allowIncompleteNodeOutputBindings: true },
    );
    expect(result.patchSummary).toEqual({
      scalarFields: 0,
      nodesUpserted: 2,
      nodesDeleted: 1,
      edgeChanges: 1,
      dataBindingChanges: 1,
      positionUpdates: 0,
    });
    const [flowId, patch, guard] = flows.updateFields.mock.calls[0];
    expect(flowId).toBe(FLOW_ID);
    expect(guard).toEqual({ ownerId: 'user-1', incrementRevision: true, expectedRevision: 4 });
    // The saved graph is cast like the Mongoose subdocuments were (port and edge defaults).
    expect(patch.nodes).toEqual([
      expect.objectContaining({ id: 'task-1', label: 'Draft revised', input: { ports: [{ id: 'input', required: false }] } }),
      expect.objectContaining({ id: 'task-3', label: 'Added' }),
    ]);
    expect(patch.controlEdges).toEqual([{ id: 'edge-2', kind: 'sequential', source: 'task-1', target: 'task-3', priority: 0 }]);
    expect(patch.dataBindings).toEqual([expect.objectContaining({ id: 'binding-2', targetNode: 'task-3', iteration: 'current' })]);
    // Unchanged workspaces are not rewritten.
    expect(patch).not.toHaveProperty('workspaces');
    expect(result).toMatchObject({ id: FLOW_ID, definitionRevision: 5, updatedAt: '2026-05-30T06:10:00.000Z', applied: true });
  });

  it('clears the autopilot target with an explicit null in a delta patch', async () => {
    const existing = makeFlow({ definitionRevision: 1, advisorAutopilotTargetScore: 0.8 });
    const flows = flowRepository();
    flows.findById.mockResolvedValue(existing);
    flows.updateFields.mockImplementation(async (_id, patch) => ({ ...existing, ...patch, definitionRevision: 2 }));
    const { service } = await build({ flows });

    await service.applyDeltaPatch(FLOW_ID, 'user-1', { expectedDefinitionRevision: 1, patch: { fields: { advisorAutopilotTargetScore: null } } } as any);

    expect(flows.updateFields.mock.calls[0][1]).toMatchObject({ advisorAutopilotTargetScore: null });
  });

  it('throws conflict when a delta save loses the compare-and-swap race', async () => {
    const flows = flowRepository();
    flows.findById.mockResolvedValue(makeFlow({ definitionRevision: 4, workspaces: ['workspace-1'] }));
    const { service } = await build({ flows });

    await expect(service.applyDeltaPatch(FLOW_ID, 'user-1', {
      expectedDefinitionRevision: 4,
      patch: { fields: { description: 'revised' } },
    } as any)).rejects.toMatchObject({ message: 'Playbook changed since this autosave started.' });
  });

  it('uses compare-and-swap persistence for full editor updates', async () => {
    const existing = makeFlow({ definitionRevision: 2, description: '', workspaces: ['workspace-1'] });
    const flows = flowRepository();
    flows.findById.mockResolvedValue(existing);
    flows.updateFields.mockResolvedValue(makeFlow({ name: 'Alpha revised', description: 'updated', definitionRevision: 3 }));
    const { service } = await build({ flows });

    const result = await service.update(FLOW_ID, 'user-1', {
      name: 'Alpha revised',
      description: 'updated',
      expectedDefinitionRevision: 2,
    } as any);

    expect(flows.updateFields).toHaveBeenCalledWith(
      FLOW_ID,
      expect.objectContaining({ name: 'Alpha revised', description: 'updated', nodes: [], hitlPolicy: expect.objectContaining({ mode: 'auto' }) }),
      { ownerId: 'user-1', incrementRevision: true, expectedRevision: 2 },
    );
    expect(result).toMatchObject({ id: FLOW_ID, name: 'Alpha revised', definitionRevision: 3, activeReplays: {} });
  });

  it('guards a full update on the expected updatedAt when no revision is given', async () => {
    const existing = makeFlow({ definitionRevision: 2 });
    const flows = flowRepository();
    flows.findById.mockResolvedValue(existing);
    flows.updateFields.mockResolvedValue(makeFlow({ definitionRevision: 3 }));
    const { service } = await build({ flows });

    await service.update(FLOW_ID, 'user-1', { name: 'B', expectedUpdatedAt: existing.updatedAt.toISOString() } as any);

    expect(flows.updateFields.mock.calls[0][2]).toEqual({ ownerId: 'user-1', incrementRevision: true, expectedUpdatedAt: existing.updatedAt });
    await expect(service.update(FLOW_ID, 'user-1', { name: 'B', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' } as any))
      .rejects.toMatchObject({ message: 'Playbook changed since this suggestion was generated. Refresh and retry the suggestion.' });
  });

  it('rewrites the workspaces only when the save changes them', async () => {
    const flows = flowRepository();
    flows.findById.mockResolvedValue(makeFlow({ workspaces: ['workspace-1'] }));
    flows.updateFields.mockResolvedValue(makeFlow({ definitionRevision: 1 }));
    const { service } = await build({ flows });

    await service.update(FLOW_ID, 'user-1', { workspaces: [' workspace-2 ', 'workspace-3'] } as any);

    expect(flows.updateFields.mock.calls[0][1].workspaces).toEqual(['workspace-2']);
  });

  it('validates full-save constant bindings as plain objects that own their constant value', async () => {
    const flows = flowRepository();
    flows.findById.mockResolvedValue(makeFlow({
      definitionRevision: 2,
      nodes: [{ id: 'target', kind: 'step', input: { ports: [{ id: 'destination', type: 'data', required: true }] } }] as any,
    }));
    flows.updateFields.mockResolvedValue(makeFlow({ definitionRevision: 3 }));
    const { service, validator } = await build({ flows });

    const constantValue = { workspaceId: 'workspace-1', workspaceName: 'Workspace' };
    await service.update(FLOW_ID, 'user-1', {
      expectedDefinitionRevision: 2,
      dataBindings: [{ id: 'binding-1', targetNode: 'target', targetPort: 'destination', sourceKind: 'constant', constantValue }],
    } as any);

    const validatedBindings = validator.validate.mock.calls[0][2];
    expect(validatedBindings[0]).toEqual(expect.objectContaining({ constantValue }));
    expect(Object.prototype.hasOwnProperty.call(validatedBindings[0], 'constantValue')).toBe(true);
  });

  it('throws conflict when a full editor update loses the compare-and-swap race', async () => {
    const flows = flowRepository();
    flows.findById.mockResolvedValue(makeFlow({ definitionRevision: 2 }));
    const { service } = await build({ flows });

    await expect(service.update(FLOW_ID, 'user-1', {
      name: 'Alpha revised',
      expectedDefinitionRevision: 2,
    } as any)).rejects.toMatchObject({
      message: 'Playbook changed since this suggestion was generated. Refresh and retry the suggestion.',
    });
  });

  it('maps a duplicate name to the PLAYBOOK_FLOW_DUPLICATE_NAME conflict on save, and releases the idempotency key', async () => {
    const flows = flowRepository();
    flows.findById.mockResolvedValue(makeFlow({ definitionRevision: 2 }));
    flows.updateFields.mockRejectedValue(uniqueViolation('uq_playbook_flows_owner_name'));
    const { service } = await build({ flows });

    await expect(service.update(FLOW_ID, 'user-1', { name: 'Taken', clientMutationId: 'm-dup' } as any)).rejects.toMatchObject({
      message: 'A playbook named "Taken" already exists.',
      code: ErrorCode.PLAYBOOK_FLOW_DUPLICATE_NAME,
    });
    expect(idempotencyService.release).toHaveBeenCalledWith('user-1', `flow-save:${FLOW_ID}:m-dup`);
  });

  it('returns stored full-save result for duplicate client mutation ids', async () => {
    idempotencyService.reserveSave.mockResolvedValueOnce({
      type: 'duplicate',
      responseBody: { id: 'flow-1', name: 'Saved', description: 'done', definitionRevision: 4, activeReplays: {} },
    });
    const { service, flows } = await build();

    const result = await service.update(FLOW_ID, 'user-1', {
      name: 'Saved',
      clientMutationId: 'mutation-1',
      expectedDefinitionRevision: 3,
    } as any);

    expect(result).toMatchObject({ id: 'flow-1', definitionRevision: 4 });
    expect(flows.findById).not.toHaveBeenCalled();
  });

  it('returns stored delta-save result for duplicate client mutation ids', async () => {
    idempotencyService.reserveSave.mockResolvedValueOnce({
      type: 'duplicate',
      responseBody: {
        id: 'flow-1',
        updatedAt: '2026-05-30T06:10:00.000Z',
        definitionRevision: 5,
        applied: true,
        patchSummary: { scalarFields: 1, nodesUpserted: 0, nodesDeleted: 0, edgeChanges: 0, dataBindingChanges: 0, positionUpdates: 0 },
      },
    });
    const { service, flows } = await build();

    const result = await service.applyDeltaPatch('flow-1', 'user-1', {
      expectedDefinitionRevision: 4,
      clientMutationId: 'mutation-1',
      patch: { fields: { description: 'saved' } },
    } as any);

    expect(result).toMatchObject({ id: 'flow-1', definitionRevision: 5, applied: true });
    expect(flows.findById).not.toHaveBeenCalled();
  });

  it('records the hash of the state as stored, so a retry after commit rebuilds the response', async () => {
    const existing = makeFlow({ definitionRevision: 3, name: 'Before' });
    const flows = flowRepository();
    flows.findById.mockResolvedValue(existing);
    flows.updateFields.mockImplementation(async (_id, patch) => ({ ...existing, ...patch, definitionRevision: 4 }));
    const { service } = await build({ flows });

    await service.update(FLOW_ID, 'user-1', {
      name: 'Saved',
      nodes: [{ id: 'n', kind: 'step', input: { ports: [{ id: 'p' }] } }],
      clientMutationId: 'mutation-2',
      expectedDefinitionRevision: 3,
    } as any);
    const [, key, stateHash, expectedRevision] = idempotencyService.recordExpectedSaveState.mock.calls[0];
    expect(key).toBe(`flow-save:${FLOW_ID}:mutation-2`);
    expect(expectedRevision).toBe(4);

    // The retry arrives after the commit but before the response was recorded: the stored flow hashes the same.
    const stored = await flows.updateFields.mock.results[0].value;
    flows.findById.mockResolvedValue(stored);
    idempotencyService.reserveSave.mockResolvedValueOnce({ type: 'duplicate-pending', expectedDefinitionRevision: 4, expectedStateHash: stateHash });
    idempotencyService.confirmSaveResult.mockClear();

    const retried = await service.update(FLOW_ID, 'user-1', {
      name: 'Saved',
      clientMutationId: 'mutation-2',
      expectedDefinitionRevision: 3,
    } as any);

    expect(retried).toMatchObject({ id: FLOW_ID, definitionRevision: 4, name: 'Saved' });
    expect(idempotencyService.confirmSaveResult).toHaveBeenCalled();
  });

  it('buildEditorStateHash handles circular flow graphs without recursion errors', async () => {
    const sharedNode: Record<string, unknown> = { id: 'node-1' };
    const circularFlow: Record<string, unknown> = {
      id: FLOW_ID,
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
    const { service } = await build();

    const hash = (service as any).buildEditorStateHash(circularFlow);

    expect(hash).toContain('"nodes":[{');
    expect(hash).toContain('"dataBindings":[{');
    expect(hash).toContain('[Circular]');
  });

  it('does not treat an unrelated revision bump as a successful duplicate full save', async () => {
    const flows = flowRepository();
    const saved = makeFlow({ definitionRevision: 4, name: 'Saved', description: 'done' });
    const { service } = await build({ flows });
    const expectedStateHash = (service as any).buildEditorStateHash(saved);
    idempotencyService.reserveSave.mockResolvedValueOnce({ type: 'duplicate-pending', expectedDefinitionRevision: 4, expectedStateHash });
    flows.findById.mockResolvedValue(makeFlow({ definitionRevision: 4, name: 'Different', description: 'other change' }));

    await expect(service.update(FLOW_ID, 'user-1', {
      name: 'Saved',
      expectedDefinitionRevision: 3,
      clientMutationId: 'mutation-3',
    } as any)).rejects.toMatchObject({
      message: 'Idempotency key reservation exists but save result was not recorded yet. Retry shortly with the same payload.',
    });
  });

  it('creates a Playbook without a default workspace', async () => {
    const flows = flowRepository();
    flows.create.mockImplementation(async (input) => makeFlow({ ...input, id: 'flow-new' }));
    const { service } = await build({ flows });

    const result = await service.create('user-1', { name: 'Workspace-free draft' });

    expect(flows.create.mock.calls[0][0].workspaces).toEqual([]);
    expect(flows.create.mock.calls[0][0]).toMatchObject({ ownerId: 'user-1', name: 'Workspace-free draft', schemaVersion: 1, advisorScoringMode: 'llm' });
    expect(result.workspaces).toEqual([]);
    expect(result).toMatchObject({ id: 'flow-new', activeReplays: {} });
  });

  it('suffixes a taken name with the next free sequence number', async () => {
    const flows = flowRepository();
    flows.nameTaken.mockResolvedValue(true);
    flows.listNamesWithPrefix.mockResolvedValue(['Report (2)', 'Report (7)', 'Report (draft)']);
    flows.create.mockImplementation(async (input) => makeFlow(input));
    const { service } = await build({ flows });

    await service.create('user-1', { name: 'Report' });

    expect(flows.listNamesWithPrefix).toHaveBeenCalledWith('user-1', 'Report (');
    expect(flows.create.mock.calls[0][0].name).toBe('Report (8)');
  });

  it('maps a unique violation on create to the PLAYBOOK_FLOW_DUPLICATE_NAME conflict', async () => {
    const flows = flowRepository();
    flows.create.mockRejectedValue(uniqueViolation('uq_playbook_flows_assistant_operation'));
    const { service } = await build({ flows });

    await expect(service.create('user-1', { name: 'Draft' }, { assistantOperationId: 'op-1' })).rejects.toMatchObject({
      code: ErrorCode.PLAYBOOK_FLOW_DUPLICATE_NAME,
      message: 'A playbook named "Draft" already exists.',
    });
    expect(flows.create.mock.calls[0][0]).toMatchObject({ assistantOperationId: 'op-1' });
  });

  it('createWithNodesAndEdges seeds smart HITL defaults by default', async () => {
    const flows = flowRepository();
    flows.create.mockImplementation(async (input) => makeFlow(input));
    const { service } = await build({ flows });

    await service.createWithNodesAndEdges('user-1', 'Base', '', [], [], [], []);

    const created = flows.create.mock.calls[0][0];
    expect(created.workspaces).toEqual([]);
    expect(created.hitlPolicy).toMatchObject({ mode: 'auto', sensitivity: 'balanced' });
    expect(created.hitlBlockers).toEqual([]);
  });

  it('createWithNodesAndEdges seeds a manual policy when smart HITL defaults are disabled', async () => {
    const flows = flowRepository();
    flows.create.mockImplementation(async (input) => makeFlow(input));
    const { service } = await build({ flows, config: false });

    await service.createWithNodesAndEdges('user-1', 'Base', '', [], [], []);

    expect(flows.create.mock.calls[0][0].hitlPolicy).toMatchObject({ mode: 'manual', disabledReason: 'Smart HITL defaults are disabled by configuration.' });
  });

  it('clone copies existing HITL policy and blockers for compatibility', async () => {
    const existing = makeFlow({
      name: 'Original',
      description: 'desc',
      triggerConfig: { kind: 'manual' },
      hitlPolicy: { mode: 'manual' } as any,
      hitlBlockers: [{ id: 'custom' }] as any,
      nodes: [{ id: 'task-1' }] as any,
      designSettings: { canvas: { zoom: 1 } },
      isFavorite: true,
    });
    const flows = flowRepository();
    flows.findById.mockResolvedValue(existing);
    flows.create.mockImplementation(async (input) => makeFlow({ ...input, id: 'flow-clone' }));
    const { service } = await build({ flows });

    const result = await service.clone(FLOW_ID, 'user-1');

    const created = flows.create.mock.calls[0][0];
    expect(created).toMatchObject({ ownerId: 'user-1', name: 'Original (copy)', description: 'desc', isFavorite: true, designSettings: { canvas: { zoom: 1 } } });
    expect(created.hitlPolicy).toEqual(existing.hitlPolicy);
    expect(created.hitlBlockers).toEqual(existing.hitlBlockers);
    expect(result.id).toBe('flow-clone');
  });

  it('refuses to clone a flow of another owner', async () => {
    const flows = flowRepository();
    flows.findById.mockResolvedValue(makeFlow({ ownerId: 'owner-2' }));
    const { service } = await build({ flows });

    await expect(service.clone(FLOW_ID, 'user-1')).rejects.toMatchObject({ message: 'You do not have access to this flow' });
    expect(flows.create).not.toHaveBeenCalled();
  });

  it('removes an owned flow (its shares go with it) and bulk-deletes only valid ids', async () => {
    const flows = flowRepository();
    flows.findById.mockResolvedValue(makeFlow());
    flows.deleteManyOwned.mockResolvedValue(['507f1f77bcf86cd799439012']);
    const { service } = await build({ flows });

    await service.remove(FLOW_ID, 'user-1');
    expect(flows.deleteOwned).toHaveBeenCalledWith(FLOW_ID, 'user-1');

    await expect(service.bulkDelete([], 'user-1')).rejects.toMatchObject({ message: 'No IDs provided' });
    await expect(service.bulkDelete(['nope'], 'user-1')).rejects.toMatchObject({ message: 'No valid IDs provided' });
    await expect(service.bulkDelete(['507f1f77bcf86cd799439012', 'nope'], 'user-1')).resolves.toEqual({ deleted: 1 });
    expect(flows.deleteManyOwned).toHaveBeenCalledWith(['507f1f77bcf86cd799439012'], 'user-1');
  });

  it('toggles the favourite flag after a write-access check', async () => {
    const flows = flowRepository();
    flows.findById.mockResolvedValue(makeFlow());
    flows.toggleFavorite.mockResolvedValue(true);
    const { service } = await build({ flows });

    await expect(service.toggleFavorite(FLOW_ID, 'user-1')).resolves.toEqual({ isFavorite: true });
    expect(flows.toggleFavorite).toHaveBeenCalledWith(FLOW_ID);
  });

  it('updates nodes and edges without a revision guard and sanitizes the graph', async () => {
    const existing = makeFlow({ workspaces: ['a', 'b'] as string[] });
    const flows = flowRepository();
    flows.findById.mockResolvedValue(existing);
    flows.updateFields.mockImplementation(async (_id, patch) => ({ ...existing, ...patch }));
    const { service } = await build({ flows });

    const result = await service.updateNodesAndEdges(FLOW_ID, { nodes: [{ id: 'n1', kind: 'step' }], controlEdges: [] });

    expect(flows.updateFields).toHaveBeenCalledWith(FLOW_ID, { nodes: [{ id: 'n1', kind: 'step' }], controlEdges: [], dataBindings: [], workspaces: ['a'] });
    expect(result).toMatchObject({ id: FLOW_ID, activeReplays: {} });
    flows.findById.mockResolvedValue(null);
    await expect(service.updateNodesAndEdges(FLOW_ID, { nodes: [] })).rejects.toBeDefined();
  });

  it('lists the active executions of the owner and of the flows shared with them', async () => {
    playbookShareService.getSharedPlaybookIdsForUser.mockResolvedValue(['flow-shared']);
    const executions = {
      listActive: jest.fn().mockResolvedValue([{ id: 'exec-1', flowId: 'flow-shared', status: 'running', error: null, pendingApproval: null, snapshot: undefined }]),
    };
    const { service } = await build({ executions });

    const result = await service.getActiveExecutions('user-1');

    expect(executions.listActive).toHaveBeenCalledWith('user-1', ['flow-shared']);
    expect(result).toEqual([{ id: 'exec-1', flowId: 'flow-shared', status: 'running', pendingApproval: null }]);
  });

  it('searches for the assistant: exact, then prefix, then partial matches, without duplicates', async () => {
    const flows = flowRepository();
    const row = (id: string, name: string) => ({ id, name, description: 'd'.repeat(600), definitionRevision: 2, updatedAt: new Date('2026-01-01T00:00:00Z') });
    flows.search
      .mockResolvedValueOnce([row('a', 'Report')])
      .mockResolvedValueOnce([row('a', 'Report'), row('b', 'Report weekly')])
      .mockResolvedValueOnce([row('c', 'My report')]);
    const { service } = await build({ flows });

    const result = await service.searchForAssistant('user-1', ' Report ', 'workspace-1', 5);

    expect(flows.search.mock.calls.map((call) => call[0].name)).toEqual([
      { text: 'Report', match: 'exact' },
      { text: 'Report', match: 'prefix' },
      { text: 'Report', match: 'partial' },
    ]);
    expect(flows.search.mock.calls[0][0]).toMatchObject({ ownerId: 'user-1', sharedFlowIds: [], workspaceId: 'workspace-1', limit: 5 });
    expect(result.map((item) => [item.playbookId, item.matchReason])).toEqual([['a', 'exact_name'], ['b', 'prefix_name'], ['c', 'partial_name']]);
    expect(result[0].description).toHaveLength(500);

    flows.search.mockResolvedValueOnce([row('z', 'Recent')]);
    await expect(service.searchForAssistant('user-1', undefined, '', 5)).resolves.toEqual([expect.objectContaining({ playbookId: 'z', matchReason: 'recent' })]);
    expect(flows.search.mock.calls[3][0]).toMatchObject({ workspaceId: undefined, name: undefined });
  });

  it('indexes the accessible flows and their tasks for the assistant', async () => {
    const flows = flowRepository();
    flows.listNodeIndex.mockResolvedValue([{ id: 'flow-1', name: 'Alpha', nodes: [{ id: 'n1', label: 'First' }, { id: 'n2', label: null }] }]);
    const { service } = await build({ flows });

    await expect(service.findAccessibleAssistantIndex('user-1')).resolves.toEqual([
      { playbookId: 'flow-1', name: 'Alpha', tasks: [{ taskId: 'n1', taskName: 'First' }, { taskId: 'n2', taskName: 'n2' }] },
    ]);
  });

  it('finds flows by trigger kind', async () => {
    const flows = flowRepository();
    flows.listByTrigger.mockResolvedValue([{ id: 'flow-1', ownerId: 'user-1', triggerConfig: { kind: 'mail' }, workspaces: [] }]);
    const { service } = await build({ flows });

    await expect(service.findAllWithTriggerKind('mail')).resolves.toEqual([{ id: 'flow-1', ownerId: 'user-1', triggerConfig: { kind: 'mail' } }]);
    expect(flows.listByTrigger).toHaveBeenCalledWith('mail');
  });
});
