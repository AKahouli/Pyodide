import { PlaybookFlowReplayDriftService } from './playbook-flow-replay-drift.service';
import { PlaybookFlowReplayReportService } from './playbook-flow-replay-report.service';
import { PlaybookFlowOutputContractService } from './playbook-flow-output-contract.service';
import { PlaybookFlowReplayPlanService } from './playbook-flow-replay-plan.service';

describe('PlaybookFlowReplayDriftService', () => {
  /** An execution repository whose runs carry the given HITL events (answered clarifications on task-1 by default). */
  const executionsWithHitl = (byExecution: Record<string, unknown[]>) => ({
    findById: jest.fn(async (executionId: string) => ({ id: executionId, hitlEvents: byExecution[executionId] ?? [], replayPlanningByTask: {} })),
  });

  function createService(overrides?: {
    executionRepository?: Record<string, unknown>;
    hitlMemoryRepository?: Record<string, unknown>;
    replayReportService?: Record<string, unknown>;
    streamEvents?: Record<string, unknown>;
  }) {
    const executionRepository = {
      findById: jest.fn().mockResolvedValue(null),
      ...overrides?.executionRepository,
    };
    const replayReportService = {
      createReport: jest.fn().mockResolvedValue({ id: 'report-1' }),
      updateReport: jest.fn().mockResolvedValue(undefined),
      findLatestReportRecord: jest.fn().mockResolvedValue(null),
      ...overrides?.replayReportService,
    };
    const loggerService = { setContext: jest.fn(), warn: jest.fn(), log: jest.fn(), error: jest.fn() };

    const service = new PlaybookFlowReplayDriftService(
      executionRepository as any,
      replayReportService as unknown as PlaybookFlowReplayReportService,
      new PlaybookFlowOutputContractService(),
      new PlaybookFlowReplayPlanService(),
      loggerService as any,
      undefined,
      overrides?.hitlMemoryRepository as any,
      overrides?.streamEvents as any,
    );

    return { service, executionRepository, hitlMemoryRepository: overrides?.hitlMemoryRepository, replayReportService, loggerService };
  }

  it('persists a pre-run replay report without eligibility gating', async () => {
    const { service, replayReportService } = createService();

    await service.createPreRunReport({
      executionId: 'exec-1',
      flowId: 'flow-1',
      taskId: 'task-1',
      replayId: 'replay-1',
      referenceExecutionId: 'baseline-exec-1',
      validationVersion: 2,
      mode: 'replay_strict',
    });

    expect(replayReportService.createReport).toHaveBeenCalledWith(expect.objectContaining({
      executionId: 'exec-1',
      flowId: 'flow-1',
      taskId: 'task-1',
      replayId: 'replay-1',
      outputContractEvaluated: false,
      outputContractPassed: false,
      structuralDriftScore: null,
      toolPolicyScore: null,
      verdict: 'unknown',
      overallScore: null,
      verdictReasons: ['evaluation_pending'],
      structuralDriftReasons: [],
      semanticMatch: null,
      contextDrift: null,
      dataDrift: null,
    }));
    expect(replayReportService.createReport).toHaveBeenCalledWith(expect.not.objectContaining({
      applied: expect.anything(),
      confidenceScore: expect.anything(),
      invalidationReasons: expect.anything(),
    }));
  });

  it('counts active baseline HITL memories in the replay HITL summary', async () => {
    const countActiveFromExecution = jest.fn().mockResolvedValue(2);
    const emitReplayHitlSummaryUpdated = jest.fn();
    const { service, replayReportService } = createService({
      executionRepository: executionsWithHitl({
        'baseline-exec-1': [
          { nodeId: 'task-1', type: 'clarification', status: 'answered' },
          { nodeId: 'task-1', type: 'clarification', status: 'pending' },
          { nodeId: 'task-2', type: 'clarification', status: 'answered' },
        ],
      }),
      hitlMemoryRepository: { countActiveFromExecution },
      replayReportService: { createReport: jest.fn().mockResolvedValue({ id: 'report-9' }) },
      streamEvents: { emitReplayHitlSummaryUpdated },
    });

    const report = await service.createPreRunReport({
      executionId: 'exec-1',
      flowId: 'flow-1',
      taskId: 'task-1',
      replayId: 'replay-1',
      referenceExecutionId: 'baseline-exec-1',
      validationVersion: 2,
      mode: 'replay_flex',
    });

    expect(countActiveFromExecution).toHaveBeenCalledWith('flow-1', 'task-1', 'baseline-exec-1');
    expect(replayReportService.createReport).toHaveBeenCalledWith(expect.objectContaining({
      hitlSummary: expect.objectContaining({
        baselineHitlCount: 1,
        runtimeHitlCount: 0,
        reusedMemoryCount: 2,
        hitlContextDrift: true,
        findings: [{ severity: 'info', message: 'baseline_hitl_reused_or_not_needed', nodeId: 'task-1' }],
      }),
    }));
    expect(report).toEqual({ id: 'report-9' });
    expect(emitReplayHitlSummaryUpdated).toHaveBeenCalledWith('exec-1', expect.objectContaining({ reportId: 'report-9', taskId: 'task-1', executionMode: 'replay_flex' }));
  });

  it('counts no reusable memory without a HITL memory repository', async () => {
    const { service, replayReportService } = createService();

    await service.createPreRunReport({
      executionId: 'exec-1',
      flowId: 'flow-1',
      taskId: 'task-1',
      replayId: 'replay-1',
      referenceExecutionId: 'baseline-exec-1',
      validationVersion: 2,
      mode: 'replay_strict',
    });

    expect(replayReportService.createReport).toHaveBeenCalledWith(expect.objectContaining({
      hitlSummary: expect.objectContaining({ baselineHitlCount: 0, runtimeHitlCount: 0, reusedMemoryCount: 0, hitlContextDrift: false, findings: [] }),
    }));
  });

  it('prefers reusable replay HITL snapshots over baseline memory candidates after artifacts load', async () => {
    const countActiveFromExecution = jest.fn().mockResolvedValue(3);
    const { service, replayReportService } = createService({
      executionRepository: executionsWithHitl({
        'baseline-exec-1': [{ nodeId: 'task-1', type: 'clarification', status: 'answered' }],
      }),
      hitlMemoryRepository: { countActiveFromExecution },
      replayReportService: {
        findLatestReportRecord: jest.fn().mockResolvedValue({
          id: 'report-1',
          mode: 'replay_strict',
        }),
      },
    });

    await service.recordCompletedTaskDrift({
      executionId: 'exec-1',
      taskId: 'task-1',
      iteration: 0,
      output: 'some output',
      toolTrace: [],
      reasoningChain: [],
      semanticMatch: null,
      replayArtifacts: {
        taskId: 'task-1',
        replayId: 'replay-1',
        referenceExecutionId: 'baseline-exec-1',
        validationVersion: 1,
        mode: 'replay_strict',
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
        fingerprints: null,
        behaviorBaseline: null,
        toolPolicy: null,
        outputContract: null,
        replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: true },
        hitlMemorySnapshots: [
          {
            interruptId: 'interrupt-1',
            nodeId: 'task-1',
            iteration: 0,
            type: 'clarification',
            blockerKind: 'missing_document',
            reasonCode: 'missing_document',
            prompt: 'Which document?',
            responseAction: 'reply',
            responseMessage: 'Use signed.pdf',
            responseScope: 'downstream_run',
            downstreamNodeIds: ['task-2'],
            reusableInReplay: true,
            contextFingerprint: 'fingerprint-1',
          },
          {
            interruptId: 'interrupt-2',
            nodeId: 'task-1',
            iteration: 0,
            type: 'approval_request',
            blockerKind: 'external_send',
            reasonCode: 'external_send',
            prompt: 'Approve send?',
            responseAction: 'approve',
            responseMessage: null,
            responseScope: 'step_only',
            downstreamNodeIds: [],
            reusableInReplay: false,
            contextFingerprint: 'fingerprint-2',
          },
        ],
      },
      traceMetadata: null,
    });

    expect(countActiveFromExecution).not.toHaveBeenCalled();
    expect(replayReportService.updateReport).toHaveBeenCalledWith(
      'report-1',
      expect.objectContaining({
        hitlSummary: expect.objectContaining({
          baselineHitlCount: 1,
          reusedMemoryCount: 1,
        }),
      }),
    );
  });

  it('materializes later iterations from pre-run state instead of copying prior evaluation results', async () => {
    const { service, replayReportService } = createService({
      replayReportService: {
        findLatestReportRecord: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'report-1',
            executionId: 'exec-1',
            flowId: 'flow-1',
            taskId: 'task-1',
            iteration: 0,
            replayId: 'replay-1',
            validationVersion: 2,
            mode: 'replay_flex',
            outputContractEvaluated: true,
            outputContractPassed: true,
            structuralDriftScore: 100,
            toolPolicyScore: 100,
            verdict: 'pass',
            overallScore: 95,
            verdictReasons: [],
            structuralDriftReasons: [],
            semanticMatch: { matchScore: 99 },
            replayConfidence: 95,
            toolSequenceMatch: 100,
            argumentShapeMatch: 100,
            reasoningMatch: 100,
            outputFormatMatch: 100,
            contextDrift: null,
            dataDrift: 99,
            driftFindings: [],
            blockedBy: [],
            createdAt: new Date('2026-01-01T00:00:00Z'),
            updatedAt: new Date('2026-01-01T00:00:00Z'),
          }),
        createReport: jest.fn().mockResolvedValue({ id: 'report-2' }),
      },
    });

    await service.ensureIterationReportMaterialized('exec-1', 'task-1', 2);

    expect(replayReportService.findLatestReportRecord).toHaveBeenNthCalledWith(1, { executionId: 'exec-1', taskId: 'task-1', iteration: 2 });
    expect(replayReportService.findLatestReportRecord).toHaveBeenNthCalledWith(2, { executionId: 'exec-1', taskId: 'task-1' });
    expect(replayReportService.createReport).toHaveBeenCalledWith(expect.objectContaining({
      executionId: 'exec-1',
      replayId: 'replay-1',
      iteration: 2,
      verdict: 'unknown',
      overallScore: null,
      semanticMatch: null,
      replayConfidence: null,
      contextDrift: null,
    }));
    const clone = replayReportService.createReport.mock.calls[0][0];
    expect(clone).not.toHaveProperty('id');
    expect(clone).not.toHaveProperty('createdAt');
    expect(clone).not.toHaveProperty('updatedAt');
  });

  it('does not materialize an iteration when the run has no report for the task', async () => {
    const { service, replayReportService } = createService();

    await service.ensureIterationReportMaterialized('exec-1', 'task-1', 3);

    expect(replayReportService.findLatestReportRecord).toHaveBeenCalledTimes(2);
    expect(replayReportService.createReport).not.toHaveBeenCalled();
  });

  it('updates semanticMatch on a replay report and re-derives the verdict from evidence', async () => {
    const { service, replayReportService } = createService({
      replayReportService: {
        findLatestReportRecord: jest.fn().mockResolvedValue({
          id: 'report-1',
          mode: 'replay_flex',
          outputContractEvaluated: false,
          outputContractPassed: false,
          structuralDriftScore: null,
          toolPolicyScore: null,
          structuralDriftReasons: [],
        }),
      },
    });

    await service.backfillSemanticMatch('exec-1', 'task-1', 0, {
      matchScore: 88,
      semanticSimilarityScore: 85,
      evidenceConsistencyScore: 90,
      judgeScore: 87,
      reason: 'Aligned',
      missingPoints: [],
      changedPoints: [],
      model: 'gpt-test',
      judgeUsed: true,
    });

    expect(replayReportService.updateReport).toHaveBeenCalledWith(
      'report-1',
      expect.objectContaining({
        semanticMatch: expect.objectContaining({ matchScore: 88 }),
        verdict: 'pass',
        overallScore: 88,
        verdictReasons: [],
        semanticStatus: { status: 'passed', reason: null },
      }),
    );
  });

  it('backfillSemanticMatch is a no-op when no report exists', async () => {
    const { service, replayReportService } = createService();

    await service.backfillSemanticMatch('exec-1', 'task-1', 0, { matchScore: 90 });

    expect(replayReportService.updateReport).not.toHaveBeenCalled();
  });

  it('backfills semantic evidence when a report exists', async () => {
    const { service, replayReportService } = createService({
      replayReportService: {
        findLatestReportRecord: jest.fn().mockResolvedValue({
          id: 'report-1',
          mode: 'replay_strict',
          outputContractEvaluated: false,
          outputContractPassed: false,
          structuralDriftScore: null,
          toolPolicyScore: null,
          structuralDriftReasons: [],
          replayConfidence: null,
          toolSequenceMatch: null,
          argumentShapeMatch: null,
          reasoningMatch: null,
          outputFormatMatch: null,
          contextDrift: null,
          dataDrift: null,
          driftFindings: [],
          blockedBy: [],
        }),
      },
    });

    await service.backfillSemanticMatch('exec-1', 'task-1', 0, { matchScore: 90 });

    expect(replayReportService.updateReport).toHaveBeenCalled();
  });

  describe('Phase 6: observability and evidence hardening', () => {
    it('logs a WARN and updates report with a pending verdict when no evaluation inputs exist', async () => {
      const { service, replayReportService, loggerService } = createService({
        replayReportService: {
          findLatestReportRecord: jest.fn().mockResolvedValue({
            id: 'report-1',
            mode: 'replay_strict',
          }),
        },
      });

      await service.recordCompletedTaskDrift({
        executionId: 'exec-1',
        taskId: 'task-1',
        iteration: 0,
        output: 'some output',
        toolTrace: [],
        reasoningChain: [],
        semanticMatch: null,
        replayArtifacts: {
          taskId: 'task-1',
          replayId: 'replay-1',
          referenceExecutionId: 'baseline-exec-1',
          validationVersion: 1,
          mode: 'replay_strict',
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
          fingerprints: null,
          behaviorBaseline: null,
          toolPolicy: null,
          outputContract: null,
          replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: true },
        },
        traceMetadata: null,
      });

      expect(loggerService.warn).toHaveBeenCalledWith(
        expect.stringContaining('No evaluation inputs for replay drift'),
      );
      expect(replayReportService.updateReport).toHaveBeenCalledWith(
        'report-1',
        expect.objectContaining({
          verdict: 'unknown',
          overallScore: null,
        }),
      );
    });

    it('infers observed_intent_key from tool trace evidence when trace metadata has none', async () => {
      const countActiveFromExecution = jest.fn().mockResolvedValue(3);
      const { service, replayReportService } = createService({
        hitlMemoryRepository: { countActiveFromExecution },
        executionRepository: {
          findById: jest.fn().mockResolvedValue({
            hitlEvents: [],
            replayPlanningByTask: {
              'task-1': {
                executionPlan: {
                  plannedToolSteps: [],
                  semanticChecklist: [],
                },
                contextMapping: [],
              },
            },
          }),
        },
        replayReportService: {
          findLatestReportRecord: jest.fn().mockResolvedValue({
            id: 'report-1',
            mode: 'replay_flex',
            outputContractEvaluated: false,
            outputContractPassed: false,
            structuralDriftScore: null,
            toolPolicyScore: null,
            structuralDriftReasons: [],
            contextDrift: null,
            dataDrift: null,
            driftFindings: [],
            blockedBy: [],
          }),
        },
      });

      await service.recordCompletedTaskDrift({
        executionId: 'exec-1',
        taskId: 'task-1',
        iteration: 0,
        output: 'test output',
        toolTrace: [{ callIndex: 0, toolName: 'search', args: {}, outputSummary: 'result', status: 'completed', durationMs: 100, error: null }],
        reasoningChain: [{ id: 'r1', type: 'thought', label: 'reason', description: 'reasoning step' }],
        semanticMatch: null,
        replayArtifacts: {
          taskId: 'task-1',
          replayId: 'replay-1',
          referenceExecutionId: 'baseline-exec-1',
          validationVersion: 1,
          mode: 'replay_flex',
          isStale: false,
          staleReasons: [],
          referenceOutput: null,
          outputFormatGuide: null,
          intentKey: 'research_topic',
          intentLabel: 'Research the given topic',
          reasoningOutline: [],
          stableReasoningRules: [],
          contextVariableSchema: [],
          toolTraceTemplate: [],
          semanticChecklist: [],
          driftPolicy: { requireSameIntent: true, requireSameReasoningStages: true, requireSameToolOrder: false, allowAdditionalTools: true, allowArgumentValueChanges: true, enforceOutputContract: true },
          toolCalls: [{ callIndex: 0, toolName: 'search', args: {} }],
          reasoningChain: [],
          fingerprints: null,
          behaviorBaseline: null,
          toolPolicy: null,
          outputContract: null,
          replayConfig: { replayOutputFormat: false, replayToolTrace: false, replayReasoningChain: true },
          hitlMemorySnapshots: [
            {
              interruptId: 'interrupt-1',
              nodeId: 'task-1',
              iteration: 0,
              type: 'clarification',
              blockerKind: 'missing_document',
              reasonCode: 'missing_document',
              prompt: 'Which document?',
              responseAction: 'reply',
              responseMessage: 'Use signed.pdf',
              responseScope: 'downstream_run',
              downstreamNodeIds: ['task-2'],
              reusableInReplay: true,
              contextFingerprint: 'fingerprint-1',
            },
          ],
        },
        traceMetadata: null,
      });

      expect(countActiveFromExecution).not.toHaveBeenCalled();
      expect(replayReportService.updateReport).toHaveBeenCalledWith(
        'report-1',
        expect.objectContaining({
          intentKey: 'research_topic',
          hitlSummary: expect.objectContaining({ reusedMemoryCount: 1 }),
        }),
      );
    });
  });
});
