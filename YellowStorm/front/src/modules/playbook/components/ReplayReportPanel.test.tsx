import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getExecution } from '../api';
import { ReplayReportPanel } from './ReplayReportPanel';

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function runPendingPoll() {
  await act(async () => {
    vi.runOnlyPendingTimers();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const apiClientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: apiClientMock,
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      const translations: Record<string, string> = {
        'replayReport.loading': 'Loading replay report',
        'replayReport.empty': 'No replay report was recorded for this step.',
        'replayReport.loadFailed': 'Replay report failed to load.',
        'replayReport.title': 'replayReport.title',
        'replayReport.notApplicable': 'Replay evaluation is not applicable for this step.',
        'replayReport.pending': 'Replay report is still pending for this step.',
        'replayReport.postRun.title': 'Replay Evaluation Synthesis',
        'replayReport.postRun.loading': 'Replay post-run evaluation is in progress.',
        'replayReport.postRun.notAvailable': 'Post-run evaluation is not available for this run yet.',
        'replayReport.postRun.summary': 'Summary',
        'replayReport.postRun.verdict.match': 'Match',
        'replayReport.postRun.verdict.minor_drift': 'Minor Drift',
        'replayReport.postRun.action.accept': 'Accept',
        'replayReport.section.verdict': 'Replay verdict',
        'replayReport.section.eligibility': 'Eligibility',
        'replayReport.section.signalStatuses': 'Signal evaluation',
        'replayReport.section.semantic': 'Semantic match',
        'replayReport.section.driftPolicy': 'Drift policy',
        'replayReport.section.structuralTooling': 'Structural & tooling',
        'replayReport.verdict': 'replayReport.verdict',
        'replayReport.verdictValue.warning': 'Warning',
        'replayReport.overallScore': 'replayReport.overallScore',
        'replayReport.applied': 'Applied',
        'replayReport.skipped': 'Skipped',
        'replayReport.mode': 'replayReport.mode',
        'replayReport.modeValue.replay_flex': 'Replay (Flex)',
        'replayReport.baselineVersion': 'replayReport.baselineVersion',
        'replayReport.replayConfidence': 'Replay confidence',
        'replayReport.verdictReasons': 'Verdict reasons',
        'replayReport.skippedSummary': 'Skipped summary',
        'replayReport.verdictReason.structuralDriftDetected': 'Structural drift was detected.',
        'replayReport.verdictReason.outputContractFailed': 'The output contract failed.',
        'replayReport.verdictReason.semanticMissingPoints': 'Some expected semantic points are missing.',
        'replayReport.verdictReason.semanticChangedPoints': 'Some semantic points changed.',
        'replayReport.confidence': 'replayReport.confidence',
        'replayReport.appliedSections': 'Applied sections',
        'replayReport.skippedSections': 'Skipped sections',
        'replayReport.observations': 'Observations',
        'replayReport.reason.mismatch': '{{subject}} changed.',
        'replayReport.reasonSubject.nodeSnapshot': 'node snapshot',
        'replayReport.semanticMatch': 'Semantic match',
        'replayReport.noSemanticEvaluation': 'No semantic evaluation available.',
        'replayReport.structuralDrift': 'Structural drift',
        'replayReport.toolPolicy': 'Tool policy',
        'replayReport.outputContract': 'Output contract',
        'replayReport.outputContractPassed': 'Output contract passed',
        'replayReport.driftFindings': 'Drift findings',
        'replayReport.blockedBy': 'Blocked by',
        'replayReport.contextDrift': 'Context stability',
        'replayReport.reasoningMatch': 'Reasoning match',
        'replayReport.toolSequenceMatch': 'Tool sequence match',
        'replayReport.argumentShapeMatch': 'Argument shape match',
        'replayReport.outputFormatMatch': 'Output format match',
        'replayReport.outputContractMatch': 'Output contract match',
        'replayReport.dataDrift': 'Semantic preservation',
        'replayReport.finding.confidenceBelowThreshold': 'Replay confidence drifted.',
        'replayReport.finding.intentNotEvaluated': 'Replay intent could not be evaluated.',
        'replayReport.finding.intentMismatch': 'Replay intent drifted.',
        'replayReport.finding.additionalToolsNotAllowed': 'Additional tools were used but not allowed.',
        'replayReport.finding.reasoningMatchBelowThreshold': 'Reasoning sequence drifted.',
        'replayReport.finding.toolSequenceMatchBelowThreshold': 'Tool sequence drifted.',
        'replayReport.finding.argumentShapeMatchBelowThreshold': 'Tool argument shape drifted.',
        'replayReport.finding.semanticMatchBelowThreshold': 'Semantic preservation drifted.',
        'replayReport.signal.contextSubstitution': 'Context substitution',
        'replayReport.signal.intent': 'Intent',
        'replayReport.signal.reasoning': 'Reasoning',
        'replayReport.signal.toolSequence': 'Tool sequence',
        'replayReport.signal.argumentShape': 'Argument shape',
        'replayReport.signal.outputContract': 'Output contract',
        'replayReport.signal.semantic': 'Semantic preservation',
        'replayReport.signalStatus.not_evaluated': 'Not evaluated',
        'replayReport.signalStatus.not_applicable': 'Not applicable',
        'replayReport.signalStatus.passed': 'Passed',
        'replayReport.signalStatus.warning': 'Warning',
        'replayReport.signalStatus.failed': 'Failed',
        'replayReport.signalReason.replayNotApplied': 'Replay was not applied.',
        'replayReport.signalReason.evaluationPending': 'Evaluation is still pending.',
        'replayReport.signalReason.confidenceBelowThreshold': 'Replay confidence was below the required threshold.',
        'replayReport.signalReason.requiredContextUnresolved': 'Required replay context could not be resolved for this replay.',
        'replayReport.signalReason.intentNotConfigured': 'No baseline intent was configured for this replay.',
        'replayReport.signalReason.intentNotEvaluated': 'Observed intent was not captured for this replay.',
        'replayReport.signalReason.intentMismatch': 'Observed intent did not match the baseline intent.',
        'replayReport.signalReason.reasoningNotConfigured': 'No baseline reasoning stages were configured for this replay.',
        'replayReport.signalReason.reasoningTraceMissing': 'No observed reasoning trace was captured for this replay.',
        'replayReport.signalReason.reasoningScoreBelowThreshold': 'Observed reasoning drifted below the expected threshold.',
        'replayReport.signalReason.toolTraceNotConfigured': 'No baseline tool trace was configured for this replay.',
        'replayReport.signalReason.toolTraceMissing': 'No observed tool trace was captured for this replay.',
        'replayReport.signalReason.argumentShapeNotCaptured': 'Tool argument shape could not be evaluated from the captured trace.',
        'replayReport.signalReason.toolSequenceScoreBelowThreshold': 'Observed tool sequence drifted below the expected threshold.',
        'replayReport.signalReason.argumentShapeScoreBelowThreshold': 'Observed tool argument shape drifted below the expected threshold.',
        'replayReport.signalReason.outputContractNotConfigured': 'No output contract evaluation was recorded for this replay.',
        'replayReport.signalReason.outputContractFailed': 'The output contract evaluation failed.',
        'replayReport.signalReason.semanticEvaluationMissing': 'No semantic evaluation was recorded for this replay.',
        'replayReport.signalReason.semanticScoreBelowThreshold': 'Semantic preservation fell below the expected threshold.',
        'replayReport.signalReason.semanticStaleContextReferences': 'Replay output still referenced stale baseline context.',
        'replayReport.signalReason.semanticUnsupportedClaims': 'Replay output included unsupported claims.',
        'replayReport.reason.requiredContextUnresolved': 'Required replay context could not be resolved.',
        'replayReport.reason.missingRequiredTool': 'A required tool call was missing.',
        'replayReport.reason.staleContextValueInToolArgs': 'Observed tool arguments still used stale baseline context values.',
        'replayReport.semanticPreserved': 'Preserved points',
        'replayReport.semanticMissingStructured': 'Missing findings',
        'replayReport.semanticChangedStructured': 'Changed findings',
        'replayReport.semanticExtra': 'Extra points',
        'replayReport.semanticStaleContext': 'Stale context references',
        'replayReport.semanticUnsupportedClaims': 'Unsupported claims',
        'replayReport.section.toolCalls': 'Expected vs observed tool calls',
        'replayReport.toolComparison.expected': 'Expected',
        'replayReport.toolComparison.observed': 'Observed',
        'replayReport.toolComparison.reasons': 'Reasons',
        'replayReport.toolComparison.unknownTool': 'Unknown tool',
        'replayReport.toolComparisonStatus.matched': 'Matched',
        'replayReport.toolComparisonStatus.warning': 'Warning',
        'replayReport.toolComparisonStatus.failed': 'Failed',
        'replayReport.toolComparisonStatus.missing': 'Missing',
        'replayReport.toolComparisonStatus.extra': 'Extra',
      };
      const template = translations[key];
      if (!template) {
        return key;
      }
      return Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        template,
      );
    },
  }),
}));

