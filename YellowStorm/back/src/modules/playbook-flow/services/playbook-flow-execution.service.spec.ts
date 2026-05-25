import {
  buildGrpcHumanApprovalConfig,
  isTerminalStatus,
  PlaybookFlowExecutionService,
  shouldEmitCompletedAfterUpdate,
  shouldEmitFailureOnStreamError,
  shouldFinalizeStreamAsCompleted,
  toGrpcStruct,
  toGrpcValue,
} from './playbook-flow-execution.service';

import { PlaybookFlowObservabilityService } from './observability/playbook-flow-observability.service';
import { PlaybookFlowPublicReasoningParserService } from './observability/playbook-flow-public-reasoning-parser.service';
import { PlaybookFlowTraceRedactionService } from './observability/playbook-flow-trace-redaction.service';
import { PlaybookFlowOutputContractService } from './playbook-flow-output-contract.service';
import { PlaybookFlowReplayPlanService } from './playbook-flow-replay-plan.service';

function createExecutionServiceForTests(overrides?: {
  executionModel?: Record<string, any>;
  queueService?: Record<string, any>;
  flowService?: Record<string, any>;
  streamEvents?: Record<string, any>;
  configService?: Record<string, any>;
  routerDecisionModel?: Record<string, any>;
  builderService?: Record<string, any>;
  replayArtifactService?: Record<string, any>;
  replayPromptService?: Record<string, any>;
  replayBaselineService?: Record<string, any>;
  replayEligibilityService?: Record<string, any>;
  replayReportService?: Record<string, any>;
  replayDriftService?: Record<string, any>;
  outputFormatService?: Record<string, any>;
}) {
  const executionModel = {
    updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
    findById: jest.fn(() => ({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }) }) })),
    findByIdAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) })),
    ...overrides?.executionModel,
  };
  const taskResultModel = {
    updateOne: jest.fn(),
    deleteMany: jest.fn(),
    findOne: jest.fn(() => ({ sort: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(null) })),
  };
  const routerDecisionModel = {
    create: jest.fn(),
    deleteMany: jest.fn(),
    ...overrides?.routerDecisionModel,
  };
  const configService = {
    get: jest.fn((key: string, fallback: unknown) => fallback),
    ...overrides?.configService,
  };
  const queueService = {
    release: jest.fn(),
    refreshPositions: jest.fn().mockResolvedValue([]),
    ...overrides?.queueService,
  };
  const idempotencyService = {
    reserve: jest.fn(),
    confirmLink: jest.fn(),
    release: jest.fn(),
  };
  const flowService = {
    findOne: jest.fn().mockResolvedValue({ nodes: [], controlEdges: [], dataBindings: [], settings: {} }),
    ...overrides?.flowService,
  };
  const builderService = {
    buildSnapshot: jest.fn().mockReturnValue({ settings: {}, nodes: [], controlEdges: [], dataBindings: [] }),
    ...overrides?.builderService,
  };
  const agentService = {
    buildGrpcAgentsForPlaybook: jest.fn(),
  };
  const validatorService = {
    validate: jest.fn(),
  };
  const streamEvents = {
    emitExecutionComplete: jest.fn(),
    emitExecutionStart: jest.fn(),
    emitRouterDecision: jest.fn(),
    emitQueuePositionUpdate: jest.fn(),
    emitStepComplete: jest.fn(),
    emitStepStart: jest.fn(),
    emitStepUpdate: jest.fn(),
    emitInterrupt: jest.fn(),
    ...overrides?.streamEvents,
  };
  const observabilityService = new PlaybookFlowObservabilityService(
    new PlaybookFlowTraceRedactionService(),
    new PlaybookFlowPublicReasoningParserService(),
  );
  const replayArtifactService = {
    resolveReplayArtifacts: async () => new Map(),
    resolveReplayArtifactByIdentity: jest.fn().mockResolvedValue(null),
    ...overrides?.replayArtifactService,
  };
  const replayPromptService = {
    buildReplayPromptSection: () => '',
    ...overrides?.replayPromptService,
  };
  const replayBaselineService = {
    buildCurrentReplayFingerprints: jest.fn().mockReturnValue({
      inputContextHash: 'input-a',
      flowSnapshotHash: 'flow-a',
      nodeSnapshotHash: 'node-a',
      agentConfigHash: null,
      modelConfigHash: 'model-a',
      toolConfigHash: 'tool-a',
      outputContractHash: 'contract-a',
    }),
    buildReplayIntent: jest.fn(({ taskId, taskTitle, nodeSnapshot }) => {
      const metadata = nodeSnapshot && typeof nodeSnapshot === 'object' && !Array.isArray(nodeSnapshot)
        ? ((nodeSnapshot as Record<string, unknown>).metadata as Record<string, unknown> | undefined)
        : undefined;
      const parts = [
        typeof taskTitle === 'string' ? taskTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') : '',
        typeof metadata?.taskType === 'string' ? metadata.taskType.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') : '',
        typeof metadata?.templateType === 'string' ? metadata.templateType.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') : '',
      ].filter(Boolean);
      return { intentKey: parts.join('-') || taskId, intentLabel: taskTitle || taskId };
    }),
    ...overrides?.replayBaselineService,
  };
  const replayEligibilityService = {
    evaluateReplayEligibility: jest.fn().mockReturnValue({
      applied: true,
      confidenceScore: 100,
      confidenceFactors: {},
      invalidationReasons: [],
      appliedSections: [],
      skippedSections: [],
    }),
    ...overrides?.replayEligibilityService,
  };
  const replayReportService: Record<string, any> = {
    findLatestReportForExecutionTask: jest.fn().mockResolvedValue(null),
    ...overrides?.replayReportService,
  };
  const replayDriftService = {
    createPreRunReport: replayReportService.createPreRunReport ?? jest.fn().mockResolvedValue(undefined),
    recordCompletedTaskDrift: replayReportService.updateStructuralDrift ?? jest.fn().mockResolvedValue(undefined),
    backfillSemanticMatch: replayReportService.updateSemanticMatch ?? jest.fn().mockResolvedValue(undefined),
    ensureIterationReportMaterialized: replayReportService.ensureIterationReportMaterialized ?? jest.fn().mockResolvedValue(undefined),
    ...overrides?.replayDriftService,
  };
  const replayPlanService = new PlaybookFlowReplayPlanService();
  const outputContractService = new PlaybookFlowOutputContractService();
  const outputFormatService = {
    getActiveTemplates: jest.fn().mockResolvedValue(new Map()),
    ...overrides?.outputFormatService,
  };
  replayReportService.createPreRunReport = replayDriftService.createPreRunReport;
  replayReportService.updateStructuralDrift = replayDriftService.recordCompletedTaskDrift;
  replayReportService.updateSemanticMatch = replayDriftService.backfillSemanticMatch;
  replayReportService.ensureIterationReportMaterialized = replayDriftService.ensureIterationReportMaterialized;

  const service = new PlaybookFlowExecutionService(
    executionModel as any,
    taskResultModel as any,
    routerDecisionModel as any,
    configService as any,
    queueService as any,
    idempotencyService as any,
    flowService as any,
    builderService as any,
    validatorService as any,
    agentService as any,
    streamEvents as any,
    observabilityService as any,
    {} as any,
    replayArtifactService as any,
    replayPromptService as any,
    replayBaselineService as any,
    replayEligibilityService as any,
    replayReportService as any,
    outputContractService as any,
    { validateModelActive: jest.fn().mockResolvedValue({ valid: true, model: null, inactive: false }) } as any,
    outputFormatService as any,
    replayPlanService as any,
    replayDriftService as any,
  );

  return {
    service,
    executionModel,
    taskResultModel,
    queueService,
    flowService,
    streamEvents,
    routerDecisionModel,
    idempotencyService,
    builderService,
    agentService,
    replayArtifactService,
    replayPromptService,
    replayBaselineService,
    replayEligibilityService,
    replayReportService,
    replayDriftService,
    replayPlanService,
    outputContractService,
    outputFormatService,
  };
}

describe('buildGrpcHumanApprovalConfig', () => {
  it('omits timeout_seconds when timeout is null so the runtime can apply its default', () => {
    expect(buildGrpcHumanApprovalConfig({ promptTemplate: 'Approve this', timeoutSeconds: null })).toEqual({
      prompt_template: 'Approve this',
    });
  });

  it('omits zero because proto3 cannot distinguish it from an unset int32', () => {
    expect(buildGrpcHumanApprovalConfig({ promptTemplate: 'Approve this', timeoutSeconds: 0 })).toEqual({
      prompt_template: 'Approve this',
    });
  });

  it('preserves explicit positive timeout values', () => {
    expect(buildGrpcHumanApprovalConfig({ promptTemplate: 'Approve this', timeoutSeconds: 900 })).toEqual({
      prompt_template: 'Approve this',
      timeout_seconds: 900,
    });
  });
});

