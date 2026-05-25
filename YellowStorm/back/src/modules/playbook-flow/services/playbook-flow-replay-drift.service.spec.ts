import { PlaybookFlowReplayDriftService } from './playbook-flow-replay-drift.service';
import { PlaybookFlowReplayReportService } from './playbook-flow-replay-report.service';
import { PlaybookFlowOutputContractService } from './playbook-flow-output-contract.service';
import { PlaybookFlowReplayPlanService } from './playbook-flow-replay-plan.service';

describe('PlaybookFlowReplayDriftService', () => {
  function createService(overrides?: {
    executionModel?: Record<string, unknown>;
    replayReportService?: Record<string, unknown>;
  }) {
    const executionModel = {
      findById: jest.fn(() => ({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      })),
      ...overrides?.executionModel,
    };
    const replayReportService = {
      createReport: jest.fn().mockResolvedValue({ id: 'report-1' }),
      updateReport: jest.fn().mockResolvedValue(undefined),
      findLatestReportRecord: jest.fn().mockResolvedValue(null),
      ...overrides?.replayReportService,
    };
    const loggerService = { setContext: jest.fn(), warn: jest.fn(), log: jest.fn(), error: jest.fn() };

    const service = new PlaybookFlowReplayDriftService(
      executionModel as any,
      replayReportService as unknown as PlaybookFlowReplayReportService,
      new PlaybookFlowOutputContractService(),
      new PlaybookFlowReplayPlanService(),
      loggerService as any,
    );

    return { service, executionModel, replayReportService, loggerService };
  }

  it('persists a pre-run replay report', async () => {
    const { service, replayReportService } = createService();

    await service.createPreRunReport({
      executionId: 'exec-1',
      flowId: 'flow-1',
      taskId: 'task-1',
      replayId: 'replay-1',
      validationVersion: 2,
      mode: 'replay_strict',
      eligibility: {
        applied: false,
        confidenceScore: 60,
        confidenceFactors: { nodeSnapshotHash: 0 },
        invalidationReasons: ['node_snapshot_mismatch'],
        appliedSections: [],
        skippedSections: ['decision_invariants'],
      },
    });

    expect(replayReportService.createReport).toHaveBeenCalledWith(expect.objectContaining({
      executionId: 'exec-1',
      flowId: 'flow-1',
      taskId: 'task-1',
      replayId: 'replay-1',
      applied: false,
      confidenceScore: 60,
      invalidationReasons: ['node_snapshot_mismatch'],
      outputContractEvaluated: false,
      outputContractPassed: false,
      structuralDriftScore: null,
      toolPolicyScore: null,
      verdict: 'skipped',
      overallScore: null,
      verdictReasons: ['replay_not_applied'],
      structuralDriftReasons: [],
      semanticMatch: null,
      contextSubstitutionStatus: { status: 'warning', reason: 'replay_not_applied' },
      semanticStatus: { status: 'not_evaluated', reason: 'replay_not_applied' },
    }));
  });

  it('marks skipped reports with a failed context substitution signal when confidence is too low', async () => {
    const { service, replayReportService } = createService();

    await service.createPreRunReport({
      executionId: 'exec-1',
      flowId: 'flow-1',
      taskId: 'task-1',
      replayId: 'replay-1',
      validationVersion: 2,
      mode: 'replay_flex',
      eligibility: {
        applied: false,
        confidenceScore: 45,
        confidenceFactors: { nodeSnapshotHash: 0 },
        invalidationReasons: ['confidence_below_threshold'],
        appliedSections: [],
        skippedSections: ['tool_policy'],
      },
    });

    expect(replayReportService.createReport).toHaveBeenCalledWith(expect.objectContaining({
      contextSubstitutionStatus: { status: 'failed', reason: 'confidence_below_threshold' },
      toolSequenceStatus: { status: 'not_evaluated', reason: 'confidence_below_threshold' },
      semanticStatus: { status: 'not_evaluated', reason: 'confidence_below_threshold' },
    }));
  });

  it('marks skipped reports with a failed context substitution signal when required substitutions are unresolved', async () => {
    const { service, replayReportService } = createService();

    await service.createPreRunReport({
      executionId: 'exec-1',
      flowId: 'flow-1',
      taskId: 'task-1',
      replayId: 'replay-1',
      validationVersion: 2,
      mode: 'replay_flex',
      eligibility: {
        applied: false,
        confidenceScore: 92,
        confidenceFactors: { nodeSnapshotHash: 1 },
        invalidationReasons: ['required_context_unresolved'],
        appliedSections: [],
        skippedSections: ['tool_policy'],
      },
    });

    expect(replayReportService.createReport).toHaveBeenCalledWith(expect.objectContaining({
      contextSubstitutionStatus: { status: 'failed', reason: 'required_context_unresolved' },
      toolSequenceStatus: { status: 'not_evaluated', reason: 'required_context_unresolved' },
      semanticStatus: { status: 'not_evaluated', reason: 'required_context_unresolved' },
    }));
  });

  it('materializes later iterations from pre-run state instead of copying prior evaluation results', async () => {
    const { service, replayReportService } = createService({
      replayReportService: {
        findLatestReportRecord: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            _id: 'report-1',
            executionId: 'exec-1',
            flowId: 'flow-1',
            taskId: 'task-1',
            iteration: 0,
            replayId: 'replay-1',
            validationVersion: 2,
            mode: 'replay_flex',
            applied: true,
            confidenceScore: 91,
            appliedSections: ['tool_policy'],
            skippedSections: [],
            invalidationReasons: [],
            confidenceFactors: {},
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
            contextDrift: 91,
            dataDrift: 99,
            driftFindings: [],
            blockedBy: [],
          }),
        createReport: jest.fn().mockResolvedValue({ _id: 'report-2', toJSON: () => ({ _id: 'report-2' }) }),
      },
    });

    await service.ensureIterationReportMaterialized('exec-1', 'task-1', 2);

    expect(replayReportService.createReport).toHaveBeenCalledWith(expect.objectContaining({
      iteration: 2,
      verdict: 'unknown',
      overallScore: null,
      semanticMatch: null,
      replayConfidence: null,
      semanticStatus: { status: 'not_evaluated', reason: 'evaluation_pending' },
    }));
  });

  it('updates semanticMatch on a non-applied replay report and re-derives verdict', async () => {
    const { service, replayReportService } = createService({
      replayReportService: {
        findLatestReportRecord: jest.fn().mockResolvedValue({
          _id: 'report-1',
          applied: false,
          mode: 'replay_flex',
          invalidationReasons: ['node_snapshot_mismatch'],
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
        verdict: 'skipped',
        overallScore: null,
        verdictReasons: ['replay_not_applied'],
        semanticStatus: { status: 'not_evaluated', reason: 'replay_not_applied' },
      }),
    );
  });

  it('backfillSemanticMatch is a no-op when no report exists', async () => {
    const { service, replayReportService } = createService();

    await service.backfillSemanticMatch('exec-1', 'task-1', 0, { matchScore: 90 });

    expect(replayReportService.updateReport).not.toHaveBeenCalled();
  });

  it('backfills semantic evidence when the report has applied=true', async () => {
    const { service, replayReportService } = createService({
      replayReportService: {
        findLatestReportRecord: jest.fn().mockResolvedValue({
          _id: 'report-1',
          applied: true,
          mode: 'replay_strict',
          invalidationReasons: [],
          outputContractEvaluated: false,
          outputContractPassed: false,
          structuralDriftScore: null,
          toolPolicyScore: null,
          structuralDriftReasons: [],
          confidenceScore: 100,
          replayConfidence: null,
          toolSequenceMatch: null,
          argumentShapeMatch: null,
          reasoningMatch: null,
          outputFormatMatch: null,
          contextDrift: 100,
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
    it('logs a WARN and updates report with not_evaluated signals when no evaluation inputs exist', async () => {
      const { service, replayReportService, loggerService } = createService({
        replayReportService: {
          findLatestReportRecord: jest.fn().mockResolvedValue({
            _id: 'report-1',
            applied: true,
            mode: 'replay_strict',
            invalidationReasons: [],
            confidenceScore: 85,
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
          verdict: 'skipped',
          overallScore: null,
        }),
      );
    });

    it('infers observed_intent_key from tool trace evidence when trace metadata has none', async () => {
      const { service, replayReportService } = createService({
        executionModel: {
          findById: jest.fn(() => ({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue({
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
            }),
          })),
        },
        replayReportService: {
          findLatestReportRecord: jest.fn().mockResolvedValue({
            _id: 'report-1',
            applied: true,
            mode: 'replay_flex',
            invalidationReasons: [],
            confidenceScore: 100,
            outputContractEvaluated: false,
            outputContractPassed: false,
            structuralDriftScore: null,
            toolPolicyScore: null,
            structuralDriftReasons: [],
            contextDrift: 100,
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
        },
        traceMetadata: null,
      });

      expect(replayReportService.updateReport).toHaveBeenCalledWith(
        'report-1',
        expect.objectContaining({
          intentKey: 'research_topic',
        }),
      );
    });
  });
});
