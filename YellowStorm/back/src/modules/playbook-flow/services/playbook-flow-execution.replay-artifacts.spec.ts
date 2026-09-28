import { createExecutionServiceForTests } from './playbook-flow-execution.test-support';

describe('PlaybookFlowExecutionService replay artifact handling', () => {
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
    const executionRepository = {
      findById: jest.fn().mockResolvedValue({ flowId: 'flow-1', ownerId: 'owner-1' }),
    };
    const { service } = createExecutionServiceForTests({
      replayArtifactService,
      replayReportService,
      executionRepository,
    });
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

  it('does not resolve replay artifacts on completion when no replay report exists', async () => {
    const replayReportService = {
      createPreRunReport: jest.fn().mockResolvedValue(undefined),
      updateStructuralDrift: jest.fn().mockResolvedValue(undefined),
      updateSemanticMatch: jest.fn().mockResolvedValue(undefined),
      findLatestReportForExecutionTask: jest.fn().mockResolvedValue(null),
    };
    const replayArtifactService = {
      resolveReplayArtifactByIdentity: jest.fn().mockResolvedValue(null),
    };
    const { service } = createExecutionServiceForTests({
      replayArtifactService,
      replayReportService,
    });
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

  it('backfills semanticMatch on the replay report when step produces semantic evaluation without resolvable artifacts', async () => {
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
      }),
    };
    const replayArtifactService = {
      resolveReplayArtifactByIdentity: jest.fn().mockResolvedValue(null),
    };
    const { service } = createExecutionServiceForTests({
      replayArtifactService,
      replayReportService,
    });
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
    const { service } = createExecutionServiceForTests({
      replayArtifactService,
      replayReportService,
    });
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

  it('resolves tracked replay artifacts by identity when the completion cache misses', async () => {
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
      resolveReplayArtifactByIdentity: jest.fn().mockResolvedValue(null),
    };
    const { service } = createExecutionServiceForTests({
      replayArtifactService,
      replayReportService,
    });
    (service as any).trackReplayTask('exec-1', 'step-1');

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeCompleted',
      node_id: 'step-1',
      iteration: 0,
      payload: { output: 'Completed' },
    });

    expect(replayReportService.findLatestReportForExecutionTask).toHaveBeenCalledWith('exec-1', 'step-1', 0);
    expect(replayArtifactService.resolveReplayArtifactByIdentity).toHaveBeenCalledWith({
      flowId: 'flow-1',
      taskId: 'step-1',
      replayId: 'replay-1',
      validationVersion: 2,
    });
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
    // The run was claimed away (no longer running) before its start could be stamped.
    const executionRepository = {
      markStarted: jest.fn().mockResolvedValue(false),
      findById: jest.fn().mockResolvedValue({ executionMode: 'replay_strict', stepExecutionModes: { 'step-1': 'replay_strict' } }),
    };
    const snapshot = {
      nodes: [{ id: 'step-1', kind: 'step', metadata: {} }],
      controlEdges: [],
      dataBindings: [],
      settings: {},
    };
    const { service, agentService } = createExecutionServiceForTests({
      executionRepository,
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
    expect((service as any).hasTrackedReplayTask('exec-1', 'step-1')).toBe(false);
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
      }),
    };
    const { service } = createExecutionServiceForTests({ replayReportService });

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
    const { service, streamEvents } = createExecutionServiceForTests({ replayReportService });
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
      [],
      [],
      expect.objectContaining({
        semanticMatch: null,
        toolTrace: [],
        reasoningChain: [],
        traceMetadata: expect.any(Object),
      }),
    );
  });
});
