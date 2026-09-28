import { PlaybookFlowExecutionController } from '../controllers/playbook-flow-execution.controller';
import { PlaybookFlowReplayController } from '../controllers/playbook-flow-replay.controller';
import { PlaybookFlowExecutionService } from './playbook-flow-execution.service';
import { PlaybookFlowReplayService } from './playbook-flow-replay.service';
import { PlaybookFlowReplayArtifactService } from './playbook-flow-replay-artifact.service';
import { PlaybookFlowReplayBaselineService } from './playbook-flow-replay-baseline.service';
import { PlaybookFlowReplayHashService } from './playbook-flow-replay-hash.service';
import { PlaybookFlowReplayPlanService } from './playbook-flow-replay-plan.service';
import { PlaybookFlowReplayPromptService } from './playbook-flow-replay-prompt.service';
import { PlaybookFlowReplayReportService } from './playbook-flow-replay-report.service';
import { PlaybookFlowReplayDriftService } from './playbook-flow-replay-drift.service';
import { PlaybookFlowOutputContractService } from './playbook-flow-output-contract.service';
import { PlaybookFlowObservabilityService } from './observability/playbook-flow-observability.service';
import { PlaybookFlowPublicReasoningParserService } from './observability/playbook-flow-public-reasoning-parser.service';
import { PlaybookFlowTraceRedactionService } from './observability/playbook-flow-trace-redaction.service';
import {
  createExecutionRepositoryMock,
  createRouterDecisionRepositoryMock,
  createTaskResultRepositoryMock,
} from './playbook-flow-execution.test-support';

const FLOW_ID = 'aaaaaaaaaaaaaaaaaaaaaaa1';

function clone<T>(value: T): T {
  return structuredClone(value);
}

type Row = Record<string, any>;

