import { EventEmitter } from 'events';
import { buildGrpcNodeMetadata, PlaybookFlowExecutionService, toGrpcStruct } from './playbook-flow-execution.service';

import { PlaybookFlowObservabilityService } from './observability/playbook-flow-observability.service';
import { PlaybookFlowPublicReasoningParserService } from './observability/playbook-flow-public-reasoning-parser.service';
import { PlaybookFlowTraceRedactionService } from './observability/playbook-flow-trace-redaction.service';
import { PlaybookFlowOutputContractService } from './playbook-flow-output-contract.service';

import {
  createExecutionRepositoryMock,
  createExecutionServiceForTests,
  createRouterDecisionRepositoryMock,
  createTaskResultRepositoryMock,
} from './playbook-flow-execution.test-support';

function structFields(value: Record<string, unknown>): Record<string, unknown> {
  return (toGrpcStruct(value) as { fields: Record<string, unknown> }).fields;
}

describe('buildGrpcNodeMetadata', () => {
  it('maps explicit node HITL fields to ADK metadata keys', () => {
    const metadata = buildGrpcNodeMetadata(
      {
        metadata: { enabled: true },
        interruptBefore: false,
        interruptAfter: true,
        allowClarification: true,
        clarificationPrompt: 'Ask one concise question.',
        maxClarifications: 2,
      },
      { hitlPolicy: { mode: 'off' } },
    );

    expect(metadata).toMatchObject({
      enabled: true,
      interrupt_before: false,
      interrupt_after: true,
      allow_clarification: true,
      clarification_prompt: 'Ask one concise question.',
      max_clarifications: 2,
      hitl_policy: { mode: 'off' },
    });
  });

  it('maps HITL fields stored inside node metadata to ADK metadata keys', () => {
    const metadata = buildGrpcNodeMetadata(
      {
        metadata: {
          allowClarification: true,
          clarificationPrompt: 'Ask before continuing.',
          maxClarifications: 3,
        },
      },
      { hitlPolicy: { mode: 'auto' } },
    );

    expect(metadata).toMatchObject({
      allowClarification: true,
      allow_clarification: true,
      clarification_prompt: 'Ask before continuing.',
      max_clarifications: 3,
      hitl_policy: { mode: 'auto' },
    });
  });

  it('passes only enabled user-created blockers to ADK metadata', () => {
    const metadata = buildGrpcNodeMetadata(
      { metadata: {} },
      {
        hitlBlockers: [
          { id: 'system-rule', createdBy: 'system', enabled: true },
          { id: 'disabled-user-rule', createdBy: 'user', enabled: false },
          { id: 'user-rule', createdBy: 'user', enabled: true },
        ],
      },
    );

    expect(metadata.hitl_blockers).toEqual([
      { id: 'user-rule', createdBy: 'user', enabled: true },
    ]);
  });
});

describe('PlaybookFlowExecutionService start preflight', () => {
  it('uses the base execution-start read instead of the enriched read path', async () => {
    const executionRepository = createExecutionRepositoryMock();
    const flowService = {
      findOneForExecutionStart: jest.fn().mockResolvedValue({
        id: 'flow-1',
        nodes: [],
        controlEdges: [],
        dataBindings: [],
        settings: {},
      }),
      findOne: jest.fn(),
      findById: jest.fn(),
    };
    const service = new PlaybookFlowExecutionService(
      executionRepository as any,
      createTaskResultRepositoryMock() as any,
      createRouterDecisionRepositoryMock() as any,
      { get: jest.fn((key: string, fallback: unknown) => fallback) } as any,
      { init: jest.fn(), isAvailable: jest.fn().mockReturnValue(false) } as any,
      { admit: jest.fn().mockResolvedValue(0), release: jest.fn(), refreshPositions: jest.fn().mockResolvedValue([]) } as any,
      { reserve: jest.fn(), confirmLink: jest.fn(), release: jest.fn() } as any,
      flowService as any,
      { buildSnapshot: jest.fn().mockReturnValue({ settings: {}, nodes: [], controlEdges: [], dataBindings: [] }) } as any,
      { validate: jest.fn(), collectValidationErrors: jest.fn().mockReturnValue([]) } as any,
      { buildGrpcAgentsForPlaybook: jest.fn() } as any,
      { cacheOwner: jest.fn(), emitExecutionQueued: jest.fn() } as any,
      new PlaybookFlowObservabilityService(
        new PlaybookFlowTraceRedactionService(),
        new PlaybookFlowPublicReasoningParserService(),
      ) as any,
      {} as any,
      { resolveReplayArtifacts: async () => new Map() } as any,
      { buildReplayPromptSection: () => '' } as any,
      { createPreRunReport: jest.fn(), updateStructuralDrift: jest.fn() } as any,
      new PlaybookFlowOutputContractService() as any,
      { validateModelActive: jest.fn().mockResolvedValue({ valid: true, model: null, inactive: false }) } as any,
    );
    jest.spyOn(service as any, 'drainQueue').mockResolvedValue(undefined);

    await service.start('flow-1', 'owner-1');

    expect(flowService.findOneForExecutionStart).toHaveBeenCalledWith('flow-1', 'owner-1');
    expect(flowService.findOne).not.toHaveBeenCalled();
  });

  it('rejects missing runtime inputs before reserving idempotency', async () => {
    const sanitizedDocument = { save: jest.fn() };
    const flowService = { findById: jest.fn().mockResolvedValue(sanitizedDocument) };
    const graphSanitizerService = {
      sanitize: jest.fn().mockReturnValue({
        nodes: [],
        controlEdges: [],
        dataBindings: [],
        removedOrphanedEdgeCount: 1,
        removedOrphanedBindingCount: 0,
        removedStaleBindingCount: 0,
      }),
    };
    const { service, idempotencyService } = createExecutionServiceForTests({ flowService, graphSanitizerService });
    (service as any).inputContractService = {
      derive: jest.fn().mockReturnValue({
        inputs: [{
          id: 'step-1:brief',
          taskId: 'step-1',
          taskTitle: 'Draft report',
          portId: 'brief',
          label: 'Brief',
          artifactKind: 'text',
          required: true,
          scope: 'runtime',
          binding: { kind: 'trigger', triggerPath: 'playbookInputs.brief' },
          acceptedSources: ['manual'],
          readiness: 'runtime_required',
        }],
      }),
    };

    await expect(service.start('flow-1', 'owner-1', {}, 'idem-1'))
      .rejects.toThrow('Required Playbook input Brief is missing.');

    expect(idempotencyService.reserve).not.toHaveBeenCalled();
    expect(flowService.findById).not.toHaveBeenCalled();
    expect(sanitizedDocument.save).not.toHaveBeenCalled();
  });

  it('rejects inaccessible document inputs before reserving idempotency', async () => {
    const { service, idempotencyService } = createExecutionServiceForTests();
    (service as any).inputContractService = {
      derive: jest.fn().mockReturnValue({
        inputs: [{
          id: 'step-1:document',
          taskId: 'step-1',
          taskTitle: 'Summarize document',
          portId: 'document',
          label: 'Document',
          artifactKind: 'document',
          required: true,
          scope: 'runtime',
          binding: { kind: 'trigger', triggerPath: 'playbookInputs.document' },
          acceptedSources: ['document'],
          readiness: 'runtime_required',
        }],
      }),
    };
    (service as any).workspaceShareService = {
      assertUserHasAccess: jest.fn().mockRejectedValue(new Error('forbidden')),
    };
    (service as any).workspaceDocumentService = { findByIds: jest.fn() };

    await expect(service.start('flow-1', 'owner-1', {
      playbookInputs: {
        document: { kind: 'document', id: 'doc-1', workspaceId: 'workspace-1' },
      },
    }, 'idem-1')).rejects.toThrow('The selected resource for Document is unavailable or inaccessible.');

    expect(idempotencyService.reserve).not.toHaveBeenCalled();
  });

  it('fails closed when document authorization services are unavailable', async () => {
    const { service } = createExecutionServiceForTests();
    (service as any).inputContractService = {
      derive: jest.fn().mockReturnValue({
        inputs: [{
          id: 'step-1:document',
          taskId: 'step-1',
          taskTitle: 'Summarize document',
          portId: 'document',
          label: 'Document',
          artifactKind: 'document',
          required: true,
          scope: 'runtime',
          binding: { kind: 'trigger', triggerPath: 'playbookInputs.document' },
          acceptedSources: ['document'],
          readiness: 'runtime_required',
        }],
      }),
    };

    await expect(service.start('flow-1', 'owner-1', {
      playbookInputs: {
        document: { kind: 'document', id: 'doc-1', workspaceId: 'workspace-1' },
      },
    })).rejects.toThrow('The selected resource for Document is unavailable or inaccessible.');
  });

  it('revalidates configured destinations with write access before reserving idempotency', async () => {
    const flowService = {
      findOneForExecutionStart: jest.fn().mockResolvedValue({
        id: 'flow-1',
        nodes: [{
          id: 'step-1',
          kind: 'step',
          label: 'Save report',
          input: { ports: [{ id: 'destination', label: 'Destination workspace', type: 'document', required: true }] },
          output: { ports: [] },
        }],
        controlEdges: [],
        dataBindings: [{
          id: 'binding-1',
          targetNode: 'step-1',
          targetPort: 'destination',
          sourceKind: 'constant',
          constantValue: { kind: 'workspace', id: 'workspace-1', workspaceId: 'workspace-1' },
        }],
        settings: {},
      }),
    };
    const { service, idempotencyService } = createExecutionServiceForTests({ flowService });
    const workspaceShareService = {
      assertUserHasAccess: jest.fn(),
      assertUserHasWriteAccess: jest.fn().mockRejectedValue(new Error('read only')),
    };
    (service as any).workspaceShareService = workspaceShareService;
    (service as any).inputContractService = {
      derive: jest.fn().mockReturnValue({
        inputs: [{
          id: 'step-1:destination',
          taskId: 'step-1',
          taskTitle: 'Save report',
          portId: 'destination',
          label: 'Destination workspace',
          artifactKind: 'document',
          required: true,
          scope: 'configuration',
          binding: { kind: 'constant' },
          acceptedSources: ['workspace'],
          readiness: 'configured',
        }],
      }),
    };

    await expect(service.start('flow-1', 'owner-1', {}, 'idem-1'))
      .rejects.toThrow('The selected resource for Destination workspace is unavailable or inaccessible.');

    expect(workspaceShareService.assertUserHasWriteAccess).toHaveBeenCalledWith('owner-1', 'workspace-1');
    expect(workspaceShareService.assertUserHasAccess).not.toHaveBeenCalled();
    expect(idempotencyService.reserve).not.toHaveBeenCalled();
  });

  it.each([
    ['primitive', 'workspace-1'],
    ['unknown resource', { kind: 'bucket', id: 'workspace-1', workspaceId: 'workspace-1' }],
    ['document resource', { kind: 'document', id: 'doc-1', workspaceId: 'workspace-1' }],
  ])('rejects a %s configuration destination before authorization and idempotency', async (_label, constantValue) => {
    const flowService = {
      findOneForExecutionStart: jest.fn().mockResolvedValue({
        id: 'flow-1',
        nodes: [{
          id: 'step-1', kind: 'step', label: 'Save report',
          input: { ports: [{ id: 'destination', label: 'Destination workspace', type: 'data', required: true }] },
          output: { ports: [] },
        }],
        controlEdges: [],
        dataBindings: [{
          id: 'binding-1', targetNode: 'step-1', targetPort: 'destination',
          sourceKind: 'constant', constantValue,
        }],
        settings: {},
      }),
    };
    const { service, idempotencyService } = createExecutionServiceForTests({ flowService });
    const workspaceShareService = {
      assertUserHasAccess: jest.fn(),
      assertUserHasWriteAccess: jest.fn(),
    };
    (service as any).workspaceShareService = workspaceShareService;
    (service as any).inputContractService = {
      derive: jest.fn().mockReturnValue({
        inputs: [{
          id: 'step-1:destination', taskId: 'step-1', taskTitle: 'Save report',
          portId: 'destination', label: 'Destination workspace', artifactKind: 'data',
          required: true, scope: 'configuration', binding: { kind: 'constant' },
          acceptedSources: ['workspace'], readiness: 'configured',
        }],
      }),
    };

    await expect(service.start('flow-1', 'owner-1', {}, 'idem-1'))
      .rejects.toThrow('The selected resource for Destination workspace is unavailable or inaccessible.');

    expect(workspaceShareService.assertUserHasWriteAccess).not.toHaveBeenCalled();
    expect(idempotencyService.reserve).not.toHaveBeenCalled();
  });

  it('rejects workspace resources whose id does not match their authorized workspace', async () => {
    const { service, idempotencyService } = createExecutionServiceForTests();
    const workspaceShareService = { assertUserHasAccess: jest.fn() };
    (service as any).workspaceShareService = workspaceShareService;
    (service as any).inputContractService = {
      derive: jest.fn().mockReturnValue({
        inputs: [{
          id: 'step-1:workspace',
          taskId: 'step-1',
          taskTitle: 'Read workspace',
          portId: 'workspace',
          label: 'Workspace',
          artifactKind: 'document',
          required: true,
          scope: 'runtime',
          binding: { kind: 'trigger', triggerPath: 'playbookInputs.workspace' },
          acceptedSources: ['workspace'],
          readiness: 'runtime_required',
        }],
      }),
    };

    await expect(service.start('flow-1', 'owner-1', {
      playbookInputs: {
        workspace: { kind: 'workspace', id: 'workspace-other', workspaceId: 'workspace-1' },
      },
    }, 'idem-1')).rejects.toThrow('The selected resource for Workspace is unavailable or inaccessible.');

    expect(workspaceShareService.assertUserHasAccess).not.toHaveBeenCalled();
    expect(idempotencyService.reserve).not.toHaveBeenCalled();
  });

  it('persists a shared-write collaborator sanitation with the document owner before idempotency', async () => {
    const conflict = new Error('revision conflict');
    const flowService = {
      findOneForExecutionStart: jest.fn().mockResolvedValue({
        id: 'flow-1',
        ownerId: 'document-owner',
        definitionRevision: 7,
        nodes: [],
        controlEdges: [{ id: 'orphan', source: 'missing', target: 'missing' }],
        dataBindings: [],
        settings: {},
      }),
      persistSanitizedExecutionGraph: jest.fn().mockRejectedValue(conflict),
    };
    const { service, idempotencyService } = createExecutionServiceForTests({ flowService });

    await expect(service.start('flow-1', 'owner-1', {}, 'idem-1')).rejects.toThrow('revision conflict');

    expect(flowService.persistSanitizedExecutionGraph).toHaveBeenCalledWith('flow-1', 'document-owner', 7, [], []);
    expect(idempotencyService.reserve).not.toHaveBeenCalled();
  });
});