describe('isTerminalStatus', () => {
  it('returns true for completed, failed, cancelled', () => {
    expect(isTerminalStatus('completed')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
  });

  it('returns false for non-terminal statuses', () => {
    expect(isTerminalStatus('queued')).toBe(false);
    expect(isTerminalStatus('running')).toBe(false);
    expect(isTerminalStatus('pending_approval')).toBe(false);
  });
});

describe('gRPC Struct helpers', () => {
  it('wraps nested objects using protobuf Struct/Value shapes', () => {
    expect(
      toGrpcStruct({
        metadata: { fields: { preserved: true } },
        items: [1, 'two'],
      }),
    ).toEqual({
      fields: {
        metadata: {
          kind: 'structValue',
          structValue: {
            fields: {
              fields: {
                kind: 'structValue',
                structValue: {
                  fields: {
                    preserved: { kind: 'boolValue', boolValue: true },
                  },
                },
              },
            },
          },
        },
        items: {
          kind: 'listValue',
          listValue: {
            values: [
              { kind: 'numberValue', numberValue: 1 },
              { kind: 'stringValue', stringValue: 'two' },
            ],
          },
        },
      },
    });
  });

  it('wraps constant values consistently for protobuf.Value fields', () => {
    expect(toGrpcValue({ nested: 'value' })).toEqual({
      kind: 'structValue',
      structValue: {
        fields: {
          nested: {
            kind: 'stringValue',
            stringValue: 'value',
          },
        },
      },
    });
  });
});

describe('callGrpcRun router config serialization', () => {
  it('serializes deterministic router conditions into the gRPC snapshot', async () => {
    const { service, agentService } = createExecutionServiceForTests();
    const runCall = { on: jest.fn() };
    const run = jest.fn().mockReturnValue(runCall);
    (service as any).playbookFlowClient = { Run: run };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', {}, {}, {
      nodes: [{
        id: 'router-1',
        kind: 'router',
        routerConfig: {
          outputLabels: ['valid', 'invalid'],
          maxIterations: 3,
          defaultLabel: 'invalid',
          conditions: [{
            label: 'valid',
            sourceNode: 'step-1',
            sourcePort: 'result',
            path: 'verdict',
            operator: 'equals',
            value: 'valid',
          }],
        },
      }],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: expect.objectContaining({
        nodes: [expect.objectContaining({
          router_config: expect.objectContaining({
            output_labels: ['valid', 'invalid'],
            max_iterations: 3,
            default_label: 'invalid',
            conditions: [expect.objectContaining({
              label: 'valid',
              source_node: 'step-1',
              source_port: 'result',
              path: 'verdict',
              operator: 'equals',
              value: { kind: 'stringValue', stringValue: 'valid' },
            })],
          }),
        })],
      }),
    }));
  });

  it('serializes enriched agent metadata into the gRPC snapshot', async () => {
    const { service, agentService } = createExecutionServiceForTests();
    const runCall = { on: jest.fn() };
    const run = jest.fn().mockReturnValue(runCall);
    (service as any).playbookFlowClient = { Run: run };
    const ownerId = { toString: () => 'owner-1' } as any;
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([
      {
        id: 'agent-1',
        name: 'Research agent',
        description: 'Find and summarize',
        prompt: 'Use tools when needed.',
        agent_type: 'specialist',
        tools: [{ name: 'calculator', description: 'Math helper' }],
        agent_params: {
          params: {
            user_id: 'owner-1',
            session_id: 'exec-1',
            connector_bindings_json: '[{"connector_id":"conn-1"}]',
          },
        },
        connector_bindings: [{
          connector_id: 'conn-1',
          connector_name: 'Drive',
          actions: [{ action_key: 'search', description: 'Search Drive' }],
        }],
        brain_context: [{ workspace_id: 'brain-1', workspace_documents: [] }],
        chatbot: { model: 'gpt-4o-mini' },
      },
    ]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', ownerId, {}, {}, {
      nodes: [{
        id: 'step-1',
        kind: 'step',
        metadata: {
          assignedAgentId: 'agent-1',
          agent_tools: [{ name: 'malicious_tool', description: 'Do not trust' }],
          agent_params: { connector_bindings_json: '[{"connector_id":"evil"}]' },
          connector_bindings: [{ connector_id: 'evil', mcp_server_url: 'http://internal' }],
        },
      }],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      owner_id: 'owner-1',
      snapshot: expect.objectContaining({
        nodes: [expect.objectContaining({
          metadata: toGrpcStruct({
            execution_mode: 'live',
            assignedAgentId: 'agent-1',
            agent_name: 'Research agent',
            agent_description: 'Find and summarize',
            agent_model: 'gpt-4o-mini',
            agent_prompt: 'Use tools when needed.',
            agent_type: 'specialist',
            agent_tools: [{ name: 'calculator', description: 'Math helper' }],
              agent_params: {
                user_id: 'owner-1',
                session_id: 'exec-1',
                connector_bindings_json: '[{"connector_id":"conn-1"}]',
              },
            connector_bindings: [{
              connector_id: 'conn-1',
              connector_name: 'Drive',
              actions: [{ action_key: 'search', description: 'Search Drive' }],
            }],
            brain_context: [{ workspace_id: 'brain-1', workspace_documents: [] }],
          }),
        })],
      }),
    }));
    expect(agentService.buildGrpcAgentsForPlaybook).toHaveBeenCalledWith(
      'owner-1',
      ['agent-1'],
      undefined,
      'exec-1',
    );
  });

  it('skips strict replay when eligibility fails and persists a report', async () => {
    const replayReportService = { createPreRunReport: jest.fn().mockResolvedValue(undefined), updateStructuralDrift: jest.fn().mockResolvedValue(undefined) };
    const replayPromptService = { buildReplayPromptSection: jest.fn().mockReturnValue('SHOULD_NOT_APPLY') };
    const snapshot = {
      nodes: [{ id: 'step-1', kind: 'step', metadata: {} }],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    };
    const { service, agentService } = createExecutionServiceForTests({
      replayArtifactService: {
        resolveReplayArtifacts: async () => new Map([['step-1', {
          taskId: 'step-1',
          replayId: 'replay-1',
          validationVersion: 3,
          mode: 'replay_strict',
          referenceOutput: null,
          outputFormatGuide: null,
          toolCalls: [],
          reasoningChain: [],
          fingerprints: { nodeSnapshotHash: 'node-a' },
          behaviorBaseline: { decisionInvariants: ['Keep structure'], qualityChecks: [], knownFailureModes: [], behaviorSummary: '' },
          toolPolicy: null,
          outputContract: null,
          replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false },
        }]]) },
      executionModel: {
        updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
        findById: jest.fn()
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ executionMode: 'replay_strict', stepExecutionModes: {} }) }) })
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ executionMode: 'replay_strict' }) }) })
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }) })
          .mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }) }),
      },
      replayEligibilityService: {
        evaluateReplayEligibility: jest.fn().mockReturnValue({
          applied: false,
          confidenceScore: 40,
          confidenceFactors: { nodeSnapshotHash: 0 },
          invalidationReasons: ['node_snapshot_mismatch'],
          appliedSections: [],
          skippedSections: ['decision_invariants'],
        }),
      },
      replayPromptService,
      replayReportService,
    });
    const runCall = { on: jest.fn() };
    const run = jest.fn().mockReturnValue(runCall);
    (service as any).playbookFlowClient = { Run: run };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', snapshot, {}, snapshot);

    expect(replayReportService.createPreRunReport).toHaveBeenCalled();
    expect(replayPromptService.buildReplayPromptSection).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: expect.objectContaining({
        nodes: [expect.not.objectContaining({ metadata: expect.objectContaining({ replay_instructions: expect.anything() }) })],
      }),
    }));
  });

  it('applies adaptive replay when eligibility passes with warnings', async () => {
    const replayReportService = { createPreRunReport: jest.fn().mockResolvedValue(undefined), updateStructuralDrift: jest.fn().mockResolvedValue(undefined) };
    const replayPromptService = { buildReplayPromptSection: jest.fn().mockReturnValue('APPLY_REPLAY') };
    const snapshot = {
      nodes: [{ id: 'step-1', kind: 'step', metadata: {} }],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    };
    const { service, agentService } = createExecutionServiceForTests({
      replayArtifactService: {
        resolveReplayArtifacts: async () => new Map([['step-1', {
          taskId: 'step-1',
          replayId: 'replay-1',
          validationVersion: 3,
          mode: 'replay_adaptive',
          referenceOutput: null,
          outputFormatGuide: null,
          toolCalls: [],
          reasoningChain: [],
          fingerprints: { nodeSnapshotHash: 'node-a' },
          behaviorBaseline: { decisionInvariants: ['Keep structure'], qualityChecks: [], knownFailureModes: [], behaviorSummary: '' },
          toolPolicy: null,
          outputContract: null,
          replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false },
        }]]) },
      executionModel: {
        updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
        findById: jest.fn()
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ executionMode: 'replay_adaptive', stepExecutionModes: { 'step-1': 'replay_adaptive' } }) }) })
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ executionMode: 'replay_adaptive' }) }) })
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }) })
          .mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }) }),
      },
      replayEligibilityService: {
        evaluateReplayEligibility: jest.fn().mockReturnValue({
          applied: true,
          confidenceScore: 75,
          confidenceFactors: { nodeSnapshotHash: 0 },
          invalidationReasons: ['node_snapshot_mismatch'],
          appliedSections: ['decision_invariants'],
          skippedSections: [],
        }),
      },
      replayPromptService,
      replayReportService,
    });
    const runCall = { on: jest.fn() };
    const run = jest.fn().mockReturnValue(runCall);
    (service as any).playbookFlowClient = { Run: run };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', snapshot, {}, snapshot);

    expect(replayReportService.createPreRunReport).toHaveBeenCalled();
    expect(replayPromptService.buildReplayPromptSection).toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: expect.objectContaining({
        nodes: [expect.objectContaining({
          metadata: expect.objectContaining({
            fields: expect.objectContaining({
              execution_mode: expect.anything(),
              replay_instructions: expect.anything(),
              replay_planning: expect.anything(),
            }),
          }),
        })],
      }),
    }));
  });

  it('blocks replay flex when required context substitutions are unresolved but still persists replay planning', async () => {
    const replayReportService = { createPreRunReport: jest.fn().mockResolvedValue(undefined), updateStructuralDrift: jest.fn().mockResolvedValue(undefined) };
    const replayPromptService = { buildReplayPromptSection: jest.fn().mockReturnValue('SHOULD_NOT_APPLY') };
    const snapshot = {
      nodes: [{ id: 'step-1', label: 'Analyze NVDA earnings', kind: 'step', metadata: { description: 'Compare Q1 2026 earnings' } }],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    };
    const { service, agentService, streamEvents } = createExecutionServiceForTests({
      replayArtifactService: {
        resolveReplayArtifacts: async () => new Map([['step-1', {
          taskId: 'step-1',
          replayId: 'replay-1',
          validationVersion: 3,
          mode: 'replay_flex',
          referenceOutput: null,
          outputFormatGuide: null,
          intentKey: 'earnings.summary',
          intentLabel: 'Summarize earnings',
          reasoningOutline: [],
          stableReasoningRules: [],
          contextVariableSchema: [
            { key: 'ticker', label: 'Ticker', source: 'input_context', valueType: 'string', required: true, exampleValue: 'AAPL' },
            { key: 'region', label: 'Region', source: 'input_context', valueType: 'string', required: true, exampleValue: 'EMEA' },
          ],
          toolTraceTemplate: [],
          driftPolicy: null,
          toolCalls: [],
          reasoningChain: [],
          fingerprints: { nodeSnapshotHash: 'node-a' },
          behaviorBaseline: { decisionInvariants: ['Keep structure'], qualityChecks: [], knownFailureModes: [], behaviorSummary: '' },
          toolPolicy: null,
          outputContract: null,
          replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false },
          isStale: false,
          staleReasons: [],
        }]]) },
      executionModel: {
        updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
        findById: jest.fn()
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ executionMode: 'replay_flex', stepExecutionModes: { 'step-1': 'replay_flex' } }) }) })
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ executionMode: 'replay_flex' }) }) })
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }) })
          .mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }) }),
      },
      replayEligibilityService: {
        evaluateReplayEligibility: jest.fn().mockReturnValue({
          applied: true,
          confidenceScore: 96,
          confidenceFactors: { nodeSnapshotHash: 1 },
          invalidationReasons: [],
          appliedSections: ['decision_invariants'],
          skippedSections: [],
        }),
      },
      replayPromptService,
      replayReportService,
    });
    const runCall = { on: jest.fn() };
    const run = jest.fn().mockReturnValue(runCall);
    (service as any).playbookFlowClient = { Run: run };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', snapshot, { ticker: 'NVDA' }, snapshot);

    expect(replayReportService.createPreRunReport).toHaveBeenCalledWith(expect.objectContaining({
      eligibility: expect.objectContaining({
        applied: false,
        invalidationReasons: expect.arrayContaining(['required_context_unresolved']),
      }),
    }));
    expect(replayPromptService.buildReplayPromptSection).not.toHaveBeenCalled();
    expect(streamEvents.emitExecutionStart).toHaveBeenCalledWith(
      'exec-1',
      'flow-1',
      'owner-1',
      expect.objectContaining({
        replayPlanningByTask: expect.objectContaining({
          'step-1': expect.objectContaining({
            contextMapping: expect.arrayContaining([
              expect.objectContaining({ variableKey: 'ticker', currentValue: 'NVDA', matched: true }),
              expect.objectContaining({ variableKey: 'region', currentValue: null, matched: false }),
            ]),
          }),
        }),
      }),
    );
  });

  it('uses raw input context for replay eligibility while keeping workspace helpers in the gRPC payload', async () => {
    const replayEligibilityService = {
      evaluateReplayEligibility: jest.fn().mockReturnValue({
        applied: true,
        confidenceScore: 100,
        confidenceFactors: {},
        invalidationReasons: [],
        appliedSections: [],
        skippedSections: [],
      }),
    };
    const replayBaselineService = {
      buildCurrentReplayFingerprints: jest.fn().mockReturnValue({
        inputContextHash: 'input-a',
        flowSnapshotHash: 'flow-a',
        nodeSnapshotHash: 'node-a',
        agentConfigHash: null,
        modelConfigHash: 'model-a',
        toolConfigHash: null,
        outputContractHash: null,
      }),
    };
    const snapshot = {
      nodes: [{ id: 'step-1', kind: 'step', metadata: {} }],
      controlEdges: [],
      dataBindings: [],
      settings: {},
      workspaces: ['workspace-1'],
    };
    const { service, agentService } = createExecutionServiceForTests({
      replayArtifactService: {
        resolveReplayArtifacts: async () => new Map([['step-1', {
          taskId: 'step-1',
          replayId: 'replay-1',
          validationVersion: 3,
          mode: 'replay_strict',
          referenceOutput: null,
          outputFormatGuide: null,
          toolCalls: [],
          reasoningChain: [],
          fingerprints: { nodeSnapshotHash: 'node-a' },
          behaviorBaseline: { decisionInvariants: [], qualityChecks: [], knownFailureModes: [], behaviorSummary: '' },
          toolPolicy: null,
          outputContract: null,
          replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false },
        }]]) },
      replayBaselineService,
      replayEligibilityService,
      executionModel: {
        updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
        findById: jest.fn()
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ executionMode: 'replay_strict', stepExecutionModes: {} }) }) })
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ executionMode: 'replay_strict' }) }) })
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }) })
          .mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }) }),
      },
    });
    const runCall = { on: jest.fn() };
    const run = jest.fn().mockReturnValue(runCall);
    (service as any).playbookFlowClient = { Run: run };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', snapshot, { brief: 'same' }, snapshot);

    expect(replayBaselineService.buildCurrentReplayFingerprints).toHaveBeenCalledWith(expect.objectContaining({
      inputContext: { brief: 'same' },
    }));
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      input_context: toGrpcStruct({
        brief: 'same',
        __playbook_workspace_ids: ['workspace-1'],
        __playbook_default_workspace_id: 'workspace-1',
      }),
    }));
  });

  it('derives replay eligibility output contracts from the current active output format template', async () => {
    const currentOutputContract = {
      type: 'markdown_sections',
      requiredSections: ['Summary'],
      forbiddenSections: [],
      jsonSchema: null,
      citationPolicy: 'required',
    };
    const replayBaselineService = {
      buildOutputContractFromReplay: jest.fn().mockReturnValue(currentOutputContract),
      buildCurrentReplayFingerprints: jest.fn().mockReturnValue({ outputContractHash: 'contract-b' }),
    };
    const snapshot = {
      nodes: [{ id: 'step-1', kind: 'step', metadata: {} }],
      controlEdges: [],
      dataBindings: [],
      settings: {},
      workspaces: ['workspace-1'],
    };
    const { service, agentService } = createExecutionServiceForTests({
      replayArtifactService: {
        resolveReplayArtifacts: async () => new Map([['step-1', {
          taskId: 'step-1',
          replayId: 'replay-1',
          validationVersion: 3,
          mode: 'replay_flex',
          referenceOutput: '# Summary\nHello',
          outputFormatGuide: 'Old guide',
          toolCalls: [],
          reasoningChain: [],
          fingerprints: { outputContractHash: 'contract-a' },
          behaviorBaseline: null,
          toolPolicy: null,
          outputContract: { type: 'freeform', requiredSections: [], forbiddenSections: [], jsonSchema: null, citationPolicy: 'optional' },
          replayConfig: { replayOutputFormat: true, replayToolTrace: false, replayReasoningChain: false },
        }]]) },
      replayBaselineService,
      replayEligibilityService: {
        evaluateReplayEligibility: jest.fn().mockReturnValue({
          applied: false,
          confidenceScore: 0,
          confidenceFactors: {},
          invalidationReasons: ['output_contract_mismatch'],
          appliedSections: [],
          skippedSections: [],
        }),
      },
      outputFormatService: {
        getActiveTemplates: jest.fn().mockResolvedValue(new Map([['step-1', { formatGuide: 'Use a Summary section with citations.' }]])),
      },
      executionModel: {
        updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
        findById: jest.fn()
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ executionMode: 'replay_flex', stepExecutionModes: {} }) }) })
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ executionMode: 'replay_flex' }) }) })
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }) })
          .mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }) }),
      },
    });
    (service as any).playbookFlowClient = { Run: jest.fn().mockReturnValue({ on: jest.fn() }) };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', snapshot, { brief: 'same' }, snapshot);

    expect(replayBaselineService.buildOutputContractFromReplay).toHaveBeenCalledWith({
      output: '# Summary\nHello',
      preserveOutputFormat: true,
      outputFormatGuide: 'Use a Summary section with citations.',
      existingOutputContract: {
        type: 'freeform',
        requiredSections: [],
        forbiddenSections: [],
        jsonSchema: null,
        citationPolicy: 'optional',
      },
    });
    expect(replayBaselineService.buildCurrentReplayFingerprints).toHaveBeenCalledWith(expect.objectContaining({
      outputContract: currentOutputContract,
    }));
  });
});

