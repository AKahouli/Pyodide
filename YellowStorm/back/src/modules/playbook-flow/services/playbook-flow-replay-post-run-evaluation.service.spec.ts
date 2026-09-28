import { PlaybookFlowReplayPostRunEvaluationService } from './playbook-flow-replay-post-run-evaluation.service';
import type { FlowReplayRunReportRecord } from '../persistence/replay-run-report.repository';

function makeReport(overrides: Record<string, unknown> = {}): FlowReplayRunReportRecord {
  return {
    id: 'report-1',
    executionId: 'exec-1',
    flowId: 'flow-1',
    taskId: 'task-1',
    iteration: 0,
    replayId: 'replay-1',
    validationVersion: 1,
    mode: 'replay_flex',
    outputContractEvaluated: false,
    outputContractPassed: false,
    structuralDriftScore: null,
    toolPolicyScore: null,
    verdict: null,
    overallScore: null,
    verdictReasons: [],
    structuralDriftReasons: [],
    postRunEvaluation: null,
    ...overrides,
  } as unknown as FlowReplayRunReportRecord;
}

const baseParams = {
  executionId: 'exec-1',
  flowId: 'flow-1',
  taskId: 'task-1',
  iteration: 0,
  replayReportId: 'report-1',
  baselineOutput: 'baseline output',
  newOutput: 'new output',
  baselineReasoningChain: null,
  newReasoningChain: null,
  baselineToolCalls: null,
  newToolCalls: null,
  outputFormatGuide: null,
  replayPlanningSummary: null,
  taskTitle: 'Test Task',
  taskDescription: null,
  replayMode: 'replay_flex',
};

describe('PlaybookFlowReplayPostRunEvaluationService', () => {
  let service: PlaybookFlowReplayPostRunEvaluationService;
  let reportRepository: { findById: jest.Mock; setPostRunEvaluationIfAbsent: jest.Mock };
  let liteLLM: { getHttpClient: jest.Mock };
  let modelService: { resolveReplayEvaluationModel: jest.Mock };

  beforeEach(() => {
    reportRepository = {
      findById: jest.fn(),
      setPostRunEvaluationIfAbsent: jest.fn().mockResolvedValue(true),
    };
    liteLLM = { getHttpClient: jest.fn().mockReturnValue(null) };
    modelService = { resolveReplayEvaluationModel: jest.fn() };
    service = new PlaybookFlowReplayPostRunEvaluationService(
      reportRepository as any,
      liteLLM as any,
      modelService as any,
      null,
    );
  });

  it('skips when report not found', async () => {
    reportRepository.findById.mockResolvedValue(null);
    await service.evaluateCompletedReplayRun({ ...baseParams, replayReportId: 'missing-report', baselineOutput: null, newOutput: null });
    expect(reportRepository.findById).toHaveBeenCalledWith('missing-report');
    expect(reportRepository.setPostRunEvaluationIfAbsent).not.toHaveBeenCalled();
  });

  it('skips when evaluation already exists', async () => {
    reportRepository.findById.mockResolvedValue(makeReport({
      postRunEvaluation: { verdict: 'match', judgeUsed: false, judgeModel: null, evaluatedAt: new Date(), summary: '', recommendedAction: 'accept', missingPoints: [], changedPoints: [], preservedPoints: [] },
    }));
    await service.evaluateCompletedReplayRun({ ...baseParams, baselineOutput: 'baseline', newOutput: 'new' });
    expect(reportRepository.setPostRunEvaluationIfAbsent).not.toHaveBeenCalled();
    expect(liteLLM.getHttpClient).not.toHaveBeenCalled();
  });

  it('persists not_comparable when LiteLLM is unavailable', async () => {
    reportRepository.findById.mockResolvedValue(makeReport());

    await service.evaluateCompletedReplayRun(baseParams);

    expect(reportRepository.setPostRunEvaluationIfAbsent).toHaveBeenCalledWith(
      'report-1',
      expect.objectContaining({
        verdict: 'not_comparable',
        judgeUsed: false,
        recommendedAction: 'review',
        failureReason: 'LiteLLM HTTP client unavailable',
        evaluatedAt: expect.any(Date),
      }),
    );
  });

  it('persists the normalised judge verdict, clamping scores and defaulting unknown values', async () => {
    reportRepository.findById.mockResolvedValue(makeReport());
    const post = jest.fn().mockResolvedValue({
      data: { choices: [{ message: { content: JSON.stringify({ verdict: 'minor_drift', overallScore: 104.6, semanticMatchScore: 71.4, summary: 'Close.', missingPoints: ['a'], recommendedAction: 'shrug' }) } }] },
    });
    liteLLM.getHttpClient.mockReturnValue({ post });
    modelService.resolveReplayEvaluationModel.mockResolvedValue('judge-model');

    await service.evaluateCompletedReplayRun(baseParams);

    expect(post).toHaveBeenCalledWith('/v1/chat/completions', expect.objectContaining({ model: 'judge-model' }), { timeout: 345000 });
    expect(reportRepository.setPostRunEvaluationIfAbsent).toHaveBeenCalledWith('report-1', expect.objectContaining({
      judgeUsed: true,
      judgeModel: 'judge-model',
      verdict: 'minor_drift',
      overallScore: 100,
      semanticMatchScore: 71,
      outputFormatScore: null,
      summary: 'Close.',
      missingPoints: ['a'],
      recommendedAction: 'review',
      failureReason: null,
    }));
  });

  it('persists not_comparable with the failure reason when the judge returns invalid JSON', async () => {
    reportRepository.findById.mockResolvedValue(makeReport());
    liteLLM.getHttpClient.mockReturnValue({ post: jest.fn().mockResolvedValue({ data: { choices: [{ message: { content: 'not json' } }] } }) });
    modelService.resolveReplayEvaluationModel.mockResolvedValue('judge-model');

    await service.evaluateCompletedReplayRun(baseParams);

    expect(reportRepository.setPostRunEvaluationIfAbsent).toHaveBeenCalledWith('report-1', expect.objectContaining({
      verdict: 'not_comparable',
      failureReason: 'Post-run judge returned invalid JSON.',
    }));
  });
});