describe('PlaybookFlowExecutionService lifecycle handling', () => {
  it('does not claim queued work when gRPC is unavailable', async () => {
    const { service, queueService } = createExecutionServiceForTests();
    (service as any).isGrpcAvailable = false;

    await (service as any).drainQueue('owner-1');

    expect(queueService.release).not.toHaveBeenCalled();
  });

  it('fails a claimed execution when its flow cannot be loaded', async () => {
    const executionRepository = {
      findById: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }),
    };
    const queueService = {
      release: jest.fn()
        .mockResolvedValueOnce({ id: 'exec-missing', flowId: 'flow-missing', inputContext: {} })
        .mockResolvedValueOnce(null),
      refreshPositions: jest.fn().mockResolvedValue([]),
    };
    const flowService = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    const { service, streamEvents, executionRepository: repository } = createExecutionServiceForTests({ executionRepository, queueService, flowService });
    (service as any).isGrpcAvailable = true;

    await (service as any).drainQueue('owner-1');

    expect(repository.findById).toHaveBeenCalledWith('exec-missing', { withSnapshot: true });
    expect(repository.markFailed).toHaveBeenCalledWith('exec-missing', 'Flow not found before runtime start');
    expect(streamEvents.emitExecutionComplete).toHaveBeenCalledWith(
      'exec-missing',
      'failed',
      'Flow not found before runtime start',
    );
  });

  it('ignores late approval requests after a terminal state already won', async () => {
    const executionRepository = {
      setPendingApproval: jest.fn().mockResolvedValue(false),
      findById: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }),
    };
    const { service, streamEvents } = createExecutionServiceForTests({ executionRepository });

    await (service as any).handleRunEvent('exec-2', {
      event_type: 'ApprovalRequested',
      node_id: 'approval-1',
      iteration: 0,
      payload: { prompt: 'Approve?' },
    });

    expect(executionRepository.setPendingApproval).toHaveBeenCalledWith('exec-2', expect.objectContaining({
      nodeId: 'approval-1', iteration: 0, prompt: 'Approve?', interruptType: 'approval_request', resumableActions: ['approve', 'reject'],
    }));
    expect(streamEvents.emitInterrupt).not.toHaveBeenCalled();
  });

  it('ignores late reserved router labels after a terminal state already won', async () => {
    const executionRepository = {
      transition: jest.fn().mockResolvedValue(false),
      findById: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }),
    };
    const { service, streamEvents } = createExecutionServiceForTests({ executionRepository });

    await (service as any).handleRunEvent('exec-3', {
      event_type: 'RouterDecision',
      node_id: 'router-2',
      iteration: 0,
      payload: { label: '__error__' },
    });

    expect(streamEvents.emitExecutionComplete).not.toHaveBeenCalled();
  });

  it('rejects modelIdOverride for inactive or invalid models after reserving idempotency and releases the reservation', async () => {
    const modelsService = {
      validateModelActive: jest.fn().mockResolvedValue({ valid: false, model: null, inactive: true }),
    };
    const idempotencyService = {
      reserve: jest.fn().mockResolvedValue({ type: 'reserved' }),
      release: jest.fn().mockResolvedValue(undefined),
      confirmLink: jest.fn(),
    };

    const service = new PlaybookFlowExecutionService(
      createExecutionRepositoryMock() as any,
      createTaskResultRepositoryMock() as any,
      createRouterDecisionRepositoryMock() as any,
      { get: jest.fn((key: string, fallback: unknown) => fallback) } as any,
      { init: jest.fn(), isAvailable: jest.fn().mockReturnValue(false) } as any,
      { admit: jest.fn(), release: jest.fn(), refreshPositions: jest.fn() } as any,
      idempotencyService as any,
      { findOne: jest.fn().mockResolvedValue({ nodes: [], controlEdges: [], dataBindings: [], settings: {} }) } as any,
      { buildSnapshot: jest.fn().mockReturnValue({ settings: { recursionLimit: 25, maxParallelism: 5 } }) } as any,
      { validate: jest.fn(), collectValidationErrors: jest.fn().mockReturnValue([]) } as any,
      { buildGrpcAgentsForPlaybook: jest.fn() } as any,
      { cacheOwner: jest.fn(), emitExecutionQueued: jest.fn() } as any,
      new PlaybookFlowObservabilityService(
        new PlaybookFlowTraceRedactionService(),
        new PlaybookFlowPublicReasoningParserService(),
      ) as any,
      {} as any,
      { resolveReplayArtifacts: async () => new Map() } as any,
      { buildReplayPromptSection: () => '' } as any,
      { createPreRunReport: jest.fn(), updateStructuralDrift: jest.fn() } as any,
      new PlaybookFlowOutputContractService() as any,
      modelsService as any,
    );

    await expect(
      service.start('flow-1', 'owner-1', {}, 'idem-1', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'inactive-model-id'),
    ).rejects.toThrow('Model override');

    expect(idempotencyService.reserve).toHaveBeenCalledWith('owner-1', 'idem-1', expect.any(Object));
    expect(modelsService.validateModelActive).toHaveBeenCalledWith('inactive-model-id');
    expect(idempotencyService.release).toHaveBeenCalledWith('owner-1', 'idem-1');
  });

  it('rolls back a saved execution when idempotency linking fails', async () => {
    const executionRepository = createExecutionRepositoryMock({
      insert: jest.fn().mockResolvedValue({ id: 'exec-rollback', status: 'queued', queuePosition: 0, pendingApproval: null }),
    });

    const idempotencyService = {
      reserve: jest.fn().mockResolvedValue({ type: 'reserved' }),
      confirmLink: jest.fn().mockRejectedValue(new Error('link failed')),
      release: jest.fn().mockResolvedValue(undefined),
    };

    const service = new PlaybookFlowExecutionService(
      executionRepository as any,
      createTaskResultRepositoryMock() as any,
      createRouterDecisionRepositoryMock() as any,
      { get: jest.fn((key: string, fallback: unknown) => fallback) } as any,
      { init: jest.fn(), isAvailable: jest.fn().mockReturnValue(false) } as any,
      { admit: jest.fn(), release: jest.fn(), refreshPositions: jest.fn() } as any,
      idempotencyService as any,
      { findOne: jest.fn().mockResolvedValue({ nodes: [], controlEdges: [], dataBindings: [], settings: {} }) } as any,
      { buildSnapshot: jest.fn().mockReturnValue({ settings: { recursionLimit: 25, maxParallelism: 5 } }) } as any,
      { validate: jest.fn(), collectValidationErrors: jest.fn().mockReturnValue([]) } as any,
      { buildGrpcAgentsForPlaybook: jest.fn() } as any,
      { cacheOwner: jest.fn(), emitExecutionQueued: jest.fn() } as any,
      new PlaybookFlowObservabilityService(
        new PlaybookFlowTraceRedactionService(),
        new PlaybookFlowPublicReasoningParserService(),
      ) as any,
      {} as any,
      { resolveReplayArtifacts: async () => new Map() } as any,
      { buildReplayPromptSection: () => '' } as any,
      { createPreRunReport: jest.fn(), updateStructuralDrift: jest.fn() } as any,
      new PlaybookFlowOutputContractService() as any,
      { validateModelActive: jest.fn().mockResolvedValue({ valid: true, model: null, inactive: false }) } as any,
    );

    await expect(service.start('flow-1', 'owner-1', {}, 'idem-1')).rejects.toThrow('link failed');
    expect(executionRepository.delete).toHaveBeenCalledWith('exec-rollback');
    expect(idempotencyService.release).toHaveBeenCalledWith('owner-1', 'idem-1');
  });

  it('returns the existing execution for a duplicate idempotency key', async () => {
    const existingExecution = { id: 'exec-existing', ownerId: 'owner-1', status: 'queued', startedAt: null, pendingApproval: null };
    const executionRepository = {
      findById: jest.fn().mockResolvedValue(existingExecution),
    };
    const { service, idempotencyService } = createExecutionServiceForTests({ executionRepository });
    idempotencyService.reserve.mockResolvedValue({ type: 'duplicate', executionId: 'exec-existing' });

    const result = await service.start('flow-1', 'owner-1', { brief: 'same' }, 'idem-1');

    // The stored run as its toJSON shape: unset fields absent, no snapshot.
    expect(result).toEqual({ id: 'exec-existing', ownerId: 'owner-1', status: 'queued', pendingApproval: null });
    expect(executionRepository.findById).toHaveBeenCalledWith('exec-existing');
  });

  it('returns the existing execution for a duplicate idempotency key before validating model override', async () => {
    const existingExecution = { id: 'exec-existing', ownerId: 'owner-1', status: 'queued', pendingApproval: null };
    const executionRepository = {
      findById: jest.fn().mockResolvedValue(existingExecution),
    };
    const { service, idempotencyService } = createExecutionServiceForTests({ executionRepository });
    idempotencyService.reserve.mockResolvedValue({ type: 'duplicate', executionId: 'exec-existing' });
    (service as any).modelsService = {
      validateModelActive: jest.fn().mockResolvedValue({ valid: false, model: null, inactive: true }),
    };

    const result = await service.start('flow-1', 'owner-1', { brief: 'same' }, 'idem-1', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'inactive-model-id');

    expect(result).toEqual({ id: 'exec-existing', ownerId: 'owner-1', status: 'queued', pendingApproval: null });
    expect((service as any).modelsService.validateModelActive).not.toHaveBeenCalled();
  });

  it('releases the idempotency reservation when model validation throws after reservation', async () => {
    const modelsService = {
      validateModelActive: jest.fn().mockRejectedValue(new Error('model lookup failed')),
    };
    const idempotencyService = {
      reserve: jest.fn().mockResolvedValue({ type: 'reserved' }),
      release: jest.fn().mockResolvedValue(undefined),
      confirmLink: jest.fn(),
    };

    const service = new PlaybookFlowExecutionService(
      createExecutionRepositoryMock() as any,
      createTaskResultRepositoryMock() as any,
      createRouterDecisionRepositoryMock() as any,
      { get: jest.fn((key: string, fallback: unknown) => fallback) } as any,
      { init: jest.fn(), isAvailable: jest.fn().mockReturnValue(false) } as any,
      { admit: jest.fn(), release: jest.fn(), refreshPositions: jest.fn() } as any,
      idempotencyService as any,
      { findOne: jest.fn().mockResolvedValue({ nodes: [], controlEdges: [], dataBindings: [], settings: {} }) } as any,
      { buildSnapshot: jest.fn().mockReturnValue({ settings: { recursionLimit: 25, maxParallelism: 5 } }) } as any,
      { validate: jest.fn(), collectValidationErrors: jest.fn().mockReturnValue([]) } as any,
      { buildGrpcAgentsForPlaybook: jest.fn() } as any,
      { cacheOwner: jest.fn(), emitExecutionQueued: jest.fn() } as any,
      new PlaybookFlowObservabilityService(
        new PlaybookFlowTraceRedactionService(),
        new PlaybookFlowPublicReasoningParserService(),
      ) as any,
      {} as any,
      { resolveReplayArtifacts: async () => new Map() } as any,
      { buildReplayPromptSection: () => '' } as any,
      { createPreRunReport: jest.fn(), updateStructuralDrift: jest.fn(), findLatestReportForExecutionTask: jest.fn() } as any,
      new PlaybookFlowOutputContractService() as any,
      modelsService as any,
    );

    await expect(
      service.start('flow-1', 'owner-1', {}, 'idem-1', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'unstable-model-id'),
    ).rejects.toThrow('model lookup failed');

    expect(idempotencyService.reserve).toHaveBeenCalledWith('owner-1', 'idem-1', expect.any(Object));
    expect(idempotencyService.release).toHaveBeenCalledWith('owner-1', 'idem-1');
  });

  it('persists replay drift for queued node completions before a stream error clears tracking', async () => {
    const replayReportService = {
      createPreRunReport: jest.fn().mockResolvedValue(undefined),
      updateStructuralDrift: jest.fn().mockResolvedValue(undefined),
      findLatestReportForExecutionTask: jest.fn().mockResolvedValue({
        executionId: 'exec-1',
        flowId: 'flow-1',
        taskId: 'step-1',
        replayId: 'replay-1',
        validationVersion: 2,
      }),
    };
    const replayArtifactService = {
      resolveReplayArtifacts: jest.fn(async () => new Map([['step-1', {
        taskId: 'step-1',
        replayId: 'replay-1',
        flowId: 'flow-1',
        validationVersion: 2,
        mode: 'replay_strict',
        referenceOutput: null,
        outputFormatGuide: null,
        toolCalls: [],
        reasoningChain: [],
        fingerprints: null,
        behaviorBaseline: null,
        toolPolicy: {
          requiredTools: ['search'],
          forbiddenTools: [],
          sequencingRules: [],
          requireSameOrder: false,
        },
        outputContract: null,
        replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false },
      }]])),
    };
    const executionRepository = {
      findById: jest.fn()
        .mockResolvedValueOnce({ executionMode: 'replay_strict', stepExecutionModes: { 'step-1': 'replay_strict' } })
        .mockResolvedValueOnce({ executionMode: 'replay_strict', singleStepTaskId: null })
        .mockResolvedValue({ ownerId: 'owner-1' }),
    };
    const snapshot = {
      nodes: [{ id: 'step-1', kind: 'step', metadata: {} }],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    };
    const { service, agentService } = createExecutionServiceForTests({
      replayArtifactService,
      replayReportService,
      executionRepository,
    });
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    const handlers: Record<string, (arg?: any) => void> = {};
    const runCall = {
      on: jest.fn((event: string, handler: (arg?: any) => void) => {
        handlers[event] = handler;
      }),
    };
    (service as any).playbookFlowClient = { Run: jest.fn().mockReturnValue(runCall) };
    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', snapshot, {}, snapshot);

    handlers.data?.({
      event_type: 'NodeCompleted',
      node_id: 'step-1',
      iteration: 0,
      payload: {
        output: 'Completed',
        tool_trace: [{ call_index: 1, tool_name: 'search', args: {}, status: 'completed' }],
      },
    });
    handlers.error?.(new Error('stream failed'));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(replayReportService.updateStructuralDrift).toHaveBeenCalledWith(expect.objectContaining({
      executionId: 'exec-1',
      taskId: 'step-1',
      iteration: 0,
      replayArtifacts: expect.objectContaining({ replayId: 'replay-1' }),
      toolTrace: [expect.objectContaining({ callIndex: 1, toolName: 'search' })],
    }));
  });

  it('scopes idempotency reservations by flowId and inputContext', async () => {
    const executionRepository = createExecutionRepositoryMock();
    const idempotencyService = {
      reserve: jest.fn().mockResolvedValue({ type: 'reserved' }),
      confirmLink: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PlaybookFlowExecutionService(
      executionRepository as any,
      createTaskResultRepositoryMock() as any,
      createRouterDecisionRepositoryMock() as any,
      { get: jest.fn((key: string, fallback: unknown) => fallback) } as any,
      { init: jest.fn(), isAvailable: jest.fn().mockReturnValue(false) } as any,
      { admit: jest.fn().mockResolvedValue(1), release: jest.fn(), refreshPositions: jest.fn().mockResolvedValue([]) } as any,
      idempotencyService as any,
      { findOne: jest.fn().mockResolvedValue({ nodes: [], controlEdges: [], dataBindings: [], settings: {} }) } as any,
      { buildSnapshot: jest.fn().mockReturnValue({ settings: {}, nodes: [], controlEdges: [], dataBindings: [] }) } as any,
      { validate: jest.fn(), collectValidationErrors: jest.fn().mockReturnValue([]) } as any,
      { buildGrpcAgentsForPlaybook: jest.fn() } as any,
      { cacheOwner: jest.fn(), emitExecutionQueued: jest.fn() } as any,
      new PlaybookFlowObservabilityService(
        new PlaybookFlowTraceRedactionService(),
        new PlaybookFlowPublicReasoningParserService(),
      ) as any,
      {} as any,
      { resolveReplayArtifacts: async () => new Map() } as any,
      { buildReplayPromptSection: () => '' } as any,
      { createPreRunReport: jest.fn(), updateStructuralDrift: jest.fn() } as any,
      new PlaybookFlowOutputContractService() as any,
      { validateModelActive: jest.fn().mockResolvedValue({ valid: true, model: null, inactive: false }) } as any,
    );
    idempotencyService.reserve.mockResolvedValue({ type: 'reserved' });
    jest.spyOn(service as any, 'drainQueue').mockResolvedValue(undefined);

    await service.start('flow-abc', 'owner-1', { brief: 'same' }, 'idem-1');

    expect(idempotencyService.reserve).toHaveBeenCalledWith('owner-1', 'idem-1', {
      flowId: 'flow-abc',
      inputContext: { brief: 'same' },
      executionMode: 'live',
      stepExecutionModes: {},
    });
    expect(idempotencyService.confirmLink).toHaveBeenCalledWith('owner-1', 'idem-1', 'exec-new');
  });

  it('drains the queue after a pre-stream startup failure without claiming and abandoning work', async () => {
    const { service, agentService } = createExecutionServiceForTests({
      flowService: { findOne: jest.fn().mockResolvedValue({ settings: {}, nodes: [], controlEdges: [], dataBindings: [] }) },
      builderService: {
        buildSnapshot: jest.fn().mockReturnValue({
          settings: {},
          nodes: [{ id: 'step-1', kind: 'step', metadata: { assignedAgentId: 'agent-1' } }],
          controlEdges: [],
          dataBindings: [],
        }),
      },
    });
    const scheduleQueueDrainSpy = jest.spyOn(service as any, 'scheduleQueueDrain').mockImplementation(() => undefined);
    agentService.buildGrpcAgentsForPlaybook.mockRejectedValue(new Error('bootstrap failed'));

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', {
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    }, {});

    expect(scheduleQueueDrainSpy).toHaveBeenCalledWith('owner-1');
    scheduleQueueDrainSpy.mockRestore();
  });

  it('injects active HITL memory into the runtime input context', async () => {
    const snapshot = {
      nodes: [{ id: 'step-1', kind: 'step', metadata: {} }],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    };
    const run = jest.fn().mockReturnValue({ on: jest.fn() });
    const { service, agentService } = createExecutionServiceForTests({
      flowService: { findOne: jest.fn().mockResolvedValue(snapshot) },
      builderService: { buildSnapshot: jest.fn().mockReturnValue(snapshot) },
      executionRepository: {
        findById: jest.fn().mockResolvedValue({ executionMode: 'live', stepExecutionModes: {}, seededTaskOutputs: [] }),
      },
      hitlMemoryRepository: {
        listActiveForNodes: jest.fn().mockResolvedValue([{
              id: 'memory-1',
              flowId: 'flow-1',
              nodeId: 'step-1',
              memoryType: 'procedural',
              title: 'Use CSV exports',
              normalizedInstruction: 'Prefer CSV exports for this step.',
              content: 'Prefer CSV exports for this step.',
              appliesTo: 'node',
              sensitivity: 'normal',
            }]),
      },
    });
    (service as any).playbookFlowClient = { Run: run };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', snapshot, { brief: 'run it' }, snapshot);

    expect((service as any).hitlMemories.listActiveForNodes).toHaveBeenCalledWith('flow-1', ['step-1']);
    const sentContext = run.mock.calls[0][0].input_context.fields;
    expect(sentContext.__playbook_hitl_memory.listValue.values).toHaveLength(1);
    expect(sentContext.__playbook_hitl_memory.listValue.values[0].structValue.fields.id).toEqual({ kind: 'stringValue', stringValue: 'memory-1' });
  });

  it('replaces caller-supplied HITL memory with server-loaded runtime memory', async () => {
    const snapshot = {
      nodes: [{ id: 'step-1', kind: 'step', metadata: {} }],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    };
    const run = jest.fn().mockReturnValue({ on: jest.fn() });
    const { service, agentService } = createExecutionServiceForTests({
      flowService: { findOne: jest.fn().mockResolvedValue(snapshot) },
      builderService: { buildSnapshot: jest.fn().mockReturnValue(snapshot) },
      executionRepository: {
        findById: jest.fn().mockResolvedValue({ executionMode: 'live', stepExecutionModes: {}, seededTaskOutputs: [] }),
      },
      hitlMemoryRepository: {
        listActiveForNodes: jest.fn().mockResolvedValue([]),
      },
    });
    (service as any).playbookFlowClient = { Run: run };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun(
      'exec-1',
      'flow-1',
      'owner-1',
      snapshot,
      { brief: 'run it', __playbook_hitl_memory: [{ id: 'spoofed' }] },
      snapshot,
    );

    const sentContext = run.mock.calls[0][0].input_context.fields;
    expect(sentContext.__playbook_hitl_memory.listValue.values).toEqual([]);
  });

  it('injects active HITL memory into replay checkpoint input context', async () => {
    const call = new EventEmitter();
    const runFromCheckpoint = jest.fn().mockReturnValue(call);
    const snapshot = {
      nodes: [{ id: 'step-1', kind: 'step', label: 'Step 1', metadata: {} }],
      controlEdges: [],
      dataBindings: [],
      settings: { recursionLimit: 25, maxParallelism: 5 },
      playbookExecutionSettings: {
        maxConcurrentPerUser: 7,
        executionQueueMaxDepth: 0,
        maxParallelismPerExecution: 6,
        effectiveExecutionParallelism: 5,
        recursionLimitDefault: 30,
        recursionLimitMax: 60,
        maxHitlRounds: 0,
        pythonWorkerPoolSize: 3,
        pythonWorkerMaxInflight: 2,
        maxToolIterations: 25,
        maxSandboxCallsPerStep: 16,
        graphCacheEnabled: false,
        graphCacheMaxEntries: 64,
        graphCacheTtlSeconds: 120,
      },
    };
    const { service, agentService } = createExecutionServiceForTests({
      hitlMemoryRepository: {
        listActiveForNodes: jest.fn().mockResolvedValue([{
              id: 'memory-1',
              nodeId: null,
              memoryType: 'semantic',
              title: 'Prefer signed docs',
              normalizedInstruction: 'Use signed documents over drafts.',
              content: 'Use signed documents over drafts.',
              appliesTo: 'workflow',
              sensitivity: 'normal',
            }]),
      },
    });
    (service as any).playbookFlowClient = { RunFromCheckpoint: runFromCheckpoint };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);
    agentService.buildGrpcConnectorRuntimeForPlaybook.mockResolvedValue({
      connectorIds: [],
      connector_bindings: [],
      tools: [],
    });

    await (service as any).callGrpcRunFromCheckpoint(
      'exec-replay',
      'flow-1',
      'owner-1',
      'exec-source',
      snapshot,
      { brief: 'rerun it', __playbook_hitl_memory: [{ id: 'spoofed' }] },
      'step-1',
      0,
    );

    const sentContext = runFromCheckpoint.mock.calls[0][0].input_context.fields;
    const sentRuntimeSettings = runFromCheckpoint.mock.calls[0][0].settings.runtime_settings;
    expect(sentContext.brief).toEqual(expect.any(Object));
    expect(sentContext.__playbook_hitl_memory.listValue.values).toHaveLength(1);
    expect(sentRuntimeSettings).toMatchObject({
      execution_queue_max_depth: 0,
      max_hitl_rounds: 0,
      graph_cache_enabled: false,
      max_tool_iterations: 25,
      max_sandbox_calls_per_step: 16,
    });
  });

  it('preserves Dynamic Reasoning planner state in checkpoint replay requests', async () => {
    const call = new EventEmitter();
    const runFromCheckpoint = jest.fn().mockReturnValue(call);
    const snapshot = {
      nodes: [{ id: 'step-1', kind: 'step', metadata: {}, dynamicReasoning: { enabled: true } }],
      controlEdges: [],
      dataBindings: [],
      settings: { recursionLimit: 25, maxParallelism: 5 },
      playbookExecutionSettings: {
        dynamicReasoningEnabled: true,
        effectiveExecutionParallelism: 3,
        recursionLimitMax: 50,
        dynamicReasoning: {
          plannerAgentId: 'planner-1',
          maxWorkNodes: 6,
          maxParallelism: 3,
          maxDepth: 1,
          maxRepairAttempts: 1,
        },
      },
      playbookPlanner: {
        agentId: 'planner-1',
        agentTypeSlug: 'general_assistant',
        model: 'azure/fallback-model',
        systemPrompt: 'Plan safely',
        temperature: 0.2,
        omitTemperature: true,
        promptHash: 'sha256:test',
        agentRevision: 'revision-1',
      },
    };
    const { service, agentService } = createExecutionServiceForTests();
    (service as any).playbookFlowClient = { RunFromCheckpoint: runFromCheckpoint };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRunFromCheckpoint(
      'exec-replay', 'flow-1', 'owner-1', 'exec-source', snapshot, {}, 'step-1', 0,
    );

    const request = runFromCheckpoint.mock.calls[0][0];
    expect(request.snapshot.nodes[0].dynamic_reasoning).toEqual({ enabled: true });
    expect(request.settings.dynamic_reasoning_policy).toEqual({
      max_work_nodes: 6,
      max_parallelism: 3,
      max_depth: 1,
      max_repair_attempts: 1,
    });
    expect(request.settings.playbook_planner).toMatchObject({
      model: 'azure/fallback-model',
      agent_type_slug: 'general_assistant',
      omit_temperature: true,
    });
  });

  it('adds task-scoped connector runtime metadata to replay checkpoints', async () => {
    const call = new EventEmitter();
    const runFromCheckpoint = jest.fn().mockReturnValue(call);
    const snapshot = {
      nodes: [{
        id: 'step-1',
        kind: 'step',
        label: 'Step 1',
        metadata: {
          assignedAgentId: 'agent-1',
          toolBindings: [{
            id: 'tb-1',
            connectorId: 'conn-2',
            actions: [{ actionKey: 'issues', isEnabled: true }],
          }],
        },
      }],
      controlEdges: [],
      dataBindings: [],
      settings: { recursionLimit: 25, maxParallelism: 5 },
    };
    const { service, agentService } = createExecutionServiceForTests();
    (service as any).playbookFlowClient = { RunFromCheckpoint: runFromCheckpoint };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([{
      id: 'agent-1',
      name: 'Agent 1',
      description: 'desc',
      prompt: 'prompt',
      agent_type: 'specialist',
      tools: [{ name: 'calculator', description: 'Math helper' }],
      agent_params: { params: { user_id: 'owner-1', session_id: 'exec-replay', connector_bindings_json: '[]' } },
      connector_bindings: [],
      connectorIds: [],
      brain_context: [],
      chatbot: { model: 'gpt-4o-mini' },
    }]);
    agentService.buildGrpcConnectorRuntimeForPlaybook.mockResolvedValue({
      connectorIds: ['conn-2'],
      connector_bindings: [{ connector_id: 'conn-2', connector_name: 'GitHub', actions: [{ action_key: 'issues', description: 'List issues' }] }],
      tools: [{ name: 'github_issues', description: 'GitHub connector action issues' }],
      skills: [{ id: 'skill-2', name: 'Connector skill', description: 'Added via connector' }],
    });

    await (service as any).callGrpcRunFromCheckpoint(
      'exec-replay',
      'flow-1',
      'owner-1',
      'exec-source',
      snapshot,
      {},
      'step-1',
      0,
    );

    expect(agentService.buildGrpcConnectorRuntimeForPlaybook).toHaveBeenCalledWith('owner-1', [expect.objectContaining({ connectorId: 'conn-2' })]);
    const nodeMetadata = runFromCheckpoint.mock.calls[0][0].snapshot.nodes[0].metadata;
    expect(nodeMetadata.fields).toEqual(expect.objectContaining({
      assignedAgentId: { kind: 'stringValue', stringValue: 'agent-1' },
      toolBindings: structFields({
        toolBindings: [{
          id: 'tb-1',
          connectorId: 'conn-2',
          actions: [{ actionKey: 'issues', isEnabled: true }],
        }],
      }).toolBindings,
      agent_tools: structFields({
        agent_tools: [
          { name: 'calculator', description: 'Math helper' },
          { name: 'github_issues', description: 'GitHub connector action issues' },
        ],
      }).agent_tools,
      agent_params: structFields({
        agent_params: {
          user_id: 'owner-1',
          session_id: 'exec-replay',
          connector_bindings_json: JSON.stringify([
            { connector_id: 'conn-2', connector_name: 'GitHub', actions: [{ action_key: 'issues', description: 'List issues' }] },
          ]),
        },
      }).agent_params,
      connector_bindings: structFields({
        connector_bindings: [
          { connector_id: 'conn-2', connector_name: 'GitHub', actions: [{ action_key: 'issues', description: 'List issues' }] },
        ],
      }).connector_bindings,
      connector_ids: structFields({ connector_ids: ['conn-2'] }).connector_ids,
      skills: structFields({
        skills: [
          { id: 'skill-2', name: 'Connector skill', description: 'Added via connector' },
        ],
      }).skills,
    }));
  });

  it('adds task-scoped skill runtime metadata to replay checkpoints', async () => {
    const call = new EventEmitter();
    const runFromCheckpoint = jest.fn().mockReturnValue(call);
    const snapshot = {
      nodes: [{
        id: 'step-1',
        kind: 'step',
        label: 'Step 1',
        metadata: {
          assignedAgentId: 'agent-1',
          skillBindings: [{
            id: 'sb-1',
            skillId: 'skill-2',
            skillName: 'Dropped skill',
            isEnabled: true,
          }],
        },
      }],
      controlEdges: [],
      dataBindings: [],
      settings: { recursionLimit: 25, maxParallelism: 5 },
    };
    const { service, agentService } = createExecutionServiceForTests();
    (service as any).playbookFlowClient = { RunFromCheckpoint: runFromCheckpoint };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([{
      id: 'agent-1',
      name: 'Agent 1',
      description: 'desc',
      prompt: 'prompt',
      agent_type: 'specialist',
      tools: [{ name: 'calculator', description: 'Math helper' }],
      skills: [{ id: 'skill-1', name: 'Existing skill', description: 'Already on agent' }],
      agent_params: { params: { user_id: 'owner-1', session_id: 'exec-replay', connector_bindings_json: '[]' } },
      connector_bindings: [],
      connectorIds: [],
      brain_context: [],
      chatbot: { model: 'gpt-4o-mini' },
    }]);
    agentService.buildGrpcConnectorRuntimeForPlaybook.mockResolvedValue({ connectorIds: [], connector_bindings: [], tools: [], skills: [] });
    agentService.buildGrpcSkillsForPlaybook.mockResolvedValue([
      { id: 'skill-2', name: 'Dropped skill', description: 'Added at runtime' },
    ]);

    await (service as any).callGrpcRunFromCheckpoint(
      'exec-replay',
      'flow-1',
      'owner-1',
      'exec-source',
      snapshot,
      {},
      'step-1',
      0,
    );

    expect(agentService.buildGrpcSkillsForPlaybook).toHaveBeenCalledWith(['skill-2']);
    const nodeMetadata = runFromCheckpoint.mock.calls[0][0].snapshot.nodes[0].metadata;
    expect(nodeMetadata.fields).toEqual(expect.objectContaining({
      skillBindings: structFields({
        skillBindings: [{
          id: 'sb-1',
          skillId: 'skill-2',
          skillName: 'Dropped skill',
          isEnabled: true,
        }],
      }).skillBindings,
      skills: structFields({
        skills: [
          { id: 'skill-1', name: 'Existing skill', description: 'Already on agent' },
          { id: 'skill-2', name: 'Dropped skill', description: 'Added at runtime' },
        ],
      }).skills,
    }));
  });

  it('does not start gRPC when a claimed execution is cancelled before launch', async () => {
    const { service, agentService, executionRepository, streamEvents } = createExecutionServiceForTests({
      flowService: { findOne: jest.fn().mockResolvedValue({ settings: {}, nodes: [], controlEdges: [], dataBindings: [] }) },
      builderService: { buildSnapshot: jest.fn().mockReturnValue({ settings: {}, nodes: [], controlEdges: [], dataBindings: [] }) },
      executionRepository: {
        markStarted: jest.fn().mockResolvedValue(false),
        findById: jest.fn().mockResolvedValue({ ownerId: 'owner-1', status: 'cancelled' }),
      },
    });
    const mockRun = jest.fn();
    (service as any).playbookFlowClient = { Run: mockRun };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', {
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    }, {});

    // markStarted only stamps a run that is still running (queue position 0, start time, replay planning).
    expect(executionRepository.markStarted).toHaveBeenCalledWith('exec-1', {});
    expect(mockRun).not.toHaveBeenCalled();
    expect(streamEvents.emitExecutionStart).not.toHaveBeenCalled();
  });

  it('includes step execution modes in the execution start SSE payload', async () => {
    const { service, streamEvents, agentService } = createExecutionServiceForTests({
      flowService: {
        findOne: jest.fn().mockResolvedValue({
          settings: {},
          nodes: [{ id: 'step-1', kind: 'step', metadata: { assignedAgentId: 'agent-1' } }],
          controlEdges: [],
          dataBindings: [],
        }),
      },
      builderService: {
        buildSnapshot: jest.fn().mockReturnValue({
          settings: {},
          nodes: [{ id: 'step-1', kind: 'step', metadata: { assignedAgentId: 'agent-1' } }],
          controlEdges: [],
          dataBindings: [],
        }),
      },
      executionRepository: {
        findById: jest.fn()
          .mockResolvedValueOnce({
            singleStepTaskId: null,
            executionMode: 'inherit',
            stepExecutionModes: { 'step-1': 'replay_flex' },
            modelIdOverride: null,
            replayPlanningByTask: null,
          })
          .mockResolvedValueOnce({
            singleStepTaskId: null,
            advisorAutopilotEnabled: false,
            advisorAutopilotTargetScore: 90,
            advisorAutopilotMaxTurns: 4,
            reflectionEnabled: false,
            advisorScoringMode: 'llm',
            executionMode: 'inherit',
            stepExecutionModes: { 'step-1': 'replay_flex' },
            replayPlanningByTask: null,
            seededTaskOutputs: [],
          }),
      },
    });
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([{ id: 'agent-1', name: 'Agent 1' }]);
    (service as any).playbookFlowClient = { Run: jest.fn(() => ({ on: jest.fn() })) };

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', {
      settings: {},
      nodes: [{ id: 'step-1', kind: 'step', metadata: { assignedAgentId: 'agent-1' } }],
      controlEdges: [],
      dataBindings: [],
    }, {});

    expect(streamEvents.emitExecutionStart).toHaveBeenCalledWith(
      'exec-1',
      'flow-1',
      'owner-1',
      expect.objectContaining({
        executionMode: 'inherit',
        stepExecutionModes: { 'step-1': 'replay_flex' },
        advisorAutopilotTargetScore: 90,
        advisorAutopilotMaxTurns: 4,
        singleStepTaskId: null,
      }),
    );
  });

  it('does not fail running executions during startup without ownership proof', async () => {
    const { service, executionRepository } = createExecutionServiceForTests();
    (service as any).isGrpcAvailable = true;

    await (service as any).reconcileOrphanedExecutions();

    expect(executionRepository.markFailed).not.toHaveBeenCalled();
    expect(executionRepository.transition).not.toHaveBeenCalled();
    expect(executionRepository.update).not.toHaveBeenCalled();
  });

  it('recovers queued executions until all available concurrency slots are filled', async () => {
    const executionRepository = {
      distinctOwnersWithQueued: jest.fn().mockResolvedValue(['owner-1']),
    };
    const queueService = {
      release: jest.fn()
        .mockResolvedValueOnce({ id: 'exec-1', flowId: 'flow-1', inputContext: {} })
        .mockResolvedValueOnce({ id: 'exec-2', flowId: 'flow-1', inputContext: {} })
        .mockResolvedValueOnce({ id: 'exec-3', flowId: 'flow-1', inputContext: {} })
        .mockResolvedValueOnce(null),
      refreshPositions: jest.fn().mockResolvedValue([]),
      getRunningCount: jest.fn().mockResolvedValue(0),
    };
    const flowService = {
      findOne: jest.fn().mockResolvedValue({ settings: {} }),
    };
    const { service } = createExecutionServiceForTests({ executionRepository, queueService, flowService });
    (service as any).isGrpcAvailable = true;

    const scheduleQueueDrainSpy = jest.spyOn(service as any, 'scheduleQueueDrain').mockImplementation(() => undefined);

    await (service as any).recoverQueuedExecutions();

    expect(executionRepository.distinctOwnersWithQueued).toHaveBeenCalled();
    expect(scheduleQueueDrainSpy).toHaveBeenCalledWith('owner-1');
    scheduleQueueDrainSpy.mockRestore();
  });

  it('drainQueue continues draining after a flow-not-found failure', async () => {
    const executionRepository = {
      findById: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }),
    };
    const queueService = {
      release: jest.fn()
        .mockResolvedValueOnce({ id: 'exec-missing', flowId: 'flow-missing', inputContext: {} })
        .mockResolvedValueOnce({ id: 'exec-ok', flowId: 'flow-ok', inputContext: {} })
        .mockResolvedValueOnce(null),
      refreshPositions: jest.fn().mockResolvedValue([]),
    };
    const flowService = {
      findOne: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ settings: {} }),
    };
    const { service, streamEvents, executionRepository: repository } = createExecutionServiceForTests({ executionRepository, queueService, flowService });
    (service as any).isGrpcAvailable = true;

    const callGrpcRunSpy = jest.spyOn(service as any, 'callGrpcRun').mockResolvedValue(undefined);

    await (service as any).drainQueue('owner-1');

    expect(repository.markFailed).toHaveBeenCalledWith('exec-missing', 'Flow not found before runtime start');
    expect(repository.markFailed).toHaveBeenCalledTimes(1);
    expect(flowService.findOne).toHaveBeenCalledTimes(2);
    expect(callGrpcRunSpy).toHaveBeenCalledTimes(1);
    expect(callGrpcRunSpy).toHaveBeenCalledWith('exec-ok', 'flow-ok', 'owner-1', { settings: {} }, {}, undefined);
    callGrpcRunSpy.mockRestore();
  });

  it('re-queues a claimed execution when distributed capacity is exhausted', async () => {
    const executionRepository = {
      findById: jest.fn(),
    };
    const queueService = {
      release: jest.fn().mockResolvedValueOnce({ id: 'exec-1', flowId: 'flow-1', inputContext: {} }).mockResolvedValueOnce(null),
      refreshPositions: jest.fn().mockResolvedValue([{ executionId: 'exec-1', queuePosition: 1 }]),
    };
    const { service, streamEvents, executionLeaseService, executionRepository: repository } = createExecutionServiceForTests({
      executionRepository,
      queueService,
      executionLeaseService: {
        isEnabled: jest.fn().mockReturnValue(true),
        acquire: jest.fn().mockResolvedValue({ acquired: false, reason: 'global_limit' }),
        release: jest.fn().mockResolvedValue(undefined),
      },
    });
    (service as any).isGrpcAvailable = true;

    await (service as any).drainQueue('owner-1');

    expect(executionLeaseService.acquire).toHaveBeenCalledWith('exec-1', 'owner-1', 'flow-1', {});
    // Back to the head of the queue (queued, position 0, start time cleared) while it is still running.
    expect(repository.requeueRunning).toHaveBeenCalledWith('exec-1');
    expect(repository.findById).not.toHaveBeenCalled();
    expect(streamEvents.emitQueuePositionUpdate).toHaveBeenCalledWith('exec-1', 1);
  });
});

