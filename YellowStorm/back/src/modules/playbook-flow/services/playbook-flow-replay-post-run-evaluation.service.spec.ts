import { PlaybookFlowReplayPostRunEvaluationService } from './playbook-flow-replay-post-run-evaluation.service';
import type { FlowReplayRunReportDocument } from '../schemas/playbook-flow-replay-run-report.schema';

function makeReport(overrides: Record<string, unknown> = {}): FlowReplayRunReportDocument {
  return {
    _id: 'report-1',
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
  } as unknown as FlowReplayRunReportDocument;
}

describe('PlaybookFlowReplayPostRunEvaluationService', () => {
  let service: PlaybookFlowReplayPostRunEvaluationService;
  let mockReportModel: { findById: jest.Mock; updateOne: jest.Mock; findOne: jest.Mock };
  let updateOneExec: jest.Mock;

  beforeEach(() => {
    updateOneExec = jest.fn().mockResolvedValue(undefined);
    mockReportModel = {
      findById: jest.fn(),
      updateOne: jest.fn().mockReturnValue({ exec: updateOneExec }),
      findOne: jest.fn(),
    };
    const mockLiteLLM = { getHttpClient: jest.fn().mockReturnValue(null) };
    const mockModelService = { resolveReplayEvaluationModel: jest.fn() };
    service = new PlaybookFlowReplayPostRunEvaluationService(
      mockReportModel as any,
      mockLiteLLM as any,
      mockModelService as any,
      null,
    );
  });

  it('skips when report not found', async () => {
    mockReportModel.findById.mockReturnValue({ lean: () => Promise.resolve(null) });
    await service.evaluateCompletedReplayRun({
      executionId: 'exec-1',
      flowId: 'flow-1',
      taskId: 'task-1',
      iteration: 0,
      replayReportId: 'missing-report',
      baselineOutput: null,
      newOutput: null,
      baselineReasoningChain: null,
      newReasoningChain: null,
      baselineToolCalls: null,
      newToolCalls: null,
      outputFormatGuide: null,
      replayPlanningSummary: null,
      taskTitle: 'Test Task',
      taskDescription: null,
      replayMode: 'replay_flex',
    });
    expect(updateOneExec).not.toHaveBeenCalled();
  });

  it('skips when evaluation already exists', async () => {
    mockReportModel.findById.mockReturnValue({
      lean: () => Promise.resolve(makeReport({ postRunEvaluation: { verdict: 'match', judgeUsed: false, judgeModel: null, evaluatedAt: new Date(), summary: '', recommendedAction: 'accept', missingPoints: [], changedPoints: [], preservedPoints: [] } })),
    });
    await service.evaluateCompletedReplayRun({
      executionId: 'exec-1',
      flowId: 'flow-1',
      taskId: 'task-1',
      iteration: 0,
      replayReportId: 'report-1',
      baselineOutput: 'baseline',
      newOutput: 'new',
      baselineReasoningChain: null,
      newReasoningChain: null,
      baselineToolCalls: null,
      newToolCalls: null,
      outputFormatGuide: null,
      replayPlanningSummary: null,
      taskTitle: 'Test Task',
      taskDescription: null,
      replayMode: 'replay_flex',
    });
    expect(updateOneExec).not.toHaveBeenCalled();
  });

  it('persists not_comparable when LiteLLM is unavailable', async () => {
    mockReportModel.findById.mockReturnValue({
      lean: () => Promise.resolve(makeReport()),
    });

    await service.evaluateCompletedReplayRun({
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
    });

    expect(mockReportModel.updateOne).toHaveBeenCalledWith(
      { _id: 'report-1' },
      { $set: { postRunEvaluation: expect.objectContaining({ verdict: 'not_comparable' }) } },
    );
    expect(updateOneExec).toHaveBeenCalled();
  });
});
