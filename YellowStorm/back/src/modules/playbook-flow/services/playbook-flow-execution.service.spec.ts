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
import { PlaybookFlowTraceRedactionService } from './observability/playbook-flow-trace-redaction.service';

function createExecutionServiceForTests(overrides?: {
  executionModel?: Record<string, any>;
  queueService?: Record<string, any>;
  flowService?: Record<string, any>;
  streamEvents?: Record<string, any>;
  configService?: Record<string, any>;
  routerDecisionModel?: Record<string, any>;
  builderService?: Record<string, any>;
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
  const observabilityService = new PlaybookFlowObservabilityService(new PlaybookFlowTraceRedactionService());

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
            { id: 'task-1', kind: 'step', metadata: {} },
            { id: 'task-2', kind: 'step', metadata: {} },
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
            { id: 'task-1', kind: 'step', metadata: {} },
            { id: 'task-2', kind: 'step', metadata: {} },
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
      new PlaybookFlowObservabilityService(new PlaybookFlowTraceRedactionService()) as any,
      {} as any,
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
                    { id: 'task-1', kind: 'step', metadata: {} },
                    { id: 'task-2', kind: 'step', metadata: {} },
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
        nodes: [{ id: 'task-2', kind: 'step', metadata: {} }],
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
      new PlaybookFlowObservabilityService(new PlaybookFlowTraceRedactionService()) as any,
      {} as any,
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
            { id: 'task-1', kind: 'step', metadata: {} },
            { id: 'task-2', kind: 'step', metadata: {} },
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
            { id: 'task-1', kind: 'step', metadata: {} },
            { id: 'task-2', kind: 'step', metadata: {} },
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
            { id: 'task-1', kind: 'step', metadata: { version: 2 } },
            { id: 'task-2', kind: 'step', metadata: {} },
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
            { id: 'task-1', kind: 'step', metadata: { version: 2 } },
            { id: 'task-2', kind: 'step', metadata: {} },
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
      new PlaybookFlowObservabilityService(new PlaybookFlowTraceRedactionService()) as any,
      {} as any,
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
                    { id: 'task-1', kind: 'step', metadata: { version: 1 } },
                    { id: 'task-2', kind: 'step', metadata: {} },
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
            { id: 'task-1', kind: 'step', metadata: {} },
            { id: 'task-2', kind: 'step', metadata: {} },
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
            { id: 'task-1', kind: 'step', metadata: {} },
            { id: 'task-2', kind: 'step', metadata: {} },
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
      new PlaybookFlowObservabilityService(new PlaybookFlowTraceRedactionService()) as any,
      {} as any,
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
                    { id: 'task-1', kind: 'step', metadata: {} },
                    { id: 'task-2', kind: 'step', metadata: {} },
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
        output: 'Executive summary',
        display_text: 'Executive summary',
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
      expect.any(Object),
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
      new PlaybookFlowObservabilityService(new PlaybookFlowTraceRedactionService()) as any,
      {} as any,
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
      new PlaybookFlowObservabilityService(new PlaybookFlowTraceRedactionService()) as any,
      {} as any,
    );
    idempotencyService.reserve.mockResolvedValue({ type: 'reserved' });
    jest.spyOn(service as any, 'drainQueue').mockResolvedValue(undefined);

    await service.start('flow-abc', 'owner-1', { brief: 'same' }, 'idem-1');

    expect(idempotencyService.reserve).toHaveBeenCalledWith('owner-1', 'idem-1', {
      flowId: 'flow-abc',
      inputContext: { brief: 'same' },
    });
  });

  it('drains the queue after a pre-stream startup failure without claiming and abandoning work', async () => {
    const { service, agentService } = createExecutionServiceForTests({
      flowService: { findOne: jest.fn().mockResolvedValue({ settings: {}, nodes: [], controlEdges: [], dataBindings: [] }) },
      builderService: { buildSnapshot: jest.fn().mockReturnValue({ settings: {}, nodes: [], controlEdges: [], dataBindings: [] }) },
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
        findById: jest.fn(() => ({ lean: jest.fn().mockResolvedValue({ ownerId: 'owner-1', status: 'cancelled' }) })),
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