describe('PlaybookFlowExecutionService HITL memory persistence', () => {
  function createPendingStepExecution(overrides: Record<string, unknown> = {}) {
    return {
      id: 'exec-1',
      ownerId: 'owner-1',
      flowId: 'flow-1',
      status: 'pending_approval',
      pendingApproval: {
        nodeId: 'task-1',
        iteration: 0,
        prompt: 'Which contract?',
        interruptId: 'interrupt-1',
        interruptType: 'clarification',
        taskTitle: 'Review contract',
        feedbackScopeDefault: 'downstream_run',
      },
      hitlEvents: [],
      ...overrides,
    };
  }

  it('creates active node memory when future node feedback is explicitly remembered', async () => {
    const execution = createPendingStepExecution();
    const hitlMemoryRepository = { create: jest.fn().mockResolvedValue({}) };
    const streamEvents = { emitHitlInterruptResolved: jest.fn(), emitHitlMemorySaved: jest.fn() };
    const executionRepository = {
      findById: jest.fn().mockResolvedValue(execution),
    };
    const runtimeClient = {
      isAvailable: jest.fn().mockReturnValue(true),
      resumeFromStep: jest.fn((_request, callback) => callback(null, { resumed: true })),
    };
    const { service, executionRepository: repository } = createExecutionServiceForTests({
      executionRepository,
      runtimeClient,
      streamEvents,
      hitlMemoryRepository,
    });

    await service.resumeFromStep('exec-1', 'owner-1', {
      taskId: 'task-1',
      action: 'reply',
      message: 'Use the signed contract.',
      scope: 'future_node_runs',
      remember: true,
    });

    expect(repository.answerHitlEvent).toHaveBeenCalledWith('exec-1', expect.objectContaining({
      from: ['pending_approval'],
      interruptId: 'interrupt-1',
      patch: { status: 'running', pendingApproval: null },
    }));
    expect(hitlMemoryRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'owner-1',
      flowId: 'flow-1',
      nodeId: 'task-1',
      memoryType: 'procedural',
      source: 'hitl_feedback',
      title: 'HITL guidance for Review contract',
      content: 'Use the signed contract.',
      normalizedInstruction: 'Use the signed contract.',
      appliesTo: 'node',
      status: 'active',
      sensitivity: 'normal',
      createdFromExecutionId: 'exec-1',
      createdFromInterruptId: 'interrupt-1',
    }));
    expect(streamEvents.emitHitlMemorySaved).toHaveBeenCalledWith('exec-1', {
      taskId: 'task-1',
      scope: 'future_node_runs',
      interruptId: 'interrupt-1',
    });
  });

  it('does not create memory for current-run or unremembered feedback scopes', async () => {
    const hitlMemoryRepository = { create: jest.fn().mockResolvedValue({}) };
    const executionRepository = {
      findById: jest.fn()
        .mockResolvedValueOnce(createPendingStepExecution())
        .mockResolvedValueOnce(createPendingStepExecution()),
    };
    const runtimeClient = {
      isAvailable: jest.fn().mockReturnValue(true),
      resumeFromStep: jest.fn((_request, callback) => callback(null, { resumed: true })),
    };
    const { service } = createExecutionServiceForTests({ executionRepository, runtimeClient, hitlMemoryRepository });

    await service.resumeFromStep('exec-1', 'owner-1', {
      taskId: 'task-1',
      action: 'reply',
      message: 'Use the signed contract.',
      scope: 'downstream_run',
      remember: true,
    });
    await service.resumeFromStep('exec-1', 'owner-1', {
      taskId: 'task-1',
      action: 'reply',
      message: 'Use the signed contract.',
      scope: 'future_workflow_runs',
      remember: false,
    });

    expect(hitlMemoryRepository.create).not.toHaveBeenCalled();
  });

  it('restarts the stream with a hidden resume command when runtime state was lost', async () => {
    const snapshot = { settings: {}, nodes: [{ id: 'task-1', kind: 'step', metadata: {} }], controlEdges: [], dataBindings: [] };
    const execution = createPendingStepExecution({
      snapshot,
      inputContext: { customer: 'acme' },
    });
    const executionRepository = {
      findById: jest.fn().mockResolvedValue(execution),
    };
    const runtimeClient = {
      isAvailable: jest.fn().mockReturnValue(true),
      resumeFromStep: jest.fn((_request, callback) => callback(null, { resumed: false })),
    };
    const { service, streamEvents, executionRepository: repository } = createExecutionServiceForTests({ executionRepository, runtimeClient });
    const scheduleDurableResume = jest
      .spyOn(service as any, 'scheduleQueueDrain')
      .mockImplementation(() => undefined);

    await service.resumeFromStep('exec-1', 'owner-1', {
      taskId: 'task-1',
      interruptId: 'interrupt-1',
      action: 'reply',
      message: 'Use the signed contract.',
      scope: 'downstream_run',
    });

    expect(scheduleDurableResume).toHaveBeenCalledWith('owner-1');
    expect(repository.answerHitlEvent).toHaveBeenCalledWith('exec-1', expect.objectContaining({
      from: ['running', 'pending_approval'],
      interruptId: 'interrupt-1',
      patch: expect.objectContaining({
        status: 'queued',
        queuePosition: 0,
        pendingApproval: null,
        inputContext: expect.objectContaining({
          customer: 'acme',
          __playbook_resume: expect.objectContaining({
            action: 'reply',
            message: 'Use the signed contract.',
            scope: 'downstream_run',
          }),
        }),
      }),
    }));
    expect(streamEvents.emitHitlInterruptResolved).toHaveBeenCalledWith(
      'exec-1',
      'interrupt-1',
      expect.objectContaining({ action: 'reply', taskId: 'task-1' }),
    );
  });

  it('restarts an approval with a hidden resume command when runtime state was lost', async () => {
    const snapshot = { settings: {}, nodes: [{ id: 'task-1', kind: 'step', metadata: {} }], controlEdges: [], dataBindings: [] };
    const execution = createPendingStepExecution({
      snapshot,
      inputContext: { recipient: 'customer@example.com' },
      pendingApproval: {
        nodeId: 'task-1',
        iteration: 0,
        prompt: 'Approve external send?',
        interruptId: 'approval-1',
        interruptType: 'approval_request',
        taskTitle: 'Send customer email',
        riskLevel: 'critical',
      },
    });
    const executionRepository = {
      findById: jest.fn().mockResolvedValue(execution),
    };
    const runtimeClient = {
      isAvailable: jest.fn().mockReturnValue(true),
      resumeApproval: jest.fn((_request, callback) => callback(null, { resumed: false })),
    };
    const { service, streamEvents, executionRepository: repository } = createExecutionServiceForTests({ executionRepository, runtimeClient });
    const scheduleDurableResume = jest
      .spyOn(service as any, 'scheduleQueueDrain')
      .mockImplementation(() => undefined);

    await service.resumeApproval('exec-1', 'owner-1', {
      decision: 'approved',
      payload: {
        feedback: 'Approved for this signed contract only.',
        scope: 'step_only',
        remember: false,
      },
    });

    expect(scheduleDurableResume).toHaveBeenCalledWith('owner-1');
    expect(repository.findById).toHaveBeenCalledWith('exec-1', { withSnapshot: true });
    expect(repository.transition).toHaveBeenCalledWith('exec-1', {
      from: ['pending_approval'],
      pendingApproval: { nodeId: 'task-1', iteration: 0, interruptId: 'approval-1' },
      patch: { status: 'running' },
    });
    expect(repository.answerHitlEvent).toHaveBeenCalledWith('exec-1', expect.objectContaining({
      from: ['running', 'pending_approval'],
      interruptId: 'approval-1',
      patch: expect.objectContaining({
        status: 'queued',
        inputContext: expect.objectContaining({
          recipient: 'customer@example.com',
          __playbook_resume: expect.objectContaining({
            decision: 'approved',
            payload: expect.objectContaining({
              feedback: 'Approved for this signed contract only.',
              scope: 'step_only',
            }),
          }),
        }),
      }),
    }));
    expect(streamEvents.emitHitlInterruptResolved).toHaveBeenCalledWith(
      'exec-1',
      'approval-1',
      expect.objectContaining({ action: 'approved', taskId: 'task-1' }),
    );
  });

  it('creates sensitive workflow memory for remembered approval responses', async () => {
    const execution = createPendingStepExecution({
      pendingApproval: {
        nodeId: 'task-1',
        iteration: 0,
        prompt: 'Approve external send?',
        interruptId: 'approval-1',
        interruptType: 'approval_request',
        taskTitle: 'Send customer email',
        riskLevel: 'critical',
      },
    });
    const hitlMemoryRepository = { create: jest.fn().mockResolvedValue({}) };
    const streamEvents = { emitHitlInterruptResolved: jest.fn(), emitHitlMemorySaved: jest.fn() };
    const executionRepository = {
      findById: jest.fn().mockResolvedValue(execution),
    };
    const runtimeClient = {
      isAvailable: jest.fn().mockReturnValue(true),
      resumeApproval: jest.fn((_request, callback) => callback(null, { resumed: true })),
    };
    const { service } = createExecutionServiceForTests({
      executionRepository,
      runtimeClient,
      streamEvents,
      hitlMemoryRepository,
    });

    await service.resumeApproval('exec-1', 'owner-1', {
      decision: 'approved',
      payload: {
        feedback: 'Approved only for signed contracts.',
        scope: 'future_workflow_runs',
        remember: true,
      },
    });

    expect(hitlMemoryRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      flowId: 'flow-1',
      nodeId: null,
      memoryType: 'approval_policy',
      content: 'Approved only for signed contracts.',
      appliesTo: 'workflow',
      sensitivity: 'sensitive',
      createdFromExecutionId: 'exec-1',
      createdFromInterruptId: 'approval-1',
    }));
    expect(streamEvents.emitHitlInterruptResolved).toHaveBeenCalledWith('exec-1', 'approval-1', {
      action: 'approved',
      taskId: 'task-1',
      scope: 'future_workflow_runs',
      remember: true,
    });
  });
});

