import { createExecutionServiceForTests } from './playbook-flow-execution.test-support';

describe('callGrpcRun replay planning', () => {
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
});