describe('single-step execution safety', () => {
  it('allows single-step execution for flow-dependent nodes when upstream results exist', async () => {
    const savedExecution = {
      id: 'exec-dependent',
      queuePosition: 0,
      save: jest.fn().mockResolvedValue(undefined),
      toJSON: jest.fn().mockReturnValue({ id: 'exec-dependent' }),
    };
    savedExecution.save = jest.fn().mockResolvedValue(savedExecution);
    const ExecutionModel = jest.fn(() => savedExecution) as any;
    ExecutionModel.findByIdAndDelete = jest.fn();
    const service = new PlaybookFlowExecutionService(
      ExecutionModel,
      {
        updateOne: jest.fn(),
        deleteMany: jest.fn(),
        find: jest.fn(() => ({
          sort: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([
                {
                  taskId: 'task-1',
                  iteration: 0,
                  output: {
                    outputs: {
                      summary: { content: 'seeded summary' },
                    },
                  },
                  displayText: 'seeded summary',
                  outputs: {
                    summary: { content: 'seeded summary' },
                  },
                  artifacts: [{ port_id: 'summary', artifact_kind: 'text', content: 'seeded summary' }],
                  components: [],
                  traceMetadata: {},
                },
              ]),
            }),
          }),
        })),
      } as any,
      { create: jest.fn(), deleteMany: jest.fn() } as any,
      { get: jest.fn((key: string, fallback: unknown) => fallback) } as any,
      { admit: jest.fn().mockResolvedValue(1), release: jest.fn(), refreshPositions: jest.fn().mockResolvedValue([]) } as any,
      { reserve: jest.fn(), confirmLink: jest.fn(), release: jest.fn() } as any,
      {
        findOne: jest.fn().mockResolvedValue({
          nodes: [
            { id: 'task-1', kind: 'step', metadata: {}, output: { ports: [{ id: 'summary' }] } },
            { id: 'task-2', kind: 'step', metadata: {}, input: { ports: [{ id: 'summary' }] } },
          ],
          controlEdges: [{ id: 'edge-1', kind: 'sequential', source: 'task-1', target: 'task-2' }],
          dataBindings: [{
            id: 'binding-1',
            targetNode: 'task-2',
            targetPort: 'summary',
            sourceKind: 'node-output',
            sourceNode: 'task-1',
            sourcePort: 'summary',
            iteration: 'current',
          }],
          settings: {},
        }),
        findById: jest.fn(),
      } as any,
      {
        buildSnapshot: jest.fn().mockReturnValue({
          settings: {},
          nodes: [
            { id: 'task-1', kind: 'step', metadata: {}, output: { ports: [{ id: 'summary' }] } },
            { id: 'task-2', kind: 'step', metadata: {}, input: { ports: [{ id: 'summary' }] } },
          ],
          controlEdges: [{ id: 'edge-1', kind: 'sequential', source: 'task-1', target: 'task-2' }],
          dataBindings: [{
            id: 'binding-1',
            targetNode: 'task-2',
            targetPort: 'summary',
            sourceKind: 'node-output',
            sourceNode: 'task-1',
            sourcePort: 'summary',
            iteration: 'current',
          }],
        }),
      } as any,
      { validate: jest.fn() } as any,
      { buildGrpcAgentsForPlaybook: jest.fn() } as any,
      { cacheOwner: jest.fn(), emitExecutionQueued: jest.fn() } as any,
      new PlaybookFlowObservabilityService(
        new PlaybookFlowTraceRedactionService(),
        new PlaybookFlowPublicReasoningParserService(),
      ) as any,
      {} as any,
      { resolveReplayArtifacts: async () => new Map() } as any,
      { buildReplayPromptSection: () => '' } as any,
      { buildCurrentReplayFingerprints: jest.fn() } as any,
      { evaluateReplayEligibility: jest.fn() } as any,
      { createPreRunReport: jest.fn(), updateStructuralDrift: jest.fn() } as any,
      new PlaybookFlowOutputContractService() as any,
      { validateModelActive: jest.fn().mockResolvedValue({ valid: true, model: null, inactive: false }) } as any,
    );

    (service as any).executionModel.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([{
                _id: 'prev-exec-1',
                snapshot: {
                  nodes: [
                    { id: 'task-1', kind: 'step', metadata: {}, output: { ports: [{ id: 'summary' }] } },
                    { id: 'task-2', kind: 'step', metadata: {}, input: { ports: [{ id: 'summary' }] } },
                  ],
                },
              }]),
            }),
          }),
        }),
      }),
    });
    jest.spyOn(service as any, 'drainQueue').mockResolvedValue(undefined);

    await service.start('flow-1', 'owner-1', {}, undefined, 'task-2');

    expect(ExecutionModel).toHaveBeenCalledWith(expect.objectContaining({
      singleStepTaskId: 'task-2',
      snapshot: expect.objectContaining({
        nodes: [{ id: 'task-2', kind: 'step', metadata: {}, input: { ports: [{ id: 'summary' }] } }],
        controlEdges: [],
        dataBindings: [{
          id: 'binding-1',
          targetNode: 'task-2',
          targetPort: 'summary',
          sourceKind: 'node-output',
          sourceNode: 'task-1',
          sourcePort: 'summary',
          iteration: 'current',
        }],
      }),
      seededTaskOutputs: [{
        nodeId: 'task-1',
        iteration: 0,
        payload: expect.objectContaining({
          output: expect.any(String),
          displayText: 'seeded summary',
          outputs: {
            summary: { content: 'seeded summary' },
          },
          artifacts: [{ port_id: 'summary', artifact_kind: 'text', content: 'seeded summary' }],
        }),
      }],
    }));
  });

  it('allows single-step execution for standalone step nodes', async () => {
    const savedExecution = {
      id: 'exec-standalone',
      queuePosition: 0,
      save: jest.fn().mockResolvedValue(undefined),
      toJSON: jest.fn().mockReturnValue({ id: 'exec-standalone' }),
    };
    savedExecution.save = jest.fn().mockResolvedValue(savedExecution);
    const ExecutionModel = jest.fn(() => savedExecution) as any;
    ExecutionModel.findByIdAndDelete = jest.fn();

    const service = new PlaybookFlowExecutionService(
      ExecutionModel,
      { updateOne: jest.fn(), deleteMany: jest.fn() } as any,
      { create: jest.fn(), deleteMany: jest.fn() } as any,
      { get: jest.fn((key: string, fallback: unknown) => fallback) } as any,
      { admit: jest.fn().mockResolvedValue(1), release: jest.fn(), refreshPositions: jest.fn().mockResolvedValue([]) } as any,
      { reserve: jest.fn(), confirmLink: jest.fn(), release: jest.fn() } as any,
      {
        findOne: jest.fn().mockResolvedValue({
          nodes: [{ id: 'task-1', kind: 'step', metadata: {} }],
          controlEdges: [],
          dataBindings: [],
          settings: {},
        }),
      } as any,
      { buildSnapshot: jest.fn().mockReturnValue({ settings: {}, nodes: [{ id: 'task-1', kind: 'step' }], controlEdges: [], dataBindings: [] }) } as any,
      { validate: jest.fn() } as any,
      { buildGrpcAgentsForPlaybook: jest.fn() } as any,
      { cacheOwner: jest.fn(), emitExecutionQueued: jest.fn() } as any,
      new PlaybookFlowObservabilityService(
        new PlaybookFlowTraceRedactionService(),
        new PlaybookFlowPublicReasoningParserService(),
      ) as any,
      {} as any,
      { resolveReplayArtifacts: async () => new Map() } as any,
      { buildReplayPromptSection: () => '' } as any,
      { buildCurrentReplayFingerprints: jest.fn() } as any,
      { evaluateReplayEligibility: jest.fn() } as any,
      { createPreRunReport: jest.fn(), updateStructuralDrift: jest.fn() } as any,
      new PlaybookFlowOutputContractService() as any,
      { validateModelActive: jest.fn().mockResolvedValue({ valid: true, model: null, inactive: false }) } as any,
    );
    jest.spyOn(service as any, 'drainQueue').mockResolvedValue(undefined);

    await service.start('flow-1', 'owner-1', {}, undefined, 'task-1');

    expect(ExecutionModel).toHaveBeenCalledWith(expect.objectContaining({
      singleStepTaskId: 'task-1',
      snapshot: expect.objectContaining({
        nodes: [{ id: 'task-1', kind: 'step' }],
        controlEdges: [],
        dataBindings: [],
      }),
    }));
  });

  it('rejects dependent single-step execution when upstream results are missing', async () => {
    const savedExecution = {
      id: 'exec-missing-upstream',
      save: jest.fn(),
      toJSON: jest.fn(),
    };
    const ExecutionModel = jest.fn(() => savedExecution) as any;
    const service = createExecutionServiceForTests({
      executionModel: {
        find: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            sort: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                lean: jest.fn().mockReturnValue({
                  exec: jest.fn().mockResolvedValue([]),
                }),
              }),
            }),
          }),
        }),
      },
      flowService: {
        findOne: jest.fn().mockResolvedValue({
          nodes: [
            { id: 'task-1', kind: 'step', metadata: {}, output: { ports: [{ id: 'summary' }] } },
            { id: 'task-2', kind: 'step', metadata: {}, input: { ports: [{ id: 'summary' }] } },
          ],
          controlEdges: [{ id: 'edge-1', kind: 'sequential', source: 'task-1', target: 'task-2' }],
          dataBindings: [{
            id: 'binding-1',
            targetNode: 'task-2',
            targetPort: 'summary',
            sourceKind: 'node-output',
            sourceNode: 'task-1',
            sourcePort: 'summary',
            iteration: 'current',
          }],
          settings: {},
        }),
      },
      builderService: {
        buildSnapshot: jest.fn().mockReturnValue({
          settings: {},
          nodes: [
            { id: 'task-1', kind: 'step', metadata: {}, output: { ports: [{ id: 'summary' }] } },
            { id: 'task-2', kind: 'step', metadata: {}, input: { ports: [{ id: 'summary' }] } },
          ],
          controlEdges: [{ id: 'edge-1', kind: 'sequential', source: 'task-1', target: 'task-2' }],
          dataBindings: [{
            id: 'binding-1',
            targetNode: 'task-2',
            targetPort: 'summary',
            sourceKind: 'node-output',
            sourceNode: 'task-1',
            sourcePort: 'summary',
            iteration: 'current',
          }],
        }),
      },
    }).service;

    await expect(service.start('flow-1', 'owner-1', {}, undefined, 'task-2')).rejects.toThrow(
      'Single-step execution for node task-2 requires a previous completed execution with matching upstream node snapshots.',
    );
    expect(ExecutionModel).not.toHaveBeenCalled();
  });

  it('rejects single-step execution for router-controlled nodes', async () => {
    const { service } = createExecutionServiceForTests({
      flowService: {
        findOne: jest.fn().mockResolvedValue({
          nodes: [
            { id: 'router-1', kind: 'router', metadata: {} },
            { id: 'task-2', kind: 'step', metadata: {} },
          ],
          controlEdges: [{ id: 'edge-1', kind: 'conditional', source: 'router-1', target: 'task-2', routerLabel: 'valid' }],
          dataBindings: [],
          settings: {},
        }),
      },
      builderService: {
        buildSnapshot: jest.fn().mockReturnValue({
          settings: {},
          nodes: [
            { id: 'router-1', kind: 'router', metadata: {} },
            { id: 'task-2', kind: 'step', metadata: {} },
          ],
          controlEdges: [{ id: 'edge-1', kind: 'conditional', source: 'router-1', target: 'task-2', routerLabel: 'valid' }],
          dataBindings: [],
        }),
      },
    });

    await expect(service.start('flow-1', 'owner-1', {}, undefined, 'task-2')).rejects.toThrow(
      'Single-step execution only supports nodes reached by sequential step dependencies.',
    );
  });

  it('rejects dependent single-step execution when the upstream snapshot no longer matches', async () => {
    const savedExecution = {
      id: 'exec-mismatch',
      queuePosition: 0,
      save: jest.fn().mockResolvedValue(undefined),
      toJSON: jest.fn().mockReturnValue({ id: 'exec-mismatch' }),
    };
    savedExecution.save = jest.fn().mockResolvedValue(savedExecution);
    const ExecutionModel = jest.fn(() => savedExecution) as any;
    const service = new PlaybookFlowExecutionService(
      ExecutionModel,
      {
        updateOne: jest.fn(),
        deleteMany: jest.fn(),
        find: jest.fn(() => ({
          sort: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
          }),
        })),
      } as any,
      { create: jest.fn(), deleteMany: jest.fn() } as any,
      { get: jest.fn((key: string, fallback: unknown) => fallback) } as any,
      { admit: jest.fn().mockResolvedValue(1), release: jest.fn(), refreshPositions: jest.fn().mockResolvedValue([]) } as any,
      { reserve: jest.fn(), confirmLink: jest.fn(), release: jest.fn() } as any,
      {
        findOne: jest.fn().mockResolvedValue({
          nodes: [
            { id: 'task-1', kind: 'step', metadata: { version: 2 }, output: { ports: [{ id: 'summary' }] } },
            { id: 'task-2', kind: 'step', metadata: {}, input: { ports: [{ id: 'summary' }] } },
          ],
          controlEdges: [{ id: 'edge-1', kind: 'sequential', source: 'task-1', target: 'task-2' }],
          dataBindings: [{
            id: 'binding-1',
            targetNode: 'task-2',
            targetPort: 'summary',
            sourceKind: 'node-output',
            sourceNode: 'task-1',
            sourcePort: 'summary',
            iteration: 'current',
          }],
          settings: {},
        }),
      } as any,
      {
        buildSnapshot: jest.fn().mockReturnValue({
          settings: {},
          nodes: [
            { id: 'task-1', kind: 'step', metadata: { version: 2 }, output: { ports: [{ id: 'summary' }] } },
            { id: 'task-2', kind: 'step', metadata: {}, input: { ports: [{ id: 'summary' }] } },
          ],
          controlEdges: [{ id: 'edge-1', kind: 'sequential', source: 'task-1', target: 'task-2' }],
          dataBindings: [{
            id: 'binding-1',
            targetNode: 'task-2',
            targetPort: 'summary',
            sourceKind: 'node-output',
            sourceNode: 'task-1',
            sourcePort: 'summary',
            iteration: 'current',
          }],
        }),
      } as any,
      { validate: jest.fn() } as any,
      { buildGrpcAgentsForPlaybook: jest.fn() } as any,
      { cacheOwner: jest.fn(), emitExecutionQueued: jest.fn() } as any,
      new PlaybookFlowObservabilityService(
        new PlaybookFlowTraceRedactionService(),
        new PlaybookFlowPublicReasoningParserService(),
      ) as any,
      {} as any,
      { resolveReplayArtifacts: async () => new Map() } as any,
      { buildReplayPromptSection: () => '' } as any,
      { buildCurrentReplayFingerprints: jest.fn() } as any,
      { evaluateReplayEligibility: jest.fn() } as any,
      { createPreRunReport: jest.fn(), updateStructuralDrift: jest.fn() } as any,
      new PlaybookFlowOutputContractService() as any,
      { validateModelActive: jest.fn().mockResolvedValue({ valid: true, model: null, inactive: false }) } as any,
    );

    (service as any).executionModel.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([{
                _id: 'prev-exec-1',
                snapshot: {
                  nodes: [
                    { id: 'task-1', kind: 'step', metadata: { version: 1 }, output: { ports: [{ id: 'summary' }] } },
                    { id: 'task-2', kind: 'step', metadata: {}, input: { ports: [{ id: 'summary' }] } },
                  ],
                },
              }]),
            }),
          }),
        }),
      }),
    });

    await expect(service.start('flow-1', 'owner-1', {}, undefined, 'task-2')).rejects.toThrow(
      'Single-step execution for node task-2 requires a previous completed execution with matching upstream node snapshots.',
    );
  });

  it('seeds both current and previous upstream iterations when needed', async () => {
    const savedExecution = {
      id: 'exec-previous',
      queuePosition: 0,
      save: jest.fn().mockResolvedValue(undefined),
      toJSON: jest.fn().mockReturnValue({ id: 'exec-previous' }),
    };
    savedExecution.save = jest.fn().mockResolvedValue(savedExecution);
    const ExecutionModel = jest.fn(() => savedExecution) as any;
    const service = new PlaybookFlowExecutionService(
      ExecutionModel,
      {
        updateOne: jest.fn(),
        deleteMany: jest.fn(),
        find: jest.fn(() => ({
          sort: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([
                {
                  taskId: 'task-1',
                  iteration: 2,
                  output: 'latest',
                  displayText: 'latest',
                  outputs: { summary: { content: 'latest' } },
                },
                {
                  taskId: 'task-1',
                  iteration: 1,
                  output: 'previous',
                  displayText: 'previous',
                  outputs: { summary: { content: 'previous' } },
                },
              ]),
            }),
          }),
        })),
      } as any,
      { create: jest.fn(), deleteMany: jest.fn() } as any,
      { get: jest.fn((key: string, fallback: unknown) => fallback) } as any,
      { admit: jest.fn().mockResolvedValue(1), release: jest.fn(), refreshPositions: jest.fn().mockResolvedValue([]) } as any,
      { reserve: jest.fn(), confirmLink: jest.fn(), release: jest.fn() } as any,
      {
        findOne: jest.fn().mockResolvedValue({
          nodes: [
            { id: 'task-1', kind: 'step', metadata: {}, output: { ports: [{ id: 'summary' }] } },
            { id: 'task-2', kind: 'step', metadata: {}, input: { ports: [{ id: 'summary' }] } },
          ],
          controlEdges: [{ id: 'edge-1', kind: 'sequential', source: 'task-1', target: 'task-2' }],
          dataBindings: [{
            id: 'binding-1',
            targetNode: 'task-2',
            targetPort: 'summary',
            sourceKind: 'node-output',
            sourceNode: 'task-1',
            sourcePort: 'summary',
            iteration: 'previous',
          }],
          settings: {},
        }),
      } as any,
      {
        buildSnapshot: jest.fn().mockReturnValue({
          settings: {},
          nodes: [
            { id: 'task-1', kind: 'step', metadata: {}, output: { ports: [{ id: 'summary' }] } },
            { id: 'task-2', kind: 'step', metadata: {}, input: { ports: [{ id: 'summary' }] } },
          ],
          controlEdges: [{ id: 'edge-1', kind: 'sequential', source: 'task-1', target: 'task-2' }],
          dataBindings: [{
            id: 'binding-1',
            targetNode: 'task-2',
            targetPort: 'summary',
            sourceKind: 'node-output',
            sourceNode: 'task-1',
            sourcePort: 'summary',
            iteration: 'previous',
          }],
        }),
      } as any,
      { validate: jest.fn() } as any,
      { buildGrpcAgentsForPlaybook: jest.fn() } as any,
      { cacheOwner: jest.fn(), emitExecutionQueued: jest.fn() } as any,
      new PlaybookFlowObservabilityService(
        new PlaybookFlowTraceRedactionService(),
        new PlaybookFlowPublicReasoningParserService(),
      ) as any,
      {} as any,
      { resolveReplayArtifacts: async () => new Map() } as any,
      { buildReplayPromptSection: () => '' } as any,
      { buildCurrentReplayFingerprints: jest.fn() } as any,
      { evaluateReplayEligibility: jest.fn() } as any,
      { createPreRunReport: jest.fn(), updateStructuralDrift: jest.fn() } as any,
      new PlaybookFlowOutputContractService() as any,
      { validateModelActive: jest.fn().mockResolvedValue({ valid: true, model: null, inactive: false }) } as any,
    );

    (service as any).executionModel.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([{
                _id: 'prev-exec-1',
                snapshot: {
                  nodes: [
                    { id: 'task-1', kind: 'step', metadata: {}, output: { ports: [{ id: 'summary' }] } },
                    { id: 'task-2', kind: 'step', metadata: {}, input: { ports: [{ id: 'summary' }] } },
                  ],
                },
              }]),
            }),
          }),
        }),
      }),
    });
    jest.spyOn(service as any, 'drainQueue').mockResolvedValue(undefined);

    await service.start('flow-1', 'owner-1', {}, undefined, 'task-2');

    expect(ExecutionModel).toHaveBeenCalledWith(expect.objectContaining({
      seededTaskOutputs: [
        expect.objectContaining({ nodeId: 'task-1', iteration: 2 }),
        expect.objectContaining({ nodeId: 'task-1', iteration: 1 }),
      ],
    }));
  });
});