describe('PlaybookFlowExecutionService lease release', () => {
  it('releases the distributed lease when an execution completes', async () => {
    const { service, executionLeaseService } = createExecutionServiceForTests({
      executionLeaseService: {
        isEnabled: jest.fn().mockReturnValue(true),
        release: jest.fn().mockResolvedValue(undefined),
      },
    });

    await (service as any).handleRunEvent('exec-1', { event_type: 'ExecutionCompleted', payload: {} });

    expect(executionLeaseService.release).toHaveBeenCalledWith('exec-1');
  });
});

describe('PlaybookFlowExecutionService reads', () => {
  const at = (iso: string) => new Date(iso);

  it('lists a flow\'s runs newest first as their toJSON shape, one page at a time', async () => {
    const executionRepository = {
      countByFlow: jest.fn().mockResolvedValue(12),
      listByFlow: jest.fn().mockResolvedValue([{
        id: 'exec-2', flowId: 'flow-1', ownerId: 'owner-1', status: 'completed', startedAt: at('2026-01-01T00:00:00Z'), endedAt: null,
        error: null, pendingApproval: null, hitlEvents: [], queuePosition: 0, createdAt: at('2026-01-01T00:00:00Z'),
      }]),
    };
    const { service, executionRepository: repository } = createExecutionServiceForTests({ executionRepository });

    const result = await service.findAll('flow-1', 'owner-1', 2, 5);

    expect(repository.countByFlow).toHaveBeenCalledWith('flow-1');
    expect(repository.listByFlow).toHaveBeenCalledWith('flow-1', { limit: 5, offset: 5 });
    expect(result.pagination).toEqual({ page: 2, limit: 5, total: 12, totalPages: 3 });
    expect(result.items).toEqual([{
      id: 'exec-2', flowId: 'flow-1', ownerId: 'owner-1', status: 'completed', startedAt: at('2026-01-01T00:00:00Z'),
      pendingApproval: null, hitlEvents: [], queuePosition: 0, createdAt: at('2026-01-01T00:00:00Z'),
    }]);
  });

  it('returns the start response with the admitted queue position and no planner snapshot', async () => {
    const queueService = { admit: jest.fn().mockResolvedValue(3), release: jest.fn(), refreshPositions: jest.fn().mockResolvedValue([]) };
    const { service, executionRepository } = createExecutionServiceForTests({ queueService });
    jest.spyOn(service as any, 'scheduleQueueDrain').mockImplementation(() => undefined);

    const result = await service.start('flow-1', 'owner-1', { brief: 'x' });

    const inserted = executionRepository.insert.mock.calls[0][0];
    expect(inserted).toMatchObject({ flowId: 'flow-1', ownerId: 'owner-1', status: 'queued', executionMode: 'live', advisorScoringMode: 'llm', seededTaskOutputs: [] });
    expect(queueService.admit).toHaveBeenCalledWith('owner-1', 'exec-new', expect.any(Number), expect.any(Number));
    expect(result).toMatchObject({ id: 'exec-new', status: 'queued', queuePosition: 3, pendingApproval: null });
    expect(result).not.toHaveProperty('playbookPlannerSnapshot');
  });

  it('assembles the execution detail from the three repositories', async () => {
    const execution = {
      id: 'exec-1', flowId: 'flow-1', ownerId: 'owner-1', status: 'completed', pendingApproval: null, error: null,
      snapshot: { nodes: [], playbookPlanner: { model: 'secret' } },
      hitlEvents: [
        { id: 'h1', nodeId: 'task-1', iteration: 0, interruptId: 'i1', status: 'answered' },
        { id: 'h2', nodeId: 'task-2', iteration: 0, interruptId: 'i2', status: 'answered' },
      ],
      replayPlanningByTask: {},
    };
    const taskResult = {
      id: 'tr-1', executionId: 'exec-1', taskId: 'task-1', iteration: 0, status: 'completed', output: 'done', displayText: null,
      outputs: null, artifacts: null, components: null, iteratorIterations: null, error: null, startedAt: at('2026-01-01T00:00:00Z'), endedAt: null,
      toolTrace: [], reasoningChain: [], llmPromptTrace: [], usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, model: 'm' }, semanticMatch: null,
      traceMetadata: {}, judgeStatus: 'idle', judgeResult: null, judgeScoringMode: null, judgeError: null, judgeHistory: [],
      parentTaskId: null, runtimeSubgraphId: null, generatedLocalNodeId: null, generatedNodeTitle: null,
    };
    const decision = { id: 'rd-1', executionId: 'exec-1', routerNodeId: 'router-1', iteration: 0, label: 'yes', decidedAt: at('2026-01-01T00:00:01Z') };
    const { service, executionRepository, taskResultRepository, routerDecisionRepository } = createExecutionServiceForTests({
      executionRepository: { findById: jest.fn().mockResolvedValue(execution) },
      taskResultRepository: { listForExecution: jest.fn().mockResolvedValue([taskResult]) },
      routerDecisionRepository: { listForExecution: jest.fn().mockResolvedValue([decision]) },
    });

    const detail = await service.findOne('exec-1', 'owner-1');

    expect(executionRepository.findById).toHaveBeenCalledWith('exec-1', { withSnapshot: true });
    expect(taskResultRepository.listForExecution).toHaveBeenCalledWith('exec-1');
    expect(routerDecisionRepository.listForExecution).toHaveBeenCalledWith('exec-1');
    expect((detail as unknown as Record<string, unknown>).snapshot).toEqual({ nodes: [] });
    expect(detail.error).toBeUndefined();
    expect(detail.taskResults).toEqual([expect.objectContaining({
      id: 'tr-1', taskId: 'task-1', status: 'completed', output: 'done', displayText: undefined, error: undefined,
      startedAt: at('2026-01-01T00:00:00Z'), endedAt: undefined, inputTokens: 1, totalTokens: 3, judgeStatus: 'idle', judgeHistory: [],
      parentTaskId: undefined, generatedNodeTitle: undefined,
      hitlHistory: [expect.objectContaining({ id: 'h1' })],
    })]);
    expect(detail.routerDecisions).toEqual([decision]);
    expect(detail.dynamicReasoningAttempts).toEqual([]);
  });

  it('lists recent runs of accessible flows with their most relevant task, failed ones first', async () => {
    const executionRepository = {
      listRecentByFlows: jest.fn().mockResolvedValue([
        { id: 'exec-1', flowId: 'flow-1', status: 'running', startedAt: null, updatedAt: at('2026-01-02T00:00:00Z'), endedAt: null, pendingApproval: null },
        { id: 'exec-2', flowId: 'flow-2', status: 'pending_approval', startedAt: at('2026-01-01T00:00:00Z'), updatedAt: at('2026-01-01T00:00:00Z'), endedAt: null, pendingApproval: { nodeId: 'n' } },
      ]),
    };
    const taskResultRepository = {
      listForExecutions: jest.fn().mockResolvedValue([
        { executionId: 'exec-1', taskId: 'running-task', iteration: 0, status: 'running', generatedNodeTitle: null },
        { executionId: 'exec-1', taskId: 'failed-task', iteration: 0, status: 'failed', generatedNodeTitle: 'Failed step' },
      ]),
    };
    const { service, executionRepository: repository, taskResultRepository: tasks } = createExecutionServiceForTests({ executionRepository, taskResultRepository });

    const rows = await service.findRecentByAccessibleFlowIds(['flow-1', 'flow-2'], ['running', 'pending_approval'], 10);

    expect(repository.listRecentByFlows).toHaveBeenCalledWith(['flow-1', 'flow-2'], { statuses: ['running', 'pending_approval'], limit: 10 });
    expect(tasks.listForExecutions).toHaveBeenCalledWith(['exec-1', 'exec-2'], { statuses: ['failed', 'running'], order: 'recentlyStarted', light: true });
    expect(rows).toEqual([
      {
        executionId: 'exec-1', flowId: 'flow-1', status: 'running', startedAt: undefined, updatedAt: at('2026-01-02T00:00:00Z'), endedAt: undefined,
        waitingForHumanInput: false, task: { taskId: 'failed-task', iteration: 0, status: 'failed', taskName: 'Failed step' },
      },
      {
        executionId: 'exec-2', flowId: 'flow-2', status: 'pending_approval', startedAt: at('2026-01-01T00:00:00Z'), updatedAt: at('2026-01-01T00:00:00Z'), endedAt: undefined,
        waitingForHumanInput: true,
      },
    ]);
    await expect(service.findRecentByAccessibleFlowIds([], undefined, 10)).resolves.toEqual([]);
  });

  it('re-queues stale running runs that no longer hold a lease at startup', async () => {
    const executionRepository = {
      findStaleRunning: jest.fn().mockResolvedValue([
        { id: 'exec-stale', ownerId: 'owner-1' },
        { id: 'exec-leased', ownerId: 'owner-1' },
      ]),
    };
    const { service, executionRepository: repository, queueService, streamEvents } = createExecutionServiceForTests({
      executionRepository,
      queueService: { release: jest.fn(), refreshPositions: jest.fn().mockResolvedValue([{ executionId: 'exec-stale', queuePosition: 1 }]) },
      executionLeaseService: {
        isEnabled: jest.fn().mockResolvedValue(true),
        hasActiveLease: jest.fn(async (id: string) => id === 'exec-leased'),
      },
    });

    await (service as any).recoverStaleRunningExecutions();

    expect(repository.findStaleRunning).toHaveBeenCalledWith(expect.any(Date));
    expect(repository.requeueRunning).toHaveBeenCalledTimes(1);
    expect(repository.requeueRunning).toHaveBeenCalledWith('exec-stale', { clearError: true });
    expect(queueService.refreshPositions).toHaveBeenCalledWith('owner-1');
    expect(streamEvents.emitQueuePositionUpdate).toHaveBeenCalledWith('exec-stale', 1);
  });
});