/** In-memory stand-ins for the repositories: just enough state for one validate-then-replay round trip. */
function createReplayWorkflowHarness() {
  const executions = new Map<string, Row>();
  const taskResults = new Map<string, Row>();
  const replays: Row[] = [];
  const reports: Row[] = [];
  let executionSequence = 1;
  let replaySequence = 1;
  let reportSequence = 1;

  const baselineSnapshot = {
    nodes: [{ id: 'step-1', kind: 'step', modelId: 'gpt-5.4-mini', metadata: {}, prompt: 'Summarize the search result.' }],
    controlEdges: [],
    dataBindings: [],
    settings: { recursionLimit: 25, maxParallelism: 5 },
    workspaces: [],
  };

  executions.set('exec-baseline', {
    id: 'exec-baseline',
    ownerId: 'owner-1',
    flowId: FLOW_ID,
    status: 'completed',
    inputContext: { query: 'hello' },
    snapshot: clone(baselineSnapshot),
    schemaVersion: 1,
    hitlEvents: [],
    executionMode: 'live',
    stepExecutionModes: {},
    replayPlanningByTask: {},
    modelIdOverride: null,
  });
  taskResults.set('exec-baseline:step-1:0', {
    id: 'tr-baseline',
    executionId: 'exec-baseline',
    taskId: 'step-1',
    iteration: 0,
    status: 'completed',
    output: '# Summary\nhello',
    toolTrace: [{ callIndex: 0, toolName: 'search', status: 'completed', args: {}, outputSummary: 'ok' }],
    reasoningChain: [],
    llmPromptTrace: [],
    usage: null,
    semanticMatch: null,
    traceMetadata: {},
  });

  const readExecution = (id: string, options?: { withSnapshot?: boolean }): Row | null => {
    const execution = executions.get(id);
    if (!execution) return null;
    const copy = clone(execution);
    if (!options?.withSnapshot) delete copy.snapshot;
    return copy;
  };
  const executionRepository = createExecutionRepositoryMock({
    insert: jest.fn(async (input: Row) => {
      const id = `exec-replay-${executionSequence++}`;
      const record = {
        id, status: 'queued', queuePosition: 0, hitlEvents: [], pendingApproval: null, replayPlanningByTask: {}, stepExecutionModes: {},
        createdAt: new Date(), updatedAt: new Date(), ...clone(input),
      };
      executions.set(id, record);
      return clone(record);
    }),
    findById: jest.fn(async (id: string, options?: { withSnapshot?: boolean }) => readExecution(id, options)),
    findOwned: jest.fn(async (id: string, ownerId: string, options?: { withSnapshot?: boolean }) => (executions.get(id)?.ownerId === ownerId ? readExecution(id, options) : null)),
    update: jest.fn(async (id: string, patch: Row) => {
      const execution = executions.get(id);
      if (!execution) return false;
      Object.assign(execution, clone(patch));
      return true;
    }),
    transition: jest.fn(async (id: string, change: { from?: string[]; patch: Row }) => {
      const execution = executions.get(id);
      if (!execution || (change.from && !change.from.includes(execution.status))) return false;
      Object.assign(execution, clone(change.patch));
      return true;
    }),
    markStarted: jest.fn(async (id: string, replayPlanningByTask: Row) => {
      const execution = executions.get(id);
      if (!execution || execution.status !== 'running') return false;
      Object.assign(execution, { startedAt: new Date(), queuePosition: 0, replayPlanningByTask: clone(replayPlanningByTask) });
      return true;
    }),
    markFailed: jest.fn(async (id: string, error: string) => {
      const execution = executions.get(id);
      if (!execution) return false;
      Object.assign(execution, { status: 'failed', error, endedAt: new Date() });
      return true;
    }),
  });

  const taskResultKey = (key: { executionId: string; taskId: string; iteration: number }) => `${key.executionId}:${key.taskId}:${key.iteration}`;
  const taskResultRepository = createTaskResultRepositoryMock({
    find: jest.fn(async (key: { executionId: string; taskId: string; iteration: number }) => {
      const found = taskResults.get(taskResultKey(key));
      return found ? clone(found) : null;
    }),
    listForExecution: jest.fn(async (executionId: string) => [...taskResults.values()].filter((row) => row.executionId === executionId).map(clone)),
    upsert: jest.fn(async (key: { executionId: string; taskId: string; iteration: number }, set: Row, setOnInsert: Row = {}) => {
      const existing = taskResults.get(taskResultKey(key));
      taskResults.set(taskResultKey(key), existing ? { ...existing, ...clone(set) } : { id: `tr-${taskResults.size + 1}`, ...key, ...clone(setOnInsert), ...clone(set) });
      return true;
    }),
  });

  const replayRepository = {
    createNextVersion: jest.fn(async (input: Row) => {
      const inTask = replays.filter((replay) => replay.flowId === input.flowId && replay.taskId === input.taskId);
      const last = [...inTask].sort((left, right) => right.validationVersion - left.validationVersion)[0];
      const replay = { ...clone(input), id: `replay-${replaySequence++}`, validationVersion: (last?.validationVersion ?? 0) + 1, createdAt: new Date(), updatedAt: new Date() };
      replays.push(replay);
      if (last) last.status = 'inactive';
      return clone(replay);
    }),
    listActiveForTasks: jest.fn(async (flowId: string, taskIds: string[]) => replays.filter((replay) => replay.flowId === flowId && taskIds.includes(replay.taskId) && replay.status === 'active').map(clone)),
    findActive: jest.fn(async (flowId: string, taskId: string) => clone(replays.find((replay) => replay.flowId === flowId && replay.taskId === taskId && replay.status === 'active') ?? null)),
    findByIdentity: jest.fn(async (identity: Row) => clone(replays.find((replay) => replay.id === identity.id && replay.validationVersion === identity.validationVersion) ?? null)),
  };

  const reportRepository = {
    create: jest.fn(async (input: Row) => {
      const report = { ...clone(input), id: `report-${reportSequence}`, iteration: input.iteration ?? 0, createdAt: new Date(reportSequence * 1000), updatedAt: new Date(reportSequence * 1000) };
      reportSequence += 1;
      reports.push(report);
      return clone(report);
    }),
    update: jest.fn(async (id: string, patch: Row) => {
      const report = reports.find((entry) => entry.id === id);
      if (!report) return false;
      Object.assign(report, clone(patch));
      return true;
    }),
    findLatest: jest.fn(async (filter: Row) => clone([...reports]
      .filter((report) => report.executionId === filter.executionId && report.taskId === filter.taskId
        && (filter.iteration === undefined || report.iteration === filter.iteration)
        && (filter.replayId === undefined || report.replayId === filter.replayId)
        && (filter.validationVersion === undefined || report.validationVersion === filter.validationVersion))
      .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null)),
    list: jest.fn(async (query: Row) => [...reports]
      .filter((report) => report.flowId === query.flowId && report.taskId === query.taskId
        && (query.executionId === undefined || report.executionId === query.executionId)
        && (query.iteration === undefined || report.iteration === query.iteration))
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(query.offset, query.offset + query.limit)
      .map(clone)),
    latestScoresForReplays: jest.fn(async () => new Map()),
  };

  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const outputContractService = new PlaybookFlowOutputContractService();
  const replayBaselineService = new PlaybookFlowReplayBaselineService(new PlaybookFlowReplayHashService(), outputContractService);
  const replayService = new PlaybookFlowReplayService(
    executionRepository as any,
    taskResultRepository as any,
    createRouterDecisionRepositoryMock() as any,
    replayRepository as any,
    { start: jest.fn() } as any,
    replayBaselineService,
    logger as any,
  );
  const replayArtifactService = new PlaybookFlowReplayArtifactService(replayRepository as any, logger as any, new PlaybookFlowReplayHashService());
  const replayReportService = new PlaybookFlowReplayReportService(reportRepository as any);
  const replayDriftService = new PlaybookFlowReplayDriftService(
    executionRepository as any,
    replayReportService,
    outputContractService,
    new PlaybookFlowReplayPlanService(),
    logger as any,
  );

  const streamHandlers: Record<string, (data?: unknown) => void> = {};
  const runCall: { on: jest.Mock } = { on: jest.fn() };
  runCall.on.mockImplementation((event: string, handler: (data?: unknown) => void) => {
    streamHandlers[event] = handler;
    return runCall;
  });
  const mockRun = jest.fn().mockReturnValue(runCall);
  const releasedExecutions = new Set<string>();
  const flowForStart = { nodes: clone(baselineSnapshot.nodes), controlEdges: [], dataBindings: [], settings: baselineSnapshot.settings };

  const executionService = new PlaybookFlowExecutionService(
    executionRepository as any,
    taskResultRepository as any,
    createRouterDecisionRepositoryMock() as any,
    { get: jest.fn((_: string, fallback: unknown) => fallback) } as any,
    {
      init: jest.fn(),
      isAvailable: jest.fn().mockReturnValue(true),
      run: jest.fn(),
      runFromCheckpoint: jest.fn(),
      cancel: jest.fn(),
      resumeApproval: jest.fn(),
      resumeFromStep: jest.fn(),
    } as any,
    {
      admit: jest.fn().mockResolvedValue(1),
      release: jest.fn().mockImplementation(async (ownerId: string) => {
        const next = Array.from(executions.values()).find((execution) => (
          execution.ownerId === ownerId
          && execution.status === 'queued'
          && !releasedExecutions.has(execution.id)
        ));
        if (!next) {
          return null;
        }
        releasedExecutions.add(next.id);
        next.status = 'running';
        return clone(next);
      }),
      refreshPositions: jest.fn().mockResolvedValue([]),
      getRunningCount: jest.fn().mockResolvedValue(0),
    } as any,
    { reserve: jest.fn().mockResolvedValue({ type: 'reserved' }), confirmLink: jest.fn(), release: jest.fn() } as any,
    { findOne: jest.fn().mockResolvedValue(clone(flowForStart)), findOneForExecutionStart: jest.fn().mockResolvedValue(clone(flowForStart)) } as any,
    { buildSnapshot: jest.fn().mockReturnValue(clone(baselineSnapshot)) } as any,
    { validate: jest.fn(), collectValidationErrors: jest.fn().mockReturnValue([]) } as any,
    { buildGrpcAgentsForPlaybook: jest.fn().mockResolvedValue([]) } as any,
    {
      emitExecutionComplete: jest.fn(),
      emitExecutionStart: jest.fn(),
      emitRouterDecision: jest.fn(),
      emitQueuePositionUpdate: jest.fn(),
      emitStepComplete: jest.fn(),
      emitStepStart: jest.fn(),
      emitStepUpdate: jest.fn(),
      emitInterrupt: jest.fn(),
      cacheOwner: jest.fn(),
      emitExecutionQueued: jest.fn(),
      emitExecutionCancelled: jest.fn(),
    } as any,
    new PlaybookFlowObservabilityService(new PlaybookFlowTraceRedactionService(), new PlaybookFlowPublicReasoningParserService()) as any,
    {} as any,
    replayArtifactService,
    new PlaybookFlowReplayPromptService(),
    replayReportService,
    outputContractService,
    { validateModelActive: jest.fn().mockResolvedValue({ valid: true, model: null, inactive: false }) } as any,
    undefined as any,
    new PlaybookFlowReplayPlanService(),
    replayDriftService,
  );
  (executionService as any).isGrpcAvailable = true;
  (executionService as any).playbookFlowClient = { Run: mockRun };

  return {
    replayController: new PlaybookFlowReplayController(replayService, replayDriftService, replayReportService, { findOneForWrite: jest.fn().mockResolvedValue({ id: FLOW_ID }) } as any),
    executionController: new PlaybookFlowExecutionController(executionService, replayService, { requestArtifactAccess: jest.fn() } as any),
    reports,
    replays,
    mockRun,
    triggerEvents: async () => {
      const settle = async () => new Promise((resolve) => setImmediate(resolve));
      while (mockRun.mock.calls.length === 0 || !streamHandlers.data || !streamHandlers.end) {
        await settle();
      }
      streamHandlers.data({ event_type: 'NodeStarted', node_id: 'step-1', iteration: 0, payload: {} });
      await settle();
      streamHandlers.data({
        event_type: 'NodeCompleted',
        node_id: 'step-1',
        iteration: 0,
        payload: {
          output: '# Summary\nhello',
          displayText: '# Summary\nhello',
          toolTrace: [{ callIndex: 0, toolName: 'search', status: 'completed', args: {}, outputSummary: 'ok' }],
          reasoningChain: [],
          llmPromptTrace: [],
          semanticMatch: {
            matchScore: 91,
            semanticSimilarityScore: 90,
            evidenceConsistencyScore: 89,
            judgeScore: 93,
            reason: 'Replay output matches the captured intent',
            missingPoints: ['minor citation detail'],
            changedPoints: ['section phrasing'],
            model: 'judge-model',
            judgeUsed: true,
          },
          traceMetadata: {},
        },
      });
      await settle();
      streamHandlers.data({ event_type: 'ExecutionCompleted', node_id: '', iteration: 0, payload: {} });
      await settle();
      streamHandlers.end();
      await settle();
      await settle();
    },
  };
}

