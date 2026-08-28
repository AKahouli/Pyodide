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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function createAwaitableResult<T>(value: T) {
  const promise = Promise.resolve(clone(value));
  return {
    exec: jest.fn().mockResolvedValue(clone(value)),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
}

function createQuery<T>(value: T) {
  return {
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockImplementation(() => createAwaitableResult(value)),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function createExecutionQuery<T extends Record<string, any> | null>(value: T) {
  let selected = '';
  const resolve = () => {
    if (!value) {
      return value;
    }
    const next = clone(value);
    if (!selected.includes('+snapshot')) {
      delete next.snapshot;
    }
    return next;
  };
  const query = {
    select: jest.fn().mockImplementation((selection: string) => {
      selected = selection;
      return query;
    }),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockImplementation(() => createAwaitableResult(resolve())),
    exec: jest.fn().mockImplementation(async () => resolve()),
  };
  return query;
}

function createReplayWorkflowHarness() {
  const executions = new Map<string, any>();
  const taskResults = new Map<string, any>();
  const replays: any[] = [];
  const reports: any[] = [];
  const releasedExecutions = new Set<string>();
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
    _id: 'exec-baseline',
    id: 'exec-baseline',
    ownerId: 'owner-1',
    flowId: 'flow-1',
    status: 'completed',
    inputContext: { query: 'hello' },
    snapshot: clone(baselineSnapshot),
    schemaVersion: 1,
    executionMode: 'live',
    stepExecutionModes: {},
  });
  taskResults.set('exec-baseline:step-1:0', {
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

  const ExecutionModel = jest.fn().mockImplementation((data: any) => {
    const id = data.id ?? `exec-replay-${executionSequence++}`;
    const serializeDoc = () => ({
      ...clone(data),
      _id: id,
      id,
    });
    const doc = {
      ...clone(data),
      _id: id,
      id,
      toJSON: jest.fn().mockImplementation(serializeDoc),
      save: jest.fn().mockImplementation(async () => {
        executions.set(id, serializeDoc());
        return doc;
      }),
    };
    return doc;
  }) as any;

  ExecutionModel.findOne = jest.fn((filter: Record<string, any>) => {
    const match = Array.from(executions.values()).find((execution) => (
      (filter._id == null || execution._id === filter._id)
      && (filter.ownerId == null || execution.ownerId === filter.ownerId)
      && (filter.flowId == null || execution.flowId === filter.flowId)
    )) ?? null;
    return createExecutionQuery(match);
  });
  ExecutionModel.findById = jest.fn((id: string) => createExecutionQuery(executions.get(id) ?? null));
  ExecutionModel.findByIdAndDelete = jest.fn((id: string) => ({
    exec: jest.fn().mockImplementation(async () => {
      executions.delete(id);
      return null;
    }),
  }));
  ExecutionModel.updateOne = jest.fn((filter: Record<string, any>, update: Record<string, any>) => ({
    exec: jest.fn().mockImplementation(async () => {
      const execution = executions.get(filter._id);
      if (!execution) return { modifiedCount: 0 };
      if (filter.status && execution.status !== filter.status) return { modifiedCount: 0 };
      Object.assign(execution, clone(update.$set ?? update));
      executions.set(filter._id, execution);
      return { modifiedCount: 1 };
    }),
  }));
  ExecutionModel.updateMany = jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) }));
  ExecutionModel.deleteMany = jest.fn().mockResolvedValue({ deletedCount: 0 });
  ExecutionModel.countDocuments = jest.fn().mockResolvedValue(0);

  const taskResultModel = {
    findOne: jest.fn((filter: Record<string, any>) => createQuery(taskResults.get(`${filter.executionId}:${filter.taskId}:${filter.iteration}`) ?? null)),
    updateOne: jest.fn(async (filter: Record<string, any>, update: Record<string, any>) => {
      const key = `${filter.executionId}:${filter.taskId}:${filter.iteration}`;
      const existing = taskResults.get(key) ?? {};
      taskResults.set(key, {
        ...existing,
        ...(update.$setOnInsert ?? {}),
        ...(update.$set ?? {}),
      });
      return { acknowledged: true };
    }),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  };

  const replayModel = {
    findOne: jest.fn((filter: Record<string, any>) => {
      const match = [...replays]
        .filter((replay) => replay.flowId === filter.flowId && replay.taskId === filter.taskId)
        .sort((left, right) => (right.validationVersion ?? 0) - (left.validationVersion ?? 0))[0] ?? null;
      return {
        sort: jest.fn().mockReturnValue(createQuery(match)),
      };
    }),
    find: jest.fn((filter: Record<string, any>) => {
      const taskIds = Array.isArray(filter.taskId?.$in)
        ? filter.taskId.$in
        : [filter.taskId].filter(Boolean);
      const items = replays.filter((replay) => (
        replay.flowId === filter.flowId
        && (taskIds.length === 0 || taskIds.includes(replay.taskId))
        && (filter.status == null || replay.status === filter.status)
      ));
      return {
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(clone(items)) }),
        exec: jest.fn().mockResolvedValue(items),
      };
    }),
    create: jest.fn(async (docs: any[]) => docs.map((entry) => {
      const replay = { ...clone(entry), _id: `replay-${replaySequence++}` };
      replays.push(replay);
      return replay;
    })),
    updateOne: jest.fn(async (filter: Record<string, any>, update: Record<string, any>) => {
      const replay = replays.find((entry) => entry._id === filter._id);
      if (!replay) return { modifiedCount: 0 };
      Object.assign(replay, clone(update.$set ?? update));
      return { modifiedCount: 1 };
    }),
    updateMany: jest.fn(async (filter: Record<string, any>, update: Record<string, any>) => {
      let modifiedCount = 0;
      for (const replay of replays) {
        if (replay.flowId === filter.flowId && replay.taskId === filter.taskId && replay.status === filter.status) {
          Object.assign(replay, clone(update.$set ?? update));
          modifiedCount += 1;
        }
      }
      return { modifiedCount };
    }),
    findOneAndUpdate: jest.fn(),
    deleteOne: jest.fn(),
  };

  const replayRunReportModel = {
    create: jest.fn(async (docs: any[]) => docs.map((entry) => {
      const report = { ...clone(entry), _id: `report-${reportSequence++}`, createdAt: new Date(reportSequence * 1000) };
      reports.push(report);
      return report;
    })),
    find: jest.fn((filter: Record<string, any>) => {
      const items = reports.filter((report) => (
        report.flowId === filter.flowId
        && report.taskId === filter.taskId
        && (filter.executionId == null || report.executionId === filter.executionId)
      )).sort((left, right) => Number(right.createdAt) - Number(left.createdAt));
      let offset = 0;
      let limit = items.length;
      const query = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockImplementation((value: number) => { offset = value; return query; }),
        limit: jest.fn().mockImplementation((value: number) => { limit = value; return query; }),
        exec: jest.fn().mockImplementation(async () => items.slice(offset, offset + limit).map((report) => ({
          ...report,
          toJSON: () => ({ ...clone(report), id: report._id }),
        }))),
      };
      return query;
    }),
    findOne: jest.fn((filter: Record<string, any>) => ({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(
            [...reports]
              .filter((report) => (
                report.executionId === filter.executionId
                && report.taskId === filter.taskId
                && report.replayId === filter.replayId
                && report.validationVersion === filter.validationVersion
              ))
              .sort((left, right) => Number(right.createdAt) - Number(left.createdAt))[0] ?? null,
          ),
        }),
      }),
    })),
    updateOne: jest.fn((filter: Record<string, any>, update: Record<string, any>) => ({
      exec: jest.fn().mockImplementation(async () => {
        const report = reports.find((entry) => entry._id === filter._id);
        if (!report) return { modifiedCount: 0 };
        Object.assign(report, clone(update.$set ?? update));
        return { modifiedCount: 1 };
      }),
    })),
  };

  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const outputContractService = new PlaybookFlowOutputContractService();
  const replayBaselineService = new PlaybookFlowReplayBaselineService(new PlaybookFlowReplayHashService(), outputContractService);
  const replayService = new PlaybookFlowReplayService(
    ExecutionModel,
    taskResultModel as any,
    { find: jest.fn() } as any,
    replayModel as any,
    { start: jest.fn() } as any,
    replayBaselineService,
    logger as any,
  );
  const replayArtifactService = new PlaybookFlowReplayArtifactService(replayModel as any, logger as any, new PlaybookFlowReplayHashService());
  const replayReportService = new PlaybookFlowReplayReportService(replayRunReportModel as any);
  const replayDriftService = new PlaybookFlowReplayDriftService(
    ExecutionModel as any,
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

  const executionService = new PlaybookFlowExecutionService(
    ExecutionModel,
    taskResultModel as any,
    { create: jest.fn(), deleteMany: jest.fn() } as any,
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
        executions.set(next.id, next);
        return clone(next);
      }),
      refreshPositions: jest.fn().mockResolvedValue([]),
      getRunningCount: jest.fn().mockResolvedValue(0),
    } as any,
    { reserve: jest.fn().mockResolvedValue({ type: 'reserved' }), confirmLink: jest.fn(), release: jest.fn() } as any,
    { findOne: jest.fn().mockResolvedValue({ nodes: clone(baselineSnapshot.nodes), controlEdges: [], dataBindings: [], settings: baselineSnapshot.settings }) } as any,
    { buildSnapshot: jest.fn().mockReturnValue(clone(baselineSnapshot)) } as any,
    { validate: jest.fn() } as any,
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
    replayController: new PlaybookFlowReplayController(replayService, replayDriftService, replayReportService, { findOneForWrite: jest.fn().mockResolvedValue({ id: 'flow-1' }) } as any),
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

    const replay = await harness.replayController.validateTaskReplay('owner-1', 'flow-1', 'step-1', {
      iteration: 0,
      executionId: 'exec-baseline',
      mode: 'replay_strict',
    } as any);

    expect(replay.fingerprints?.flowSnapshotHash).toEqual(expect.any(String));
    expect(replay.fingerprints?.nodeSnapshotHash).toEqual(expect.any(String));
    expect(replay.fingerprints?.modelConfigHash).toEqual(expect.any(String));

    const started = await harness.executionController.start('owner-1', 'flow-1', {
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

    const reports = await harness.replayController.listReplayReports('user-1', 'flow-1', 'step-1', {
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
      replayId: replay._id,
    }));
  }, 15000);
});