describe('shouldFinalizeStreamAsCompleted', () => {
  it('prevents false completion after terminal or paused states', () => {
    expect(shouldFinalizeStreamAsCompleted(true, false, 'running')).toBe(false);
    expect(shouldFinalizeStreamAsCompleted(false, true, 'running')).toBe(false);
    expect(shouldFinalizeStreamAsCompleted(false, false, 'cancelled')).toBe(false);
    expect(shouldFinalizeStreamAsCompleted(false, false, 'pending_approval')).toBe(false);
    expect(shouldFinalizeStreamAsCompleted(false, false, 'failed')).toBe(false);
    expect(shouldFinalizeStreamAsCompleted(false, false, 'completed')).toBe(false);
  });

  it('allows completion only for active non-paused streams', () => {
    expect(shouldFinalizeStreamAsCompleted(false, false, 'running')).toBe(true);
    expect(shouldFinalizeStreamAsCompleted(false, false, 'queued')).toBe(true);
  });
});

describe('shouldEmitFailureOnStreamError', () => {
  it('emits a failure only once per stream', () => {
    expect(shouldEmitFailureOnStreamError(false)).toBe(true);
    expect(shouldEmitFailureOnStreamError(true)).toBe(false);
  });
});

describe('shouldEmitCompletedAfterUpdate', () => {
  it('emits completion only when the guarded update wins', () => {
    expect(shouldEmitCompletedAfterUpdate(1)).toBe(true);
    expect(shouldEmitCompletedAfterUpdate(0)).toBe(false);
    expect(shouldEmitCompletedAfterUpdate(undefined)).toBe(false);
  });
});

