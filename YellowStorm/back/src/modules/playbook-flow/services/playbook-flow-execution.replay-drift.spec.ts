import { createExecutionServiceForTests } from './playbook-flow-execution.test-support';

describe('PlaybookFlowExecutionService replay drift handling', () => {
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
});
