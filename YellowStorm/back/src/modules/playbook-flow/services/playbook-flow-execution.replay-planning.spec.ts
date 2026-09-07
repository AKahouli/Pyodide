import { createExecutionServiceForTests } from './playbook-flow-execution.test-support';

describe('callGrpcRun replay planning', () => {
  it('applies strict replay even when the baseline node snapshot changed and persists a report', async () => {
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
      replayPromptService,
      replayReportService,
    });
    const runCall = { on: jest.fn() };
    const run = jest.fn().mockReturnValue(runCall);
    (service as any).playbookFlowClient = { Run: run };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', snapshot, {}, snapshot);

    expect(replayReportService.createPreRunReport).toHaveBeenCalledWith(expect.not.objectContaining({ eligibility: expect.anything() }));
    expect(replayPromptService.buildReplayPromptSection).toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: expect.objectContaining({
        nodes: [expect.not.objectContaining({ metadata: expect.objectContaining({ replay_instructions: expect.anything() }) })],
      }),
    }));
  });

  it('applies adaptive replay and persists a report', async () => {
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

  it('applies replay instructions from saved node replay mode when run request has no step modes', async () => {
    const replayReportService = { createPreRunReport: jest.fn().mockResolvedValue(undefined), updateStructuralDrift: jest.fn().mockResolvedValue(undefined) };
    const replayPromptService = { buildReplayPromptSection: jest.fn().mockReturnValue('SAVED_MODE_REPLAY') };
    const snapshot = {
      nodes: [{ id: 'step-1', kind: 'step', metadata: { stepReplayMode: 'replay_flex' } }],
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
          mode: 'replay_flex',
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
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ executionMode: 'live', stepExecutionModes: {} }) }) })
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ executionMode: 'live' }) }) })
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }) })
          .mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }) }),
      },
      replayPromptService,
      replayReportService,
    });
    const runCall = { on: jest.fn() };
    const run = jest.fn().mockReturnValue(runCall);
    (service as any).playbookFlowClient = { Run: run };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', snapshot, {}, snapshot);

    expect(replayPromptService.buildReplayPromptSection).toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: expect.objectContaining({
        nodes: [expect.objectContaining({
          metadata: expect.objectContaining({
            fields: expect.objectContaining({
              execution_mode: expect.objectContaining({ stringValue: 'replay_flex' }),
              replay_instructions: expect.objectContaining({ stringValue: 'SAVED_MODE_REPLAY' }),
            }),
          }),
        })],
      }),
    }));
  });

  it('keeps explicit live step mode above saved replay mode', async () => {
    const replayReportService = { createPreRunReport: jest.fn().mockResolvedValue(undefined), updateStructuralDrift: jest.fn().mockResolvedValue(undefined) };
    const replayPromptService = { buildReplayPromptSection: jest.fn().mockReturnValue('SHOULD_NOT_APPLY') };
    const snapshot = {
      nodes: [{ id: 'step-1', kind: 'step', metadata: { stepReplayMode: 'replay_flex' } }],
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
          mode: 'replay_flex',
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
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ executionMode: 'inherit', stepExecutionModes: { 'step-1': 'live' } }) }) })
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ executionMode: 'inherit', stepExecutionModes: { 'step-1': 'live' } }) }) })
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }) })
          .mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }) }),
      },
      replayPromptService,
      replayReportService,
    });
    const runCall = { on: jest.fn() };
    const run = jest.fn().mockReturnValue(runCall);
    (service as any).playbookFlowClient = { Run: run };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', snapshot, {}, snapshot);

    expect(replayPromptService.buildReplayPromptSection).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: expect.objectContaining({
        nodes: [expect.objectContaining({
          metadata: expect.objectContaining({
            fields: expect.objectContaining({
              execution_mode: expect.objectContaining({ stringValue: 'live' }),
            }),
          }),
        })],
      }),
    }));
  });

  it('applies requested flex replay even when the active baseline was validated as strict', async () => {
    const replayReportService = { createPreRunReport: jest.fn().mockResolvedValue(undefined), updateStructuralDrift: jest.fn().mockResolvedValue(undefined) };
    const replayPromptService = { buildReplayPromptSection: jest.fn().mockReturnValue('FLEX_FROM_STRICT_BASELINE') };
    const snapshot = {
      nodes: [{
        id: 'step-1',
        kind: 'step',
        label: 'Generate AI Summary PDF',
        metadata: { description: 'generate a summary about AI in two sentences', stepReplayMode: 'replay_flex' },
      }],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    };
    const { service, agentService } = createExecutionServiceForTests({
      replayArtifactService: {
        resolveReplayArtifacts: async () => new Map([['step-1', {
          taskId: 'step-1',
          replayId: 'replay-1',
          validationVersion: 1,
          mode: 'replay_strict',
          referenceOutput: 'Artificial intelligence summary.',
          outputFormatGuide: null,
          intentKey: 'generate-ai-summary',
          intentLabel: 'Generate AI Summary PDF',
          reasoningOutline: [],
          stableReasoningRules: ['Preserve concise summary.'],
          contextVariableSchema: [],
          toolTraceTemplate: [],
          semanticChecklist: [],
          hitlMemorySnapshots: [],
          driftPolicy: null,
          toolCalls: [],
          reasoningChain: [],
          fingerprints: null,
          behaviorBaseline: { decisionInvariants: ['Keep two-sentence AI summary'], qualityChecks: [], knownFailureModes: [], behaviorSummary: '' },
          toolPolicy: null,
          outputContract: null,
          replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false },
          isStale: false,
          staleReasons: [],
        }]]) },
      executionModel: {
        updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
        findById: jest.fn()
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ executionMode: 'inherit', stepExecutionModes: { 'step-1': 'replay_flex' } }) }) })
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ executionMode: 'inherit', stepExecutionModes: { 'step-1': 'replay_flex' } }) }) })
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }) })
          .mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }) }),
      },
      replayPromptService,
      replayReportService,
    });
    const runCall = { on: jest.fn() };
    const run = jest.fn().mockReturnValue(runCall);
    (service as any).playbookFlowClient = { Run: run };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', snapshot, {}, snapshot);

    expect(replayPromptService.buildReplayPromptSection).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'replay_flex',
      artifacts: expect.objectContaining({ mode: 'replay_strict' }),
    }));
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: expect.objectContaining({
        nodes: [expect.objectContaining({
          metadata: expect.objectContaining({
            fields: expect.objectContaining({
              execution_mode: expect.objectContaining({ stringValue: 'replay_flex' }),
              replay_instructions: expect.objectContaining({ stringValue: 'FLEX_FROM_STRICT_BASELINE' }),
            }),
          }),
        })],
      }),
    }));
  });

  it('falls back to exact active replay lookup when batch artifact resolution misses a replay-mode node', async () => {
    const replayReportService = { createPreRunReport: jest.fn().mockResolvedValue(undefined), updateStructuralDrift: jest.fn().mockResolvedValue(undefined) };
    const replayPromptService = { buildReplayPromptSection: jest.fn().mockReturnValue('EXACT_LOOKUP_REPLAY') };
    const resolveActiveReplayArtifact = jest.fn().mockResolvedValue({
      taskId: 'step-1',
      replayId: 'replay-1',
      validationVersion: 1,
      mode: 'replay_flex',
      referenceOutput: 'Artificial intelligence summary.',
      outputFormatGuide: null,
      toolCalls: [],
      reasoningChain: [],
      fingerprints: null,
      behaviorBaseline: { decisionInvariants: ['Keep two-sentence AI summary'], qualityChecks: [], knownFailureModes: [], behaviorSummary: '' },
      toolPolicy: null,
      outputContract: null,
      replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: false },
      isStale: false,
      staleReasons: [],
    });
    const snapshot = {
      nodes: [{ id: 'step-1', kind: 'step', label: 'Generate AI Summary PDF', metadata: { stepReplayMode: 'replay_flex' } }],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    };
    const { service, agentService } = createExecutionServiceForTests({
      replayArtifactService: {
        resolveReplayArtifacts: jest.fn().mockResolvedValue(new Map()),
        resolveActiveReplayArtifact,
      },
      executionModel: {
        updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
        findById: jest.fn()
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ executionMode: 'inherit', stepExecutionModes: { 'step-1': 'replay_flex' } }) }) })
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ executionMode: 'inherit', stepExecutionModes: { 'step-1': 'replay_flex' } }) }) })
          .mockReturnValueOnce({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }) })
          .mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seededTaskOutputs: [] }) }) }),
      },
      replayPromptService,
      replayReportService,
    });
    const runCall = { on: jest.fn() };
    const run = jest.fn().mockReturnValue(runCall);
    (service as any).playbookFlowClient = { Run: run };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', snapshot, {}, snapshot);

    expect(resolveActiveReplayArtifact).toHaveBeenCalledWith('flow-1', 'step-1');
    expect(replayPromptService.buildReplayPromptSection).toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: expect.objectContaining({
        nodes: [expect.objectContaining({
          metadata: expect.objectContaining({
            fields: expect.objectContaining({
              replay_instructions: expect.objectContaining({ stringValue: 'EXACT_LOOKUP_REPLAY' }),
            }),
          }),
        })],
      }),
    }));
  });

  it('applies replay flex with unresolved context substitutions and persists replay planning', async () => {
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
      replayPromptService,
      replayReportService,
    });
    const runCall = { on: jest.fn() };
    const run = jest.fn().mockReturnValue(runCall);
    (service as any).playbookFlowClient = { Run: run };
    agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

    await (service as any).callGrpcRun('exec-1', 'flow-1', 'owner-1', snapshot, { ticker: 'NVDA' }, snapshot);

    expect(replayReportService.createPreRunReport).toHaveBeenCalledWith(expect.not.objectContaining({ eligibility: expect.anything() }));
    expect(replayPromptService.buildReplayPromptSection).toHaveBeenCalled();
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
});