describe('service terminal handling', () => {
  it('persists enriched node results without collapsing metadata into output', async () => {
    const { service, taskResultModel, streamEvents } = createExecutionServiceForTests();
    taskResultModel.updateOne.mockResolvedValue(undefined);

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeCompleted',
      node_id: 'step-1',
      iteration: 0,
        payload: {
          output: 'Executive summary\n---PUBLIC_REASONING_TRACE_JSON---\n[{"id":"step_1","type":"observation","label":"Identify","description":"Picked the answer."}]',
          display_text: 'Executive summary\n---PUBLIC_REASONING_TRACE_JSON---\n[{"id":"step_1","type":"observation","label":"Identify","description":"Picked the answer."}]',
          artifacts: [{ port_id: 'report', artifact_kind: 'document', filename: 'report.pdf', url: 'https://example.com/report.pdf' }],
          components: [{ type: 'text', data: { content: 'Executive summary' } }],
        },
    });

    expect(taskResultModel.updateOne).toHaveBeenCalledWith(
      { executionId: 'exec-1', taskId: 'step-1', iteration: 0 },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'completed',
          output: 'Executive summary',
          displayText: 'Executive summary',
          reasoningChain: [{ id: 'step_1', type: 'observation', label: 'Identify', description: 'Picked the answer.' }],
          artifacts: [{ port_id: 'report', artifact_kind: 'document', filename: 'report.pdf', url: 'https://example.com/report.pdf' }],
          components: [{ type: 'text', data: { content: 'Executive summary' } }],
        }),
      }),
      { upsert: true },
    );
    expect(streamEvents.emitStepComplete).toHaveBeenCalledWith(
      'exec-1',
      'step-1',
      'Executive summary',
      undefined,
      0,
      [{ port_id: 'report', artifact_kind: 'document', filename: 'report.pdf', url: 'https://example.com/report.pdf' }],
      [{ type: 'text', data: { content: 'Executive summary' } }],
      expect.objectContaining({
        reasoningChain: [{ id: 'step_1', type: 'observation', label: 'Identify', description: 'Picked the answer.' }],
      }),
    );
  });

  it('does not fail task completion when public reasoning JSON is malformed', async () => {
    const { service, taskResultModel } = createExecutionServiceForTests();
    taskResultModel.updateOne.mockResolvedValue(undefined);

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeCompleted',
      node_id: 'step-1',
      iteration: 0,
      payload: {
        output: 'Executive summary\n---PUBLIC_REASONING_TRACE_JSON---\n{',
      },
    });

    expect(taskResultModel.updateOne).toHaveBeenCalledWith(
      { executionId: 'exec-1', taskId: 'step-1', iteration: 0 },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'completed',
          output: 'Executive summary',
          reasoningChain: [],
          traceMetadata: expect.objectContaining({
            publicReasoning: expect.objectContaining({ parseError: 'invalid_json' }),
          }),
        }),
      }),
      { upsert: true },
    );
  });

  it('persists structural drift on completed replay-backed tasks', async () => {
    const replayReportService = {
      createPreRunReport: jest.fn().mockResolvedValue(undefined),
      updateStructuralDrift: jest.fn().mockResolvedValue(undefined),
    };
    const replayArtifactService = {
      resolveReplayArtifacts: jest.fn().mockResolvedValue(new Map([['step-1', {
        taskId: 'step-1',
        replayId: 'replay-1',
        flowId: 'flow-1',
        validationVersion: 2,
        mode: 'replay_strict',
        isStale: false,
        staleReasons: [],
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
        outputContract: {
          type: 'markdown_sections',
          requiredSections: ['Summary'],
          forbiddenSections: [],
          jsonSchema: null,
          citationPolicy: 'optional',
        },
        replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false },
      }]])),
    };
    const executionModel = {
      findById: jest.fn(() => ({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ flowId: 'flow-1', ownerId: 'owner-1' }),
        }),
      })),
      updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
      findByIdAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) })),
    };
    const { service, taskResultModel } = createExecutionServiceForTests({
      replayArtifactService,
      replayReportService,
      executionModel,
    });
    taskResultModel.updateOne.mockResolvedValue(undefined);
    (service as any).cacheSelectedReplayArtifacts('exec-1', 'step-1', {
      taskId: 'step-1',
      replayId: 'replay-1',
      flowId: 'flow-1',
      validationVersion: 2,
      mode: 'replay_strict',
      intentKey: null,
      reasoningOutline: [],
      driftPolicy: null,
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
      outputContract: {
        type: 'markdown_sections',
        requiredSections: ['Summary'],
        forbiddenSections: [],
        jsonSchema: null,
        citationPolicy: 'optional',
      },
      replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false },
    });

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeCompleted',
      node_id: 'step-1',
      iteration: 0,
      payload: {
        output: '# Summary\nCompleted',
        tool_trace: [
          { call_index: 1, tool_name: 'search', args: {}, status: 'completed' },
        ],
      },
    });

    expect(replayArtifactService.resolveReplayArtifacts).not.toHaveBeenCalled();
    expect(replayReportService.updateStructuralDrift).toHaveBeenCalledWith(expect.objectContaining({
      executionId: 'exec-1',
      taskId: 'step-1',
      iteration: 0,
      output: '# Summary\nCompleted',
      replayArtifacts: expect.objectContaining({ replayId: 'replay-1', validationVersion: 2 }),
      toolTrace: [expect.objectContaining({ callIndex: 1, toolName: 'search', args: {}, status: 'completed' })],
      reasoningChain: [],
      semanticMatch: null,
    }));
  });

  it('persists tool policy score even without an output contract', async () => {
    const replayReportService = {
      createPreRunReport: jest.fn().mockResolvedValue(undefined),
      updateStructuralDrift: jest.fn().mockResolvedValue(undefined),
    };
    const { service, taskResultModel } = createExecutionServiceForTests({
      replayReportService,
    });
    taskResultModel.updateOne.mockResolvedValue(undefined);
    (service as any).cacheSelectedReplayArtifacts('exec-1', 'step-1', {
      taskId: 'step-1',
      replayId: 'replay-1',
      flowId: 'flow-1',
      validationVersion: 2,
      mode: 'replay_strict',
      intentKey: null,
      reasoningOutline: [],
      driftPolicy: null,
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
    });

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeCompleted',
      node_id: 'step-1',
      iteration: 0,
      payload: {
        output: 'Completed',
        tool_trace: [
          { call_index: 1, tool_name: 'search', args: {}, status: 'completed' },
        ],
      },
    });

    expect(replayReportService.updateStructuralDrift).toHaveBeenCalledWith(expect.objectContaining({
      executionId: 'exec-1',
      taskId: 'step-1',
      iteration: 0,
      output: 'Completed',
      replayArtifacts: expect.objectContaining({ replayId: 'replay-1', validationVersion: 2 }),
      toolTrace: [expect.objectContaining({ callIndex: 1, toolName: 'search', args: {}, status: 'completed' })],
      reasoningChain: [],
      semanticMatch: null,
    }));
  });

  it('persists semantic match on replay reports even without output contract or tool policy', async () => {
    const replayReportService = {
      createPreRunReport: jest.fn().mockResolvedValue(undefined),
      updateStructuralDrift: jest.fn().mockResolvedValue(undefined),
    };
    const { service, taskResultModel } = createExecutionServiceForTests({
      replayReportService,
    });
    taskResultModel.updateOne.mockResolvedValue(undefined);
    (service as any).cacheSelectedReplayArtifacts('exec-1', 'step-1', {
      taskId: 'step-1',
      replayId: 'replay-1',
      flowId: 'flow-1',
      validationVersion: 2,
      mode: 'replay_strict',
      intentKey: null,
      reasoningOutline: [],
      driftPolicy: null,
      referenceOutput: null,
      outputFormatGuide: null,
      toolCalls: [],
      reasoningChain: [],
      fingerprints: null,
      behaviorBaseline: null,
      toolPolicy: null,
      outputContract: null,
      replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false },
    });

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeCompleted',
      node_id: 'step-1',
      iteration: 0,
      payload: {
        output: 'Completed',
        semantic_match: {
          match_score: 88,
          semantic_similarity_score: 86,
          evidence_consistency_score: 84,
          judge_score: 90,
          reason: 'Matches baseline intent',
          missing_points: ['minor detail'],
          changed_points: ['formatting'],
          model: 'judge-model',
          judge_used: true,
        },
      },
    });

    expect(replayReportService.updateStructuralDrift).toHaveBeenCalledWith(expect.objectContaining({
      executionId: 'exec-1',
      taskId: 'step-1',
      iteration: 0,
      output: 'Completed',
      replayArtifacts: expect.objectContaining({ replayId: 'replay-1', validationVersion: 2 }),
      toolTrace: [],
      reasoningChain: [],
      semanticMatch: {
        matchScore: 88,
        semanticSimilarityScore: 86,
        evidenceConsistencyScore: 84,
        judgeScore: 90,
        reason: 'Matches baseline intent',
        missingPoints: ['minor detail'],
        changedPoints: ['formatting'],
        model: 'judge-model',
        judgeUsed: true,
      },
    }));
  });

  it('reads observed intent from trace metadata when ADK emits it', async () => {
    const replayReportService = {
      createPreRunReport: jest.fn().mockResolvedValue(undefined),
      updateStructuralDrift: jest.fn().mockResolvedValue(undefined),
    };
    const { service, taskResultModel } = createExecutionServiceForTests({
      replayReportService,
    });
    taskResultModel.updateOne.mockResolvedValue(undefined);
    (service as any).cacheSelectedReplayArtifacts('exec-1', 'step-1', {
      taskId: 'step-1',
      replayId: 'replay-1',
      flowId: 'flow-1',
      validationVersion: 2,
      mode: 'replay_flex',
      isStale: false,
      staleReasons: [],
      referenceOutput: null,
      outputFormatGuide: null,
      intentKey: 'facts.verify',
      intentLabel: 'Verify facts',
      reasoningOutline: [],
      stableReasoningRules: [],
      contextVariableSchema: [],
      toolTraceTemplate: [],
      driftPolicy: {
        requireSameIntent: true,
        requireSameReasoningStages: false,
        requireSameToolOrder: false,
        allowAdditionalTools: true,
        allowArgumentValueChanges: true,
        enforceOutputContract: true,
      },
      toolCalls: [],
      reasoningChain: [],
      fingerprints: null,
      behaviorBaseline: null,
      toolPolicy: null,
      outputContract: null,
      replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false },
    });

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeCompleted',
      node_id: 'step-1',
      iteration: 0,
      payload: {
        output: 'Completed',
        trace_metadata: {
          observed_intent_key: 'verify-facts-analysis',
        },
      },
    });

    expect(replayReportService.updateStructuralDrift).toHaveBeenCalledWith(expect.objectContaining({
      replayArtifacts: expect.objectContaining({ intentKey: 'facts.verify' }),
      traceMetadata: expect.objectContaining({ observed_intent_key: 'verify-facts-analysis' }),
    }));
  });

  it('reports intent mismatch when observed runtime intent differs from baseline', async () => {
    const replayReportService = {
      createPreRunReport: jest.fn().mockResolvedValue(undefined),
      updateStructuralDrift: jest.fn().mockResolvedValue(undefined),
    };
    const { service, taskResultModel } = createExecutionServiceForTests({
      replayReportService,
    });
    taskResultModel.updateOne.mockResolvedValue(undefined);
    (service as any).cacheSelectedReplayArtifacts('exec-1', 'step-1', {
      taskId: 'step-1',
      replayId: 'replay-1',
      flowId: 'flow-1',
      validationVersion: 2,
      mode: 'replay_flex',
      isStale: false,
      staleReasons: [],
      referenceOutput: null,
      outputFormatGuide: null,
      intentKey: 'facts.verify',
      intentLabel: 'Verify facts',
      reasoningOutline: [],
      stableReasoningRules: [],
      contextVariableSchema: [],
      toolTraceTemplate: [],
      driftPolicy: {
        requireSameIntent: true,
        requireSameReasoningStages: false,
        requireSameToolOrder: false,
        allowAdditionalTools: true,
        allowArgumentValueChanges: true,
        enforceOutputContract: true,
      },
      toolCalls: [],
      reasoningChain: [],
      fingerprints: null,
      behaviorBaseline: null,
      toolPolicy: null,
      outputContract: null,
      replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false },
    });

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeCompleted',
      node_id: 'step-1',
      iteration: 0,
      payload: {
        output: 'Completed',
        trace_metadata: {
          observed_intent_key: 'generate-report-synthesis',
        },
      },
    });

    expect(replayReportService.updateStructuralDrift).toHaveBeenCalledWith(expect.objectContaining({
      replayArtifacts: expect.objectContaining({ intentKey: 'facts.verify' }),
      traceMetadata: expect.objectContaining({ observed_intent_key: 'generate-report-synthesis' }),
    }));
  });

  it('reports intent not evaluated when no observed runtime intent in trace metadata', async () => {
    const replayReportService = {
      createPreRunReport: jest.fn().mockResolvedValue(undefined),
      updateStructuralDrift: jest.fn().mockResolvedValue(undefined),
    };
    const { service, taskResultModel } = createExecutionServiceForTests({
      replayReportService,
    });
    taskResultModel.updateOne.mockResolvedValue(undefined);
    (service as any).cacheSelectedReplayArtifacts('exec-1', 'step-1', {
      taskId: 'step-1',
      replayId: 'replay-1',
      flowId: 'flow-1',
      validationVersion: 2,
      mode: 'replay_flex',
      isStale: false,
      staleReasons: [],
      referenceOutput: null,
      outputFormatGuide: null,
      intentKey: 'facts.verify',
      intentLabel: 'Verify facts',
      reasoningOutline: [],
      stableReasoningRules: [],
      contextVariableSchema: [],
      toolTraceTemplate: [],
      driftPolicy: {
        requireSameIntent: true,
        requireSameReasoningStages: false,
        requireSameToolOrder: false,
        allowAdditionalTools: true,
        allowArgumentValueChanges: true,
        enforceOutputContract: true,
      },
      toolCalls: [],
      reasoningChain: [],
      fingerprints: null,
      behaviorBaseline: null,
      toolPolicy: null,
      outputContract: null,
      replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false },
    });

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeCompleted',
      node_id: 'step-1',
      iteration: 0,
      payload: {
        output: 'Completed',
      },
    });

    expect(replayReportService.updateStructuralDrift).toHaveBeenCalledWith(expect.objectContaining({
      replayArtifacts: expect.objectContaining({ intentKey: 'facts.verify' }),
      traceMetadata: expect.any(Object),
    }));
  });

  it('resolves replay artifacts from storage when completion cache is missing', async () => {
    const replayReportService = {
      createPreRunReport: jest.fn().mockResolvedValue(undefined),
      updateStructuralDrift: jest.fn().mockResolvedValue(undefined),
      findLatestReportForExecutionTask: jest.fn().mockResolvedValue({
        executionId: 'exec-1',
        flowId: 'flow-1',
        taskId: 'step-1',
        replayId: 'replay-1',
        validationVersion: 2,
        applied: true,
      }),
    };
    const replayArtifactService = {
      resolveReplayArtifactByIdentity: jest.fn().mockResolvedValue({
        taskId: 'step-1',
        replayId: 'replay-1',
        flowId: 'flow-1',
        validationVersion: 2,
        mode: 'replay_strict',
        intentKey: null,
        reasoningOutline: [],
        driftPolicy: null,
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
      }),
    };
    const executionModel = {
      findById: jest.fn(() => ({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ flowId: 'flow-1', ownerId: 'owner-1' }),
        }),
      })),
      updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
      findByIdAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) })),
    };
    const { service, taskResultModel } = createExecutionServiceForTests({
      replayArtifactService,
      replayReportService,
      executionModel,
    });
    taskResultModel.updateOne.mockResolvedValue(undefined);
    (service as any).trackReplayTask('exec-1', 'step-1');

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeCompleted',
      node_id: 'step-1',
      iteration: 0,
      payload: {
        output: 'Completed',
        tool_trace: [
          { call_index: 1, tool_name: 'search', args: {}, status: 'completed' },
        ],
      },
    });

    expect(replayReportService.findLatestReportForExecutionTask).toHaveBeenCalledWith('exec-1', 'step-1', 0);
    expect(replayArtifactService.resolveReplayArtifactByIdentity).toHaveBeenCalledWith({
      flowId: 'flow-1',
      taskId: 'step-1',
      replayId: 'replay-1',
      validationVersion: 2,
    });
    expect(replayReportService.updateStructuralDrift).toHaveBeenCalledWith(expect.objectContaining({
      executionId: 'exec-1',
      taskId: 'step-1',
      iteration: 0,
      output: 'Completed',
      replayArtifacts: expect.objectContaining({ replayId: 'replay-1', validationVersion: 2 }),
      toolTrace: [expect.objectContaining({ callIndex: 1, toolName: 'search', args: {}, status: 'completed' })],
      reasoningChain: [],
      semanticMatch: null,
    }));
  });

  it('does not resolve replay artifacts on completion when no applied replay report exists', async () => {
    const replayReportService = {
      createPreRunReport: jest.fn().mockResolvedValue(undefined),
      updateStructuralDrift: jest.fn().mockResolvedValue(undefined),
      updateSemanticMatch: jest.fn().mockResolvedValue(undefined),
      findLatestReportForExecutionTask: jest.fn().mockResolvedValue(null),
    };
    const replayArtifactService = {
      resolveReplayArtifactByIdentity: jest.fn().mockResolvedValue(null),
    };
    const { service, taskResultModel } = createExecutionServiceForTests({
      replayArtifactService,
      replayReportService,
    });
    taskResultModel.updateOne.mockResolvedValue(undefined);
    (service as any).trackReplayTask('exec-1', 'step-1');

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeCompleted',
      node_id: 'step-1',
      iteration: 0,
      payload: {
        output: 'Completed',
      },
    });

    expect(replayReportService.findLatestReportForExecutionTask).toHaveBeenCalledWith('exec-1', 'step-1', 0);
    expect(replayArtifactService.resolveReplayArtifactByIdentity).not.toHaveBeenCalled();
    expect(replayReportService.updateStructuralDrift).not.toHaveBeenCalled();
    expect(replayReportService.updateSemanticMatch).not.toHaveBeenCalled();
  });

  it('backfills semanticMatch on non-applied replay report when step produces semantic evaluation', async () => {
    const replayReportService = {
      createPreRunReport: jest.fn().mockResolvedValue(undefined),
      updateStructuralDrift: jest.fn().mockResolvedValue(undefined),
      updateSemanticMatch: jest.fn().mockResolvedValue(undefined),
      findLatestReportForExecutionTask: jest.fn().mockResolvedValue({
        executionId: 'exec-1',
        flowId: 'flow-1',
        taskId: 'step-1',
        replayId: 'replay-1',
        validationVersion: 2,
        applied: false,
      }),
    };
    const replayArtifactService = {
      resolveReplayArtifactByIdentity: jest.fn().mockResolvedValue(null),
    };
    const { service, taskResultModel } = createExecutionServiceForTests({
      replayArtifactService,
      replayReportService,
    });
    taskResultModel.updateOne.mockResolvedValue(undefined);
    (service as any).trackReplayTask('exec-1', 'step-1');

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeCompleted',
      node_id: 'step-1',
      iteration: 0,
      payload: {
        output: 'Completed',
        semantic_match: {
          match_score: 85,
          semantic_similarity_score: 82,
          evidence_consistency_score: 88,
          judge_score: 84,
          reason: 'Mostly aligned',
          missing_points: ['minor'],
          changed_points: ['format'],
          model: 'judge-model',
          judge_used: true,
        },
      },
    });

    expect(replayReportService.updateStructuralDrift).not.toHaveBeenCalled();
    expect(replayReportService.updateSemanticMatch).toHaveBeenCalledWith('exec-1', 'step-1', 0, {
      matchScore: 85,
      semanticSimilarityScore: 82,
      evidenceConsistencyScore: 88,
      judgeScore: 84,
      reason: 'Mostly aligned',
      missingPoints: ['minor'],
      changedPoints: ['format'],
      model: 'judge-model',
      judgeUsed: true,
    });
  });

  it('persists drift against the persisted replay identity when the active replay has changed', async () => {
    const replayReportService = {
      createPreRunReport: jest.fn().mockResolvedValue(undefined),
      updateStructuralDrift: jest.fn().mockResolvedValue(undefined),
      findLatestReportForExecutionTask: jest.fn().mockResolvedValue({
        executionId: 'exec-1',
        flowId: 'flow-1',
        taskId: 'step-1',
        replayId: 'replay-1',
        validationVersion: 2,
        applied: true,
      }),
    };
    const replayArtifactService = {
      resolveReplayArtifactByIdentity: jest.fn().mockResolvedValue({
        taskId: 'step-1',
        replayId: 'replay-1',
        flowId: 'flow-1',
        validationVersion: 2,
        mode: 'replay_strict',
        intentKey: null,
        reasoningOutline: [],
        driftPolicy: null,
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
      }),
    };
    const { service, taskResultModel } = createExecutionServiceForTests({
      replayArtifactService,
      replayReportService,
    });
    taskResultModel.updateOne.mockResolvedValue(undefined);
    (service as any).trackReplayTask('exec-1', 'step-1');

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeCompleted',
      node_id: 'step-1',
      iteration: 0,
      payload: {
        output: 'Completed',
        tool_trace: [
          { call_index: 1, tool_name: 'search', args: {}, status: 'completed' },
        ],
      },
    });

    expect(replayArtifactService.resolveReplayArtifactByIdentity).toHaveBeenCalledWith({
      flowId: 'flow-1',
      taskId: 'step-1',
      replayId: 'replay-1',
      validationVersion: 2,
    });
    expect(replayReportService.updateStructuralDrift).toHaveBeenCalledWith(expect.objectContaining({
      executionId: 'exec-1',
      taskId: 'step-1',
      iteration: 0,
      output: 'Completed',
      replayArtifacts: expect.objectContaining({ replayId: 'replay-1', validationVersion: 2 }),
      toolTrace: [expect.objectContaining({ callIndex: 1, toolName: 'search', args: {}, status: 'completed' })],
      reasoningChain: [],
      semanticMatch: null,
    }));
  });

  it('tracks skipped replay tasks without resolving artifacts on completion', async () => {
    const replayReportService = {
      createPreRunReport: jest.fn().mockResolvedValue(undefined),
      updateStructuralDrift: jest.fn().mockResolvedValue(undefined),
      findLatestReportForExecutionTask: jest.fn().mockResolvedValue({
        executionId: 'exec-1',
        flowId: 'flow-1',
        taskId: 'step-1',
        replayId: 'replay-1',
        validationVersion: 2,
        applied: false,
      }),
    };
    const replayArtifactService = {
      resolveReplayArtifactByIdentity: jest.fn().mockResolvedValue(null),
    };
    const { service, taskResultModel } = createExecutionServiceForTests({
      replayArtifactService,
      replayReportService,
    });
    taskResultModel.updateOne.mockResolvedValue(undefined);
    (service as any).trackReplayTask('exec-1', 'step-1');

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeCompleted',
      node_id: 'step-1',
      iteration: 0,
      payload: { output: 'Completed' },
    });

    expect(replayReportService.findLatestReportForExecutionTask).toHaveBeenCalledWith('exec-1', 'step-1', 0);
    expect(replayArtifactService.resolveReplayArtifactByIdentity).not.toHaveBeenCalled();
    expect(replayReportService.updateStructuralDrift).not.toHaveBeenCalled();
  });

  it('clears cached replay artifacts when execution start is rejected before the stream begins', async () => {
    const replayReportService = {
      createPreRunReport: jest.fn().mockResolvedValue(undefined),
      updateStructuralDrift: jest.fn().mockResolvedValue(undefined),
      findLatestReportForExecutionTask: jest.fn().mockResolvedValue({
        executionId: 'exec-1',
        flowId: 'flow-1',
        taskId: 'step-1',
        replayId: 'replay-1',
        validationVersion: 2,
        applied: true,
      }),
    };
    const replayPromptService = { buildReplayPromptSection: jest.fn().mockReturnValue('APPLY_REPLAY') };
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
        fingerprints: { nodeSnapshotHash: 'node-a' },
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
    const executionModel = {
      updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) })),
      findById: jest.fn(() => ({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ executionMode: 'replay_strict', stepExecutionModes: { 'step-1': 'replay_strict' } }),
        }),
      })),
      findByIdAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) })),
    };
    const snapshot = {
      nodes: [{ id: 'step-1', kind: 'step', metadata: {} }],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    };
    const { service, agentService } = createExecutionServiceForTests({
      executionModel,
      replayArtifactService,
      replayPromptService,
      replayReportService,
    });
    const run = jest.fn();
    (service as any).playbookFlowClient = { Run: run };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', snapshot, {}, snapshot);

    expect(run).not.toHaveBeenCalled();
    expect((service as any).getSelectedReplayArtifacts('exec-1', 'step-1')).toBeNull();
    expect((service as any).trackedReplayTasksByExecution.has('exec-1')).toBe(false);
  });

  it('does not query replay reports for completions that never tracked replay', async () => {
    const replayReportService = {
      createPreRunReport: jest.fn().mockResolvedValue(undefined),
      updateStructuralDrift: jest.fn().mockResolvedValue(undefined),
      findLatestReportForExecutionTask: jest.fn().mockResolvedValue({
        executionId: 'exec-1',
        flowId: 'flow-1',
        taskId: 'step-1',
        replayId: 'replay-1',
        validationVersion: 2,
        applied: true,
      }),
    };
    const { service, taskResultModel } = createExecutionServiceForTests({ replayReportService });
    taskResultModel.updateOne.mockResolvedValue(undefined);

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeCompleted',
      node_id: 'step-1',
      iteration: 0,
      payload: { output: 'Completed' },
    });

    expect(replayReportService.findLatestReportForExecutionTask).not.toHaveBeenCalled();
    expect(replayReportService.updateStructuralDrift).not.toHaveBeenCalled();
  });

  it('still emits step completion when replay artifact fallback lookup fails', async () => {
    const replayReportService = {
      createPreRunReport: jest.fn().mockResolvedValue(undefined),
      updateStructuralDrift: jest.fn().mockResolvedValue(undefined),
      findLatestReportForExecutionTask: jest.fn().mockRejectedValue(new Error('lookup failed')),
    };
    const { service, taskResultModel, streamEvents } = createExecutionServiceForTests({ replayReportService });
    taskResultModel.updateOne.mockResolvedValue(undefined);
    (service as any).trackReplayTask('exec-1', 'step-1');

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeCompleted',
      node_id: 'step-1',
      iteration: 0,
      payload: { output: 'Completed' },
    });

    expect(streamEvents.emitStepComplete).toHaveBeenCalledWith(
      'exec-1',
      'step-1',
      'Completed',
      undefined,
      0,
      undefined,
      undefined,
      expect.objectContaining({
        semanticMatch: null,
        toolTrace: [],
        reasoningChain: [],
        traceMetadata: expect.any(Object),
      }),
    );
  });

  it('does not emit completed after a reserved router cancellation already won', async () => {
    const executionModel = {
      updateOne: jest
        .fn()
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) }),
      findById: jest.fn(() => ({ lean: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }) })),
    };
    const { service, streamEvents } = createExecutionServiceForTests({ executionModel });

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'RouterDecision',
      node_id: 'router-1',
      iteration: 0,
      payload: { label: '__cancelled__' },
    });
    await (service as any).handleRunEvent('exec-1', {
      event_type: 'ExecutionCompleted',
      node_id: '',
      iteration: 0,
      payload: {},
    });

    expect(streamEvents.emitExecutionComplete).toHaveBeenCalledTimes(1);
    expect(streamEvents.emitExecutionComplete).toHaveBeenCalledWith(
      'exec-1',
      'cancelled',
      'Router router-1 returned __cancelled__',
    );
  });

  it('does not claim queued work when gRPC is unavailable', async () => {
    const { service, queueService } = createExecutionServiceForTests();
    (service as any).isGrpcAvailable = false;

    await (service as any).drainQueue('owner-1');

    expect(queueService.release).not.toHaveBeenCalled();
  });

  it('fails a claimed execution when its flow cannot be loaded', async () => {
    const executionModel = {
      updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
      findById: jest.fn(() => ({ lean: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }) })),
      findByIdAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) })),
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
    const { service, streamEvents } = createExecutionServiceForTests({ executionModel, queueService, flowService });
    (service as any).isGrpcAvailable = true;

    await (service as any).drainQueue('owner-1');

    expect(executionModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'exec-missing',
      expect.objectContaining({ status: 'failed', error: 'Flow not found before runtime start' }),
    );
    expect(streamEvents.emitExecutionComplete).toHaveBeenCalledWith(
      'exec-missing',
      'failed',
      'Flow not found before runtime start',
    );
  });

  it('ignores late approval requests after a terminal state already won', async () => {
    const executionModel = {
      updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) })),
      findById: jest.fn(() => ({ lean: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }) })),
    };
    const { service, streamEvents } = createExecutionServiceForTests({ executionModel });

    await (service as any).handleRunEvent('exec-2', {
      event_type: 'ApprovalRequested',
      node_id: 'approval-1',
      iteration: 0,
      payload: { prompt: 'Approve?' },
    });

    expect(streamEvents.emitInterrupt).not.toHaveBeenCalled();
  });

  it('ignores late reserved router labels after a terminal state already won', async () => {
    const executionModel = {
      updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) })),
      findById: jest.fn(() => ({ lean: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }) })),
    };
    const { service, streamEvents } = createExecutionServiceForTests({ executionModel });

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
      {} as any,
      { updateOne: jest.fn(), deleteMany: jest.fn() } as any,
      { create: jest.fn(), deleteMany: jest.fn() } as any,
      { get: jest.fn((key: string, fallback: unknown) => fallback) } as any,
      { admit: jest.fn(), release: jest.fn(), refreshPositions: jest.fn() } as any,
      idempotencyService as any,
      { findOne: jest.fn().mockResolvedValue({ nodes: [], controlEdges: [], dataBindings: [], settings: {} }) } as any,
      { buildSnapshot: jest.fn().mockReturnValue({ settings: { recursionLimit: 25, maxParallelism: 5 } }) } as any,
      { validate: jest.fn() } as any,
      { buildGrpcAgentsForPlaybook: jest.fn() } as any,
      { cacheOwner: jest.fn(), emitExecutionQueued: jest.fn() } as any,
      new PlaybookFlowObservabilityService(
        new PlaybookFlowTraceRedactionService(),
        new PlaybookFlowPublicReasoningParserService(),
      ) as any,
      {} as any,
      { resolveReplayArtifacts: async () => new Map() } as any,
      { buildReplayPromptSection: () => '' } as any,
      { buildCurrentReplayFingerprints: jest.fn() } as any,
      { evaluateReplayEligibility: jest.fn() } as any,
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
    const savedExecution = {
      id: 'exec-rollback',
      save: jest.fn().mockResolvedValue({
        id: 'exec-rollback',
        queuePosition: 1,
        toJSON: jest.fn().mockReturnValue({ id: 'exec-rollback' }),
      }),
    };
    const ExecutionModel = jest.fn(() => savedExecution) as any;
    ExecutionModel.findByIdAndDelete = jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) }));

    const idempotencyService = {
      reserve: jest.fn().mockResolvedValue({ type: 'reserved' }),
      confirmLink: jest.fn().mockRejectedValue(new Error('link failed')),
      release: jest.fn().mockResolvedValue(undefined),
    };

    const service = new PlaybookFlowExecutionService(
      ExecutionModel,
      { updateOne: jest.fn(), deleteMany: jest.fn() } as any,
      { create: jest.fn(), deleteMany: jest.fn() } as any,
      { get: jest.fn((key: string, fallback: unknown) => fallback) } as any,
      { admit: jest.fn(), release: jest.fn(), refreshPositions: jest.fn() } as any,
      idempotencyService as any,
      { findOne: jest.fn().mockResolvedValue({ nodes: [], controlEdges: [], dataBindings: [], settings: {} }) } as any,
      { buildSnapshot: jest.fn().mockReturnValue({ settings: { recursionLimit: 25, maxParallelism: 5 } }) } as any,
      { validate: jest.fn() } as any,
      { buildGrpcAgentsForPlaybook: jest.fn() } as any,
      { cacheOwner: jest.fn(), emitExecutionQueued: jest.fn() } as any,
      new PlaybookFlowObservabilityService(
        new PlaybookFlowTraceRedactionService(),
        new PlaybookFlowPublicReasoningParserService(),
      ) as any,
      {} as any,
      { resolveReplayArtifacts: async () => new Map() } as any,
      { buildReplayPromptSection: () => '' } as any,
      { buildCurrentReplayFingerprints: jest.fn() } as any,
      { evaluateReplayEligibility: jest.fn() } as any,
      { createPreRunReport: jest.fn(), updateStructuralDrift: jest.fn() } as any,
      new PlaybookFlowOutputContractService() as any,
      { validateModelActive: jest.fn().mockResolvedValue({ valid: true, model: null, inactive: false }) } as any,
    );

    await expect(service.start('flow-1', 'owner-1', {}, 'idem-1')).rejects.toThrow('link failed');
    expect(ExecutionModel.findByIdAndDelete).toHaveBeenCalledWith('exec-rollback');
    expect(idempotencyService.release).toHaveBeenCalledWith('owner-1', 'idem-1');
  });

  it('returns the existing execution for a duplicate idempotency key', async () => {
    const existingExecution = {
      id: 'exec-existing',
      ownerId: 'owner-1',
      toJSON: jest.fn().mockReturnValue({ id: 'exec-existing', status: 'queued' }),
    };
    const executionModel = {
      findById: jest.fn().mockResolvedValue(existingExecution),
    };
    const { service, idempotencyService } = createExecutionServiceForTests({ executionModel });
    idempotencyService.reserve.mockResolvedValue({ type: 'duplicate', executionId: 'exec-existing' });

    const result = await service.start('flow-1', 'owner-1', { brief: 'same' }, 'idem-1');

    expect(result).toEqual({ id: 'exec-existing', status: 'queued' });
    expect(executionModel.findById).toHaveBeenCalledWith('exec-existing');
  });

  it('returns the existing execution for a duplicate idempotency key before validating model override', async () => {
    const existingExecution = {
      id: 'exec-existing',
      ownerId: 'owner-1',
      toJSON: jest.fn().mockReturnValue({ id: 'exec-existing', status: 'queued' }),
    };
    const executionModel = {
      findById: jest.fn().mockResolvedValue(existingExecution),
    };
    const { service, idempotencyService } = createExecutionServiceForTests({ executionModel });
    idempotencyService.reserve.mockResolvedValue({ type: 'duplicate', executionId: 'exec-existing' });
    (service as any).modelsService = {
      validateModelActive: jest.fn().mockResolvedValue({ valid: false, model: null, inactive: true }),
    };

    const result = await service.start('flow-1', 'owner-1', { brief: 'same' }, 'idem-1', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'inactive-model-id');

    expect(result).toEqual({ id: 'exec-existing', status: 'queued' });
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
      {} as any,
      { updateOne: jest.fn(), deleteMany: jest.fn() } as any,
      { create: jest.fn(), deleteMany: jest.fn() } as any,
      { get: jest.fn((key: string, fallback: unknown) => fallback) } as any,
      { admit: jest.fn(), release: jest.fn(), refreshPositions: jest.fn() } as any,
      idempotencyService as any,
      { findOne: jest.fn().mockResolvedValue({ nodes: [], controlEdges: [], dataBindings: [], settings: {} }) } as any,
      { buildSnapshot: jest.fn().mockReturnValue({ settings: { recursionLimit: 25, maxParallelism: 5 } }) } as any,
      { validate: jest.fn() } as any,
      { buildGrpcAgentsForPlaybook: jest.fn() } as any,
      { cacheOwner: jest.fn(), emitExecutionQueued: jest.fn() } as any,
      new PlaybookFlowObservabilityService(
        new PlaybookFlowTraceRedactionService(),
        new PlaybookFlowPublicReasoningParserService(),
      ) as any,
      {} as any,
      { resolveReplayArtifacts: async () => new Map() } as any,
      { buildReplayPromptSection: () => '' } as any,
      { buildCurrentReplayFingerprints: jest.fn() } as any,
      { evaluateReplayEligibility: jest.fn() } as any,
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

  it('uses the model override in replay eligibility fingerprints', async () => {
    const replayReportService = {
      createPreRunReport: jest.fn().mockResolvedValue(undefined),
      updateStructuralDrift: jest.fn().mockResolvedValue(undefined),
      findLatestReportForExecutionTask: jest.fn().mockResolvedValue(null),
    };
    const replayPromptService = { buildReplayPromptSection: jest.fn().mockReturnValue('APPLY_REPLAY') };
    const replayEligibilityService = {
      evaluateReplayEligibility: jest.fn().mockReturnValue({
        applied: true,
        confidenceScore: 100,
        confidenceFactors: {},
        invalidationReasons: [],
        appliedSections: ['tool_policy'],
        skippedSections: [],
      }),
    };
    const replayBaselineService = {
      buildCurrentReplayFingerprints: jest.fn().mockReturnValue({ nodeSnapshotHash: 'node-a' }),
    };
    const snapshot = {
      nodes: [{ id: 'step-1', kind: 'step', metadata: { agent_model: 'baseline-model' } }],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    };
    const { service, agentService } = createExecutionServiceForTests({
      replayArtifactService: {
        resolveReplayArtifacts: async () => new Map([['step-1', {
          taskId: 'step-1',
          replayId: 'replay-1',
          validationVersion: 3,
          mode: 'replay_strict',
          referenceOutput: null,
          outputFormatGuide: null,
          toolCalls: [],
          reasoningChain: [],
          fingerprints: { nodeSnapshotHash: 'node-a' },
          behaviorBaseline: null,
          toolPolicy: null,
          outputContract: null,
          replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false },
        }]]) },
      executionModel: {
        updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) })),
        findById: jest.fn(() => ({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ executionMode: 'replay_strict', stepExecutionModes: { 'step-1': 'replay_strict' }, modelIdOverride: 'override-model' }),
          }),
        })),
        findByIdAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) })),
      },
      replayPromptService,
      replayBaselineService,
      replayEligibilityService,
      replayReportService,
    });
    const run = jest.fn();
    (service as any).playbookFlowClient = { Run: run };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', snapshot, {}, snapshot);

    expect(replayBaselineService.buildCurrentReplayFingerprints).toHaveBeenCalledWith(expect.objectContaining({
      nodeSnapshot: expect.objectContaining({
        modelId: 'override-model',
        metadata: expect.objectContaining({ agent_model: 'override-model' }),
      }),
      flowSnapshot: expect.objectContaining({
        nodes: [expect.objectContaining({
          modelId: 'override-model',
          metadata: {},
        })],
      }),
    }));
  });

  it('ignores runtime agent enrichment when building replay_flex fingerprints', async () => {
    const replayReportService = {
      createPreRunReport: jest.fn().mockResolvedValue(undefined),
      findLatestReportForExecutionTask: jest.fn().mockResolvedValue(null),
    };
    const replayPromptService = { buildReplayPromptSection: jest.fn().mockReturnValue('APPLY_REPLAY') };
    const replayEligibilityService = {
      evaluateReplayEligibility: jest.fn().mockReturnValue({
        applied: true,
        confidenceScore: 100,
        confidenceFactors: {
          nodeSnapshotHash: 30,
          modelConfigHash: 20,
          flowSnapshotHash: 5,
          toolConfigHash: 20,
          outputContractHash: 15,
          inputContextHash: 10,
        },
        invalidationReasons: [],
        appliedSections: ['decision_invariants', 'tool_policy'],
        skippedSections: [],
      }),
    };
    const replayBaselineService = {
      buildCurrentReplayFingerprints: jest.fn().mockReturnValue({
        inputContextHash: 'input-a',
        flowSnapshotHash: 'flow-runtime',
        nodeSnapshotHash: 'node-runtime',
        agentConfigHash: null,
        modelConfigHash: 'model-runtime',
        toolConfigHash: 'tool-a',
        outputContractHash: 'contract-a',
      }),
    };
    const snapshot = {
      settings: {},
      nodes: [{ id: 'step-1', kind: 'step', metadata: { assignedAgentId: 'agent-1' } }],
      controlEdges: [],
      dataBindings: [],
    };
    const { service, agentService, replayPromptService: replayPromptSpy, replayBaselineService: replayBaselineSpy, replayReportService: replayReportSpy } = createExecutionServiceForTests({
      flowService: {
        findOne: jest.fn().mockResolvedValue({
          settings: {},
          nodes: [{ id: 'step-1', kind: 'step', metadata: { assignedAgentId: 'agent-1' } }],
          controlEdges: [],
          dataBindings: [],
        }),
      },
      builderService: {
        buildSnapshot: jest.fn().mockReturnValue(snapshot),
      },
      replayArtifactService: {
        resolveReplayArtifacts: async () => new Map([['step-1', {
          taskId: 'step-1',
          replayId: 'replay-1',
          validationVersion: 3,
          mode: 'replay_flex',
          isStale: false,
          staleReasons: [],
          referenceOutput: null,
          outputFormatGuide: null,
          intentKey: null,
          intentLabel: null,
          reasoningOutline: [],
          stableReasoningRules: [],
          contextVariableSchema: [],
          toolTraceTemplate: [],
          semanticChecklist: [],
          driftPolicy: null,
          toolCalls: [],
          reasoningChain: [],
          fingerprints: {
            inputContextHash: 'input-a',
            flowSnapshotHash: 'flow-baseline',
            nodeSnapshotHash: 'node-baseline',
            agentConfigHash: null,
            modelConfigHash: 'model-baseline',
            toolConfigHash: 'tool-a',
            outputContractHash: 'contract-a',
          },
          behaviorBaseline: null,
          toolPolicy: null,
          outputContract: null,
          replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false },
        }]]) },
      executionModel: {
        updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) })),
        findById: jest.fn(() => ({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ executionMode: 'replay_flex', stepExecutionModes: { 'step-1': 'replay_flex' }, modelIdOverride: null }),
          }),
        })),
        findByIdAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) })),
      },
      replayPromptService,
      replayBaselineService,
      replayEligibilityService,
      replayReportService,
    });
    const run = jest.fn();
    (service as any).playbookFlowClient = { Run: run };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([{ id: 'agent-1', name: 'Agent 1', chatbot: { model: 'runtime-model' } }]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', snapshot, {});

    expect(replayBaselineSpy.buildCurrentReplayFingerprints).toHaveBeenCalledWith(expect.objectContaining({
      nodeSnapshot: expect.objectContaining({
        metadata: expect.objectContaining({ assignedAgentId: 'agent-1' }),
      }),
      flowSnapshot: expect.objectContaining({
        nodes: [expect.objectContaining({
          metadata: expect.objectContaining({ assignedAgentId: 'agent-1' }),
        })],
      }),
    }));
    expect(replayReportSpy.createPreRunReport).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'replay_flex',
      eligibility: expect.objectContaining({
        applied: true,
        invalidationReasons: [],
      }),
    }));
    expect(replayPromptSpy.buildReplayPromptSection).toHaveBeenCalled();
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
        applied: true,
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
    const executionModel = {
      updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
      findByIdAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) })),
      findById: jest.fn()
        .mockReturnValueOnce({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ executionMode: 'replay_strict', stepExecutionModes: { 'step-1': 'replay_strict' } }),
          }),
        })
        .mockReturnValueOnce({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ executionMode: 'replay_strict', singleStepTaskId: null }),
          }),
        })
        .mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }),
          }),
        }),
    };
    const snapshot = {
      nodes: [{ id: 'step-1', kind: 'step', metadata: {} }],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    };
    const { service, taskResultModel, agentService } = createExecutionServiceForTests({
      replayArtifactService,
      replayReportService,
      executionModel,
    });
    taskResultModel.updateOne.mockResolvedValue(undefined);
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
    const savedExecution = {
      id: 'exec-new',
      queuePosition: 0,
      save: jest.fn().mockResolvedValue(undefined),
      toJSON: jest.fn().mockReturnValue({ id: 'exec-new' }),
    };
    savedExecution.save = jest.fn().mockResolvedValue(savedExecution);
    const ExecutionModel = jest.fn(() => savedExecution) as any;
    ExecutionModel.findByIdAndDelete = jest.fn();
    const idempotencyService = {
      reserve: jest.fn().mockResolvedValue({ type: 'reserved' }),
      confirmLink: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PlaybookFlowExecutionService(
      ExecutionModel,
      { updateOne: jest.fn(), deleteMany: jest.fn() } as any,
      { create: jest.fn(), deleteMany: jest.fn() } as any,
      { get: jest.fn((key: string, fallback: unknown) => fallback) } as any,
      { admit: jest.fn().mockResolvedValue(1), release: jest.fn(), refreshPositions: jest.fn().mockResolvedValue([]) } as any,
      idempotencyService as any,
      { findOne: jest.fn().mockResolvedValue({ nodes: [], controlEdges: [], dataBindings: [], settings: {} }) } as any,
      { buildSnapshot: jest.fn().mockReturnValue({ settings: {}, nodes: [], controlEdges: [], dataBindings: [] }) } as any,
      { validate: jest.fn() } as any,
      { buildGrpcAgentsForPlaybook: jest.fn() } as any,
      { cacheOwner: jest.fn(), emitExecutionQueued: jest.fn() } as any,
      new PlaybookFlowObservabilityService(
        new PlaybookFlowTraceRedactionService(),
        new PlaybookFlowPublicReasoningParserService(),
      ) as any,
      {} as any,
      { resolveReplayArtifacts: async () => new Map() } as any,
      { buildReplayPromptSection: () => '' } as any,
      { buildCurrentReplayFingerprints: jest.fn() } as any,
      { evaluateReplayEligibility: jest.fn() } as any,
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
    const drainQueueSpy = jest.spyOn(service as any, 'drainQueue').mockResolvedValue(undefined);
    agentService.buildGrpcAgentsForPlaybook.mockRejectedValue(new Error('bootstrap failed'));

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', {
      nodes: [],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    }, {});

    expect(drainQueueSpy).toHaveBeenCalledWith('owner-1');
    drainQueueSpy.mockRestore();
  });

  it('does not start gRPC when a claimed execution is cancelled before launch', async () => {
    const { service, agentService, executionModel, streamEvents } = createExecutionServiceForTests({
      flowService: { findOne: jest.fn().mockResolvedValue({ settings: {}, nodes: [], controlEdges: [], dataBindings: [] }) },
      builderService: { buildSnapshot: jest.fn().mockReturnValue({ settings: {}, nodes: [], controlEdges: [], dataBindings: [] }) },
      executionModel: {
        updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) })),
        findById: jest.fn(() => ({ lean: () => ({ exec: jest.fn().mockResolvedValue({ ownerId: 'owner-1', status: 'cancelled' }) }) })),
        findByIdAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) })),
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

    expect(executionModel.updateOne).toHaveBeenCalledWith(
      { _id: 'exec-1', status: 'running' },
      expect.objectContaining({ queuePosition: 0 }),
    );
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
      executionModel: {
        updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
        findById: jest.fn()
          .mockReturnValueOnce({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue({
                singleStepTaskId: null,
                executionMode: 'inherit',
                stepExecutionModes: { 'step-1': 'replay_flex' },
                modelIdOverride: null,
                replayPlanningByTask: null,
              }),
            }),
          })
          .mockReturnValueOnce({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue({
                singleStepTaskId: null,
                advisorAutopilotEnabled: false,
                advisorAutopilotTargetScore: 90,
                advisorAutopilotMaxTurns: 4,
                reflectionEnabled: false,
                advisorScoringMode: 'llm',
                executionMode: 'inherit',
                stepExecutionModes: { 'step-1': 'replay_flex' },
                replayPlanningByTask: null,
              }),
            }),
          })
          .mockReturnValueOnce({
            lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }),
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
      }),
    );
  });

  it('does not fail running executions during startup without ownership proof', async () => {
    const executionModel = {
      updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
      findById: jest.fn(() => ({ lean: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }) })),
      updateMany: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 3 }) })),
    };
    const { service } = createExecutionServiceForTests({ executionModel });
    (service as any).isGrpcAvailable = true;
    Object.defineProperty(service as any, 'executionModel', { value: executionModel });

    await (service as any).reconcileOrphanedExecutions();

    expect(executionModel.updateMany).not.toHaveBeenCalled();
  });

  it('recovers queued executions until all available concurrency slots are filled', async () => {
    let countDocsCallCount = 0;
    const executionModel = {
      updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
      findById: jest.fn(() => ({ lean: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }) })),
      findByIdAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) })),
      distinct: jest.fn().mockResolvedValue(['owner-1']),
      countDocuments: jest.fn().mockImplementation(() => {
        countDocsCallCount++;
        return Promise.resolve(countDocsCallCount === 1 ? 3 : 0);
      }),
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
    const { service } = createExecutionServiceForTests({ executionModel, queueService, flowService });
    (service as any).isGrpcAvailable = true;

    const callGrpcRunSpy = jest.spyOn(service as any, 'callGrpcRun').mockResolvedValue(undefined);

    await (service as any).recoverQueuedExecutions();

    expect(executionModel.distinct).toHaveBeenCalledWith('ownerId', { status: 'queued' });
    expect(callGrpcRunSpy).toHaveBeenCalledTimes(3);
    callGrpcRunSpy.mockRestore();
  });

  it('drainQueue continues draining after a flow-not-found failure', async () => {
    const executionModel = {
      updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
      findById: jest.fn(() => ({ lean: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }) })),
      findByIdAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) })),
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
    const { service, streamEvents } = createExecutionServiceForTests({ executionModel, queueService, flowService });
    (service as any).isGrpcAvailable = true;

    const callGrpcRunSpy = jest.spyOn(service as any, 'callGrpcRun').mockResolvedValue(undefined);

    await (service as any).drainQueue('owner-1');

    expect(executionModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'exec-missing',
      expect.objectContaining({ status: 'failed', error: 'Flow not found before runtime start' }),
    );
    expect(flowService.findOne).toHaveBeenCalledTimes(2);
    expect(callGrpcRunSpy).toHaveBeenCalledTimes(1);
    expect(callGrpcRunSpy).toHaveBeenCalledWith('exec-ok', 'flow-ok', 'owner-1', { settings: {} }, {}, undefined);
    callGrpcRunSpy.mockRestore();
  });
});