describe('ReplayReportPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls again after an empty response for active replay tasks loaded via getExecution', async () => {
    apiClientMock.get
      .mockResolvedValueOnce({
        data: {
          data: {
            id: 'exec-1',
            flowId: 'playbook-1',
            ownerId: 'user-1',
            status: 'running',
            executionMode: 'inherit',
            stepExecutionModes: {
              'task-1': 'replay_flex',
            },
            pendingApproval: null,
            recursionLimit: 25,
            maxParallelism: 1,
            taskResults: [],
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:01.000Z',
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: [],
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: [{
            id: 'report-1',
            executionId: 'exec-1',
            flowId: 'playbook-1',
            taskId: 'task-1',
            replayId: 'replay-1',
            validationVersion: 3,
            mode: 'replay_flex',
            applied: true,
            confidenceScore: 100,
            appliedSections: ['output_contract'],
            skippedSections: [],
            invalidationReasons: ['node_snapshot_mismatch'],
            confidenceFactors: { nodeSnapshotHash: 30 },
            outputContractEvaluated: true,
            outputContractPassed: true,
            structuralDriftScore: 100,
             toolPolicyScore: 100,
             verdict: 'warning',
             overallScore: 76,
             verdictReasons: ['structural_drift_detected'],
             structuralDriftReasons: [],
             matchedBaselineId: 'replay-1',
             matchedBaselineVersion: 3,
             intentKey: 'facts.verify',
             replayConfidence: 74,
             toolSequenceMatch: 100,
             argumentShapeMatch: 67,
             reasoningMatch: 50,
             outputFormatMatch: 100,
             contextDrift: 100,
             dataDrift: null,
              driftFindings: [
                { category: 'reasoning', severity: 'warning', reason: 'reasoning_match_below_threshold' },
                { category: 'argument_shape', severity: 'warning', reason: 'argument_shape_match_below_threshold' },
              ],
              blockedBy: [],
              semanticMatch: null,
              postRunEvaluation: {
                judgeUsed: true,
                judgeModel: 'gpt-test',
                evaluatedAt: '2025-01-01T00:00:06.000Z',
                verdict: 'minor_drift',
                overallScore: 76,
                semanticMatchScore: 80,
                outputFormatScore: 76,
                toolSequenceScore: 100,
                reasoningScore: 50,
                summary: 'Summary',
                missingPoints: [],
                changedPoints: [],
                preservedPoints: [],
                recommendedAction: 'review',
                rawJudgeResponse: null,
                failureReason: null,
              },
              createdAt: '2025-01-01T00:00:00.000Z',
              updatedAt: '2025-01-01T00:00:05.000Z',
           }],
        },
      });

    const execution = await getExecution('playbook-1', 'exec-1');

    render(
      <ReplayReportPanel
        playbookId="playbook-1"
        taskId="task-1"
        executionId="exec-1"
        execution={execution}
      />,
    );

    await flushAsyncWork();

    expect(apiClientMock.get).toHaveBeenNthCalledWith(
      2,
      '/playbooks/playbook-1/tasks/task-1/replay-reports',
      { params: { executionId: 'exec-1', iteration: 0, limit: 1 } },
    );
    expect(screen.getByText('Loading replay report')).toBeInTheDocument();

    await runPendingPoll();

    expect(apiClientMock.get).toHaveBeenNthCalledWith(
      3,
      '/playbooks/playbook-1/tasks/task-1/replay-reports',
      { params: { executionId: 'exec-1', iteration: 0, limit: 1 } },
    );

    expect(screen.getByText('Replay verdict')).toBeInTheDocument();
    expect(screen.getByText(/replayReport.overallScore: 76%/)).toBeInTheDocument();
    expect(screen.getByText(/Structural drift was detected./)).toBeInTheDocument();
    expect(screen.getByText(/node snapshot changed./)).toBeInTheDocument();
    expect(screen.getByText('Drift policy')).toBeInTheDocument();
    expect(screen.getByText('Replay confidence')).toBeInTheDocument();
    expect(screen.getByText('Reasoning sequence drifted.')).toBeInTheDocument();
    expect(screen.getByText('Tool argument shape drifted.')).toBeInTheDocument();
    expect(screen.getByText('Output format match')).toBeInTheDocument();
  });

  it('polls for replay-enabled tasks even when the execution is not single-step', async () => {
    apiClientMock.get
      .mockResolvedValueOnce({
        data: {
          data: [],
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: [{
            id: 'report-2',
            executionId: 'exec-2',
            flowId: 'playbook-1',
            taskId: 'task-2',
            replayId: 'replay-2',
            validationVersion: 4,
            mode: 'replay_strict',
            applied: true,
            confidenceScore: 90,
            appliedSections: [],
            skippedSections: [],
            invalidationReasons: [],
            confidenceFactors: {},
            outputContractEvaluated: false,
            outputContractPassed: false,
            structuralDriftScore: null,
            toolPolicyScore: null,
            verdict: 'warning',
            overallScore: 82,
            verdictReasons: ['structural_drift_detected'],
            structuralDriftReasons: [],
            semanticMatch: null,
            postRunEvaluation: {
              judgeUsed: true,
              judgeModel: 'gpt-test',
              evaluatedAt: '2025-01-01T00:00:06.000Z',
              verdict: 'match',
              overallScore: 82,
              semanticMatchScore: 82,
              outputFormatScore: 82,
              toolSequenceScore: 82,
              reasoningScore: 82,
              summary: 'Summary',
              missingPoints: [],
              changedPoints: [],
              preservedPoints: [],
              recommendedAction: 'accept',
              rawJudgeResponse: null,
              failureReason: null,
            },
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:05.000Z',
          }],
        },
      });

    render(
      <ReplayReportPanel
        playbookId="playbook-1"
        taskId="task-2"
        executionId="exec-2"
        execution={{
          id: 'exec-2',
          playbookId: 'playbook-1',
          executedBy: 'user-1',
          executionNumber: 2,
          status: 'running',
          executionMode: 'inherit',
          stepExecutionModes: { 'task-2': 'replay_strict' },
          replaySourceByTask: null,
          taskResults: [],
          threadId: null,
          interruptPayload: null,
          error: null,
          durationMs: null,
          startedAt: '2025-01-01T00:00:00.000Z',
          completedAt: null,
          singleStepTaskId: null,
          playbookSnapshot: null,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        }}
      />,
    );

    await flushAsyncWork();

    expect(apiClientMock.get).toHaveBeenCalledTimes(1);

    await runPendingPoll();

    expect(screen.getByText('Replay verdict')).toBeInTheDocument();
    expect(apiClientMock.get).toHaveBeenCalledTimes(2);
  });

  it('polls when replay is enabled by the global execution mode', async () => {
    apiClientMock.get
      .mockResolvedValueOnce({ data: { data: [] } })
      .mockResolvedValueOnce({
        data: {
          data: [{
            id: 'report-3',
            executionId: 'exec-3',
            flowId: 'playbook-1',
            taskId: 'task-3',
            replayId: 'replay-3',
            validationVersion: 1,
            mode: 'replay_flex',
            applied: true,
            confidenceScore: 88,
            appliedSections: [],
            skippedSections: [],
            invalidationReasons: [],
            confidenceFactors: {},
            outputContractEvaluated: false,
            outputContractPassed: false,
            structuralDriftScore: null,
            toolPolicyScore: null,
            verdict: 'warning',
            overallScore: 80,
            verdictReasons: ['structural_drift_detected'],
            structuralDriftReasons: [],
            semanticMatch: null,
            postRunEvaluation: {
              judgeUsed: true,
              judgeModel: 'gpt-test',
              evaluatedAt: '2025-01-01T00:00:06.000Z',
              verdict: 'match',
              overallScore: 80,
              semanticMatchScore: 80,
              outputFormatScore: 80,
              toolSequenceScore: 80,
              reasoningScore: 80,
              summary: 'Summary',
              missingPoints: [],
              changedPoints: [],
              preservedPoints: [],
              recommendedAction: 'accept',
              rawJudgeResponse: null,
              failureReason: null,
            },
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:05.000Z',
          }],
        },
      });

    render(
      <ReplayReportPanel
        playbookId="playbook-1"
        taskId="task-3"
        executionId="exec-3"
        execution={{
          id: 'exec-3',
          playbookId: 'playbook-1',
          executedBy: 'user-1',
          executionNumber: 3,
          status: 'running',
          executionMode: 'replay_flex',
          stepExecutionModes: undefined,
          replaySourceByTask: null,
          taskResults: [],
          threadId: null,
          interruptPayload: null,
          error: null,
          durationMs: null,
          startedAt: '2025-01-01T00:00:00.000Z',
          completedAt: null,
          singleStepTaskId: null,
          playbookSnapshot: null,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        }}
      />,
    );

    await flushAsyncWork();
    await runPendingPoll();

    expect(apiClientMock.get).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Replay verdict')).toBeInTheDocument();
  });

  it('renders localized intent and additional-tool drift findings', async () => {
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        data: [{
          id: 'report-4',
          executionId: 'exec-4',
          flowId: 'playbook-1',
          taskId: 'task-4',
          replayId: 'replay-4',
          validationVersion: 1,
          mode: 'replay_flex',
          applied: true,
          confidenceScore: 92,
          appliedSections: [],
          skippedSections: [],
          invalidationReasons: [],
          confidenceFactors: {},
          outputContractEvaluated: true,
          outputContractPassed: true,
          structuralDriftScore: 100,
          toolPolicyScore: 100,
          verdict: 'fail',
          overallScore: 71,
          verdictReasons: ['structural_drift_detected'],
          structuralDriftReasons: [],
          matchedBaselineId: 'replay-4',
          matchedBaselineVersion: 1,
          intentKey: 'facts.verify',
          replayConfidence: 71,
          toolSequenceMatch: 50,
          argumentShapeMatch: 100,
          reasoningMatch: 100,
          outputFormatMatch: 100,
          contextDrift: 92,
          dataDrift: 95,
          driftFindings: [
            { category: 'context', severity: 'warning', reason: 'intent_not_evaluated' },
            { category: 'tool_sequence', severity: 'fail', reason: 'additional_tools_not_allowed' },
          ],
          blockedBy: ['additional_tools_not_allowed'],
          semanticMatch: {
            matchScore: 95,
            semanticSimilarityScore: 95,
            evidenceConsistencyScore: 95,
            judgeScore: 95,
            reason: 'Aligned',
            missingPoints: [],
            changedPoints: [],
            model: 'gpt-test',
            judgeUsed: true,
          },
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:05.000Z',
        }],
      },
    });

    render(
      <ReplayReportPanel
        playbookId="playbook-1"
        taskId="task-4"
        executionId="exec-4"
        execution={{
          id: 'exec-4',
          playbookId: 'playbook-1',
          executedBy: 'user-1',
          executionNumber: 4,
          status: 'completed',
          executionMode: 'replay_flex',
          stepExecutionModes: { 'task-4': 'replay_flex' },
          replaySourceByTask: null,
          taskResults: [],
          threadId: null,
          interruptPayload: null,
          error: null,
          durationMs: null,
          startedAt: '2025-01-01T00:00:00.000Z',
          completedAt: '2025-01-01T00:00:10.000Z',
          singleStepTaskId: null,
          playbookSnapshot: null,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:10.000Z',
        }}
      />,
    );

    await flushAsyncWork();

    expect(screen.getByText('Replay intent could not be evaluated.')).toBeInTheDocument();
    expect(screen.getAllByText('Additional tools were used but not allowed.').length).toBeGreaterThan(0);
  });

  it('shows not applicable when the execution was never in replay mode', async () => {
    apiClientMock.get.mockResolvedValueOnce({ data: { data: [] } });

    render(
      <ReplayReportPanel
        playbookId="playbook-1"
        taskId="task-7"
        executionId="exec-7"
        execution={{
          id: 'exec-7',
          playbookId: 'playbook-1',
          executedBy: 'user-1',
          executionNumber: 7,
          status: 'completed',
          executionMode: 'live',
          stepExecutionModes: { 'task-7': 'live' },
          replaySourceByTask: null,
          taskResults: [],
          threadId: null,
          interruptPayload: null,
          error: null,
          durationMs: null,
          startedAt: '2025-01-01T00:00:00.000Z',
          completedAt: '2025-01-01T00:00:10.000Z',
          singleStepTaskId: null,
          playbookSnapshot: null,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:10.000Z',
        }}
      />,
    );

    await flushAsyncWork();

    expect(screen.getByText('Replay evaluation is not applicable for this step.')).toBeInTheDocument();
  });

  it('shows skipped summary and signal statuses for skipped reports', async () => {
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        data: [{
          id: 'report-5',
          executionId: 'exec-5',
          flowId: 'playbook-1',
          taskId: 'task-5',
          replayId: 'replay-5',
          validationVersion: 1,
          mode: 'replay_flex',
          applied: false,
          confidenceScore: 45,
          appliedSections: [],
          skippedSections: ['tool_policy'],
          invalidationReasons: ['confidence_below_threshold'],
          confidenceFactors: {},
          outputContractEvaluated: false,
          outputContractPassed: false,
          structuralDriftScore: null,
          toolPolicyScore: null,
          verdict: 'skipped',
          overallScore: null,
          verdictReasons: ['replay_not_applied'],
          structuralDriftReasons: [],
          semanticMatch: null,
          contextSubstitutionStatus: { status: 'failed', reason: 'confidence_below_threshold' },
          toolSequenceStatus: { status: 'not_evaluated', reason: 'confidence_below_threshold' },
          semanticStatus: { status: 'not_evaluated', reason: 'confidence_below_threshold' },
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:05.000Z',
        }],
      },
    });

    render(<ReplayReportPanel playbookId="playbook-1" taskId="task-5" executionId="exec-5" execution={null} />);

    await flushAsyncWork();

    expect(screen.getByText('Signal evaluation')).toBeInTheDocument();
    expect(screen.getByText(/Skipped summary:/)).toBeInTheDocument();
    expect(screen.getAllByText('Replay confidence was below the required threshold.').length).toBeGreaterThan(0);
    expect(screen.queryByText('Drift policy')).not.toBeInTheDocument();
  });

  it('shows not evaluated reasons instead of empty semantic and tooling summaries', async () => {
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        data: [{
          id: 'report-6',
          executionId: 'exec-6',
          flowId: 'playbook-1',
          taskId: 'task-6',
          replayId: 'replay-6',
          validationVersion: 1,
          mode: 'replay_flex',
          applied: true,
          confidenceScore: 82,
          appliedSections: [],
          skippedSections: [],
          invalidationReasons: [],
          confidenceFactors: {},
          outputContractEvaluated: false,
          outputContractPassed: false,
          structuralDriftScore: null,
          toolPolicyScore: null,
          verdict: 'unknown',
          overallScore: null,
          verdictReasons: ['evaluation_pending'],
          structuralDriftReasons: [],
          semanticMatch: null,
          contextSubstitutionStatus: { status: 'passed', reason: null },
          toolSequenceStatus: { status: 'not_evaluated', reason: 'tool_trace_missing' },
          argumentShapeStatus: { status: 'not_evaluated', reason: 'argument_shape_not_captured' },
          semanticStatus: { status: 'not_evaluated', reason: 'semantic_evaluation_missing' },
          postRunEvaluation: {
            judgeUsed: true,
            judgeModel: 'gpt-test',
            evaluatedAt: '2025-01-01T00:00:06.000Z',
            verdict: 'not_comparable',
            overallScore: null,
            semanticMatchScore: null,
            outputFormatScore: null,
            toolSequenceScore: null,
            reasoningScore: null,
            summary: '',
            missingPoints: [],
            changedPoints: [],
            preservedPoints: [],
            recommendedAction: 'review',
            rawJudgeResponse: null,
            failureReason: 'Pending not comparable',
          },
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:05.000Z',
        }],
      },
    });

    render(<ReplayReportPanel playbookId="playbook-1" taskId="task-6" executionId="exec-6" execution={null} />);

    await flushAsyncWork();

    expect(screen.getAllByText('No semantic evaluation was recorded for this replay.').length).toBeGreaterThan(0);
    expect(screen.getByText('No observed tool trace was captured for this replay.')).toBeInTheDocument();
    expect(screen.queryByText('Structural & tooling')).not.toBeInTheDocument();
  });

  it('renders expected vs observed tool call comparisons when report evidence exists', async () => {
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        data: [{
          id: 'report-1',
          executionId: 'exec-1',
          flowId: 'playbook-1',
          taskId: 'task-1',
          iteration: 0,
          replayId: 'replay-1',
          validationVersion: 3,
          mode: 'replay_flex',
          applied: true,
          confidenceScore: 100,
          appliedSections: [],
          skippedSections: [],
          invalidationReasons: [],
          confidenceFactors: {},
          outputContractEvaluated: false,
          outputContractPassed: false,
          structuralDriftScore: null,
          toolPolicyScore: 50,
          verdict: 'warning',
          overallScore: 70,
          verdictReasons: ['tool_policy_warning'],
          structuralDriftReasons: [],
          semanticMatch: null,
          expectedToolSteps: [
            { stepIndex: 1, toolName: 'search_financials', purpose: 'load earnings', required: true, argumentShape: { ticker: 'string' }, argumentShapeKeys: ['ticker'], expectedArgs: { ticker: 'NVDA' }, sourceCallIndex: 1 },
          ],
          observedToolCalls: [
            { callIndex: 1, toolName: 'search_financials', purpose: 'load earnings', args: { ticker: 'AAPL' }, outputSummary: null, status: 'completed' },
          ],
          toolCallComparisons: [
            {
              expectedStepIndex: 1,
              expectedToolName: 'search_financials',
              expectedPurpose: 'load earnings',
              expectedArgs: { ticker: 'NVDA' },
              observedCallIndex: 1,
              observedToolName: 'search_financials',
              observedPurpose: 'load earnings',
              observedArgs: { ticker: 'AAPL' },
              status: 'failed',
              reasons: ['stale_context_value_in_tool_args'],
            },
          ],
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:05.000Z',
        }],
      },
    });

    render(<ReplayReportPanel playbookId="playbook-1" taskId="task-1" executionId="exec-1" iteration={0} />);
    await flushAsyncWork();

    expect(screen.getByText('Expected vs observed tool calls')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.queryByText('A required tool call was missing.')).not.toBeInTheDocument();
    expect(screen.getByText('Observed tool arguments still used stale baseline context values.')).toBeInTheDocument();
  });

  it('renders structured semantic findings when present', async () => {
    apiClientMock.get.mockResolvedValueOnce({
      data: {
        data: [{
          id: 'report-1', executionId: 'exec-1', flowId: 'playbook-1', taskId: 'task-1', iteration: 0,
          replayId: 'replay-1', validationVersion: 3, mode: 'replay_flex', applied: true, confidenceScore: 100,
          appliedSections: [], skippedSections: [], invalidationReasons: [], confidenceFactors: {},
          outputContractEvaluated: false, outputContractPassed: false, structuralDriftScore: null, toolPolicyScore: null,
          verdict: 'warning', overallScore: 75, verdictReasons: ['semantic_score_below_pass_threshold'], structuralDriftReasons: [],
          semanticMatch: {
            matchScore: 75, semanticSimilarityScore: 75, evidenceConsistencyScore: 75, judgeScore: 75,
            reason: 'Missing summary details', missingPoints: ['Include section: Summary.'], changedPoints: ['ticker'],
            preservedPoints: ['context:ticker'],
            missingPointFindings: [{ key: 'section:summary', expected: 'Include section: Summary.', observed: null, severity: 'fail' }],
            changedPointFindings: [], extraPointFindings: [],
            staleContextReferenceFindings: [{ key: 'ticker', expected: 'NVDA', observed: 'AAPL', severity: 'fail' }],
            unsupportedClaimFindings: [{ key: 'claim-1', expected: null, observed: 'Invented claim', severity: 'warning' }],
            model: 'deterministic-replay-semantic-evaluator', judgeUsed: false, evaluationSource: 'instantiated_replay',
          },
          createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:05.000Z',
        }],
      },
    });

    render(<ReplayReportPanel playbookId="playbook-1" taskId="task-1" executionId="exec-1" iteration={0} />);
    await flushAsyncWork();

    expect(screen.getByText(/Preserved points/)).toBeInTheDocument();
    expect(screen.getByText(/Stale context references/)).toBeInTheDocument();
    expect(screen.getByText(/Unsupported claims/)).toBeInTheDocument();
    expect(screen.getByText(/ticker \| NVDA \| AAPL/)).toBeInTheDocument();
  });

  it('shows a pending state after polling exhausts for an active replay execution', async () => {
    apiClientMock.get.mockResolvedValue({ data: { data: [] } });

    render(
      <ReplayReportPanel
        playbookId="playbook-1"
        taskId="task-8"
        executionId="exec-8"
        execution={{
          id: 'exec-8',
          playbookId: 'playbook-1',
          executedBy: 'user-1',
          executionNumber: 8,
          status: 'running',
          executionMode: 'replay_flex',
          stepExecutionModes: { 'task-8': 'replay_flex' },
          replaySourceByTask: null,
          taskResults: [],
          threadId: null,
          interruptPayload: null,
          error: null,
          durationMs: null,
          startedAt: '2025-01-01T00:00:00.000Z',
          completedAt: null,
          singleStepTaskId: null,
          playbookSnapshot: null,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        }}
      />,
    );

    await flushAsyncWork();
    for (let index = 0; index < 20; index += 1) {
      await runPendingPoll();
    }

    expect(screen.getByText('Replay report is still pending for this step.')).toBeInTheDocument();
  });

  it('keeps the report visible and polls silently while post-run evaluation is pending', async () => {
    apiClientMock.get
      .mockResolvedValueOnce({
        data: {
          data: [{
            id: 'report-9', executionId: 'exec-9', flowId: 'playbook-1', taskId: 'task-9', iteration: 0,
            replayId: 'replay-9', validationVersion: 2, mode: 'replay_flex', applied: true, confidenceScore: 90,
            appliedSections: [], skippedSections: [], invalidationReasons: [], confidenceFactors: {},
            outputContractEvaluated: true, outputContractPassed: true, structuralDriftScore: 95, toolPolicyScore: 95,
            verdict: 'warning', overallScore: 84, verdictReasons: ['evaluation_pending'], structuralDriftReasons: [],
            semanticMatch: null, postRunEvaluation: null,
            createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:05.000Z',
          }],
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: [{
            id: 'report-9', executionId: 'exec-9', flowId: 'playbook-1', taskId: 'task-9', iteration: 0,
            replayId: 'replay-9', validationVersion: 2, mode: 'replay_flex', applied: true, confidenceScore: 90,
            appliedSections: [], skippedSections: [], invalidationReasons: [], confidenceFactors: {},
            outputContractEvaluated: true, outputContractPassed: true, structuralDriftScore: 95, toolPolicyScore: 95,
            verdict: 'warning', overallScore: 84, verdictReasons: ['evaluation_pending'], structuralDriftReasons: [],
            semanticMatch: null,
            postRunEvaluation: {
              judgeUsed: true,
              judgeModel: 'gpt-test',
              evaluatedAt: '2025-01-01T00:00:10.000Z',
              verdict: 'minor_drift',
              overallScore: 88,
              semanticMatchScore: 92,
              outputFormatScore: 78,
              toolSequenceScore: 95,
              reasoningScore: 94,
              summary: 'The replay preserved the core meaning.',
              missingPoints: [],
              changedPoints: [],
              preservedPoints: ['Core meaning preserved'],
              recommendedAction: 'accept',
              rawJudgeResponse: null,
              failureReason: null,
            },
            createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:10.000Z',
          }],
        },
      });

    render(
      <ReplayReportPanel
        playbookId="playbook-1"
        taskId="task-9"
        executionId="exec-9"
        execution={{
          id: 'exec-9',
          playbookId: 'playbook-1',
          executedBy: 'user-1',
          executionNumber: 9,
          status: 'completed',
          executionMode: 'replay_flex',
          stepExecutionModes: { 'task-9': 'replay_flex' },
          replaySourceByTask: null,
          taskResults: [],
          threadId: null,
          interruptPayload: null,
          error: null,
          durationMs: null,
          startedAt: '2025-01-01T00:00:00.000Z',
          completedAt: '2025-01-01T00:00:08.000Z',
          singleStepTaskId: null,
          playbookSnapshot: null,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:08.000Z',
        }}
      />,
    );

    await flushAsyncWork();

    expect(screen.getByText('Replay verdict')).toBeInTheDocument();
    expect(screen.getByText('Replay post-run evaluation is in progress.')).toBeInTheDocument();

    await runPendingPoll();

    expect(screen.getByText('Replay Evaluation Synthesis')).toBeInTheDocument();
    expect(screen.getByText('Minor Drift')).toBeInTheDocument();
    expect(screen.getByText('The replay preserved the core meaning.')).toBeInTheDocument();
  });
});