describe('E2E: Replay workflow', () => {
  it('validates a baseline, runs replay_strict, and returns a populated replay report', async () => {
    const harness = createReplayWorkflowHarness();

    const replay = await harness.replayController.validateTaskReplay('owner-1', FLOW_ID, 'step-1', {
      iteration: 0,
      executionId: 'exec-baseline',
      mode: 'replay_strict',
    } as any);

    expect(replay.fingerprints?.flowSnapshotHash).toEqual(expect.any(String));
    expect(replay.fingerprints?.nodeSnapshotHash).toEqual(expect.any(String));
    expect(replay.fingerprints?.modelConfigHash).toEqual(expect.any(String));
    expect(replay).toMatchObject({ validationVersion: 1, status: 'active', mode: 'replay_strict', referenceOutput: '# Summary\nhello' });

    const started = await harness.executionController.start('owner-1', FLOW_ID, {
      inputContext: { query: 'hello' },
      executionMode: 'replay_strict',
    } as any);

    await harness.triggerEvents();

    const runArgs = harness.mockRun.mock.calls[0][0];
    const replayNode = runArgs.snapshot.nodes[0];
    expect(replayNode.metadata.fields.execution_mode.stringValue).toBe('replay_strict');
    const replayInstructions = replayNode.metadata.fields.replay_instructions?.stringValue;
    if (typeof replayInstructions === 'string') {
      expect(replayInstructions).toContain('### Validated Tool Policy');
      expect(replayInstructions).toContain('Use tool: search');
    }

    const reports = await harness.replayController.listReplayReports('user-1', FLOW_ID, 'step-1', {
      executionId: started.executionId,
      limit: 5,
      offset: 0,
    } as any);

    expect(harness.replays).toHaveLength(1);
    expect(harness.reports).toHaveLength(1);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toEqual(expect.objectContaining({
      id: expect.any(String),
      executionId: started.executionId,
      taskId: 'step-1',
      replayId: replay.id,
    }));
  }, 15000);
});