describe('unwrapGrpcValue', () => {
  const { service } = createExecutionServiceForTests();
  const unwrap = (v: unknown) => (service as any).unwrapGrpcValue(v);

  it('passes through null and undefined', () => {
    expect(unwrap(null)).toBeNull();
    expect(unwrap(undefined)).toBeUndefined();
  });

  it('passes through primitives', () => {
    expect(unwrap('hello')).toBe('hello');
    expect(unwrap(42)).toBe(42);
    expect(unwrap(true)).toBe(true);
  });

  it('recurses into plain arrays', () => {
    expect(unwrap([1, 'two', true])).toEqual([1, 'two', true]);
  });

  it('unwraps selector-less Struct { fields: {...} }', () => {
    const input = {
      fields: {
        name: { kind: 'stringValue', stringValue: 'Alan' },
        score: { kind: 'numberValue', numberValue: 100 },
      },
    };
    expect(unwrap(input)).toEqual({ name: 'Alan', score: 100 });
  });

  it('unwraps selector-less Value with stringValue', () => {
    expect(unwrap({ stringValue: 'test' })).toBe('test');
  });

  it('unwraps selector-less Value with numberValue', () => {
    expect(unwrap({ numberValue: 3.14 })).toBe(3.14);
  });

  it('unwraps selector-less Value with boolValue', () => {
    expect(unwrap({ boolValue: true })).toBe(true);
  });

  it('unwraps selector-less Value with nullValue', () => {
    expect(unwrap({ nullValue: 'NULL_VALUE' })).toBeNull();
  });

  it('unwraps selector-less listValue', () => {
    const input = {
      listValue: {
        values: [
          { kind: 'stringValue', stringValue: 'a' },
          { kind: 'numberValue', numberValue: 1 },
        ],
      },
    };
    expect(unwrap(input)).toEqual(['a', 1]);
  });

  it('unwraps selector-less structValue', () => {
    const input = {
      structValue: {
        fields: {
          key: { kind: 'stringValue', stringValue: 'val' },
        },
      },
    };
    expect(unwrap(input)).toEqual({ key: 'val' });
  });

  it('unwraps kind-tagged structValue', () => {
    const input = {
      kind: 'structValue',
      structValue: {
        fields: {
          key: { kind: 'stringValue', stringValue: 'val' },
        },
      },
    };
    expect(unwrap(input)).toEqual({ key: 'val' });
  });

  it('unwraps kind-tagged listValue', () => {
    const input = {
      kind: 'listValue',
      listValue: {
        values: [
          { kind: 'numberValue', numberValue: 7 },
          { kind: 'numberValue', numberValue: 14 },
        ],
      },
    };
    expect(unwrap(input)).toEqual([7, 14]);
  });

  it('unwraps kind-tagged scalar values', () => {
    expect(unwrap({ kind: 'numberValue', numberValue: 99 })).toBe(99);
    expect(unwrap({ kind: 'stringValue', stringValue: 's' })).toBe('s');
    expect(unwrap({ kind: 'boolValue', boolValue: false })).toBe(false);
    expect(unwrap({ kind: 'nullValue' })).toBeNull();
  });

  it('unwraps deeply nested Struct with 3+ levels', () => {
    const input = {
      fields: {
        output: {
          kind: 'structValue',
          structValue: {
            fields: {
              metadata: {
                kind: 'structValue',
                structValue: {
                  fields: {
                    fields: {
                      kind: 'structValue',
                      structValue: {
                        fields: {
                          preserved: { kind: 'boolValue', boolValue: true },
                        },
                      },
                    },
                  },
                },
              },
              items: {
                kind: 'listValue',
                listValue: {
                  values: [
                    { kind: 'numberValue', numberValue: 1 },
                    { kind: 'stringValue', stringValue: 'two' },
                    { kind: 'nullValue' },
                  ],
                },
              },
              empty: {
                kind: 'structValue',
                structValue: { fields: {} },
              },
            },
          },
        },
      },
    };
    expect(unwrap(input)).toEqual({
      output: {
        metadata: { fields: { preserved: true } },
        items: [1, 'two', null],
        empty: {},
      },
    });
  });

  it('recurse-unwraps plain objects (proto-loader auto-unwrapped)', () => {
    const input = {
      a: { kind: 'stringValue', stringValue: 'x' },
      b: { kind: 'numberValue', numberValue: 2 },
      nested: {
        x: { kind: 'boolValue', boolValue: true },
      },
    };
    expect(unwrap(input)).toEqual({
      a: 'x',
      b: 2,
      nested: { x: true },
    });
  });

  it('unwraps real round-trip: toGrpcStruct → unwrapGrpcValue', () => {
    const original = {
      metadata: { fields: { preserved: true } },
      items: [1, null, 'three'],
    };
    const wrapped = toGrpcStruct(original);
    const unwrapped = unwrap(wrapped);
    expect(unwrapped).toEqual(original);
  });
});
