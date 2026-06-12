import { PlaybookFlowExecutionAdvisorService } from './playbook-flow-execution-advisor.service';
import { PlaybookFlowExecutionAdvisorMapper } from './playbook-flow-execution-advisor.mapper';
import { NotFoundException, BadRequestException } from '@modules/exceptions';

function createService() {
  const executionModel = {
    findById: jest.fn(() => ({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            id: 'exec-1',
            ownerId: 'user-1',
            flowId: '507f1f77bcf86cd799439011',
            advisorScoringMode: 'llm',
            snapshot: { nodes: [{ id: 'task-1', label: 'Task 1', metadata: { expectedResult: 'expected' } }] },
          }),
        }),
      }),
    })),
  };
  const taskResultDocument = {
    status: 'completed',
    output: 'result output',
    error: null,
    toolTrace: [],
    artifacts: [],
    judgeStatus: 'idle',
    judgeError: null,
    judgeHistory: [],
    save: jest.fn().mockResolvedValue(undefined),
  };
  const taskResultModel = {
    findOne: jest.fn(() => ({ sort: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(taskResultDocument) }) })),
  };
  const outputFormatModel = {
    findOne: jest.fn(() => ({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }) })),
  };
  const heuristicEvaluator = {
    evaluate: jest.fn().mockResolvedValue({
      judgeResult: {
        accuracyScore: 80,
        completenessScore: 70,
        resultMatchingScore: 75,
        overallScore: 76,
        confidence: 80,
        toolUsageScore: 68,
        expectedResultSource: 'node_field',
        expectedResultType: 'semantic_description',
        expectedResultMatched: true,
        expectedResultReason: 'Matched',
        missingFacts: [],
        incoherences: [],
        unsupportedClaims: [],
        handoffRisks: [],
        rewriteHints: [],
        toolSelectionIssues: [],
        missingToolCalls: [],
        redundantToolCalls: [],
        toolOutputUseIssues: [],
        toolSequencingIssues: [],
        toolUsageStrengths: [],
        toolUsageRecommendation: 'Looks fine',
        safeAutoFixType: 'none',
        recommendation: 'none',
        reason: 'Done',
      },
      model: 'deterministic-execution-advisor',
      scoringMode: 'heuristic',
      usage: null,
      llmPromptTrace: [],
    }),
  };
  const llmEvaluator = {
    evaluate: jest.fn().mockResolvedValue({
      judgeResult: {
        accuracyScore: 83,
        completenessScore: 77,
        resultMatchingScore: 79,
        overallScore: 80,
        confidence: 84,
        toolUsageScore: 73,
        expectedResultSource: 'node_field',
        expectedResultType: 'semantic_description',
        expectedResultMatched: true,
        expectedResultReason: 'Matched',
        missingFacts: [],
        incoherences: [],
        unsupportedClaims: [],
        handoffRisks: [],
        rewriteHints: [],
        toolSelectionIssues: [],
        missingToolCalls: [],
        redundantToolCalls: [],
        toolOutputUseIssues: [],
        toolSequencingIssues: [],
        toolUsageStrengths: [],
        toolUsageRecommendation: 'Looks fine',
        safeAutoFixType: 'none',
        recommendation: 'none',
        reason: 'Done',
      },
      model: 'advisor-v1',
      scoringMode: 'llm',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, model: 'advisor-v1' },
      llmPromptTrace: [{ stage: 'advisor_evaluation', model: 'advisor-v1', prompt: 'prompt' }],
    }),
  };
  const streamEvents = {
    emitStepJudgeStarted: jest.fn(),
    emitStepJudgeUpdated: jest.fn(),
  };
  const mapper = new PlaybookFlowExecutionAdvisorMapper();

  return {
    service: new PlaybookFlowExecutionAdvisorService(
      executionModel as any,
      taskResultModel as any,
      outputFormatModel as any,
      streamEvents as any,
      mapper,
      heuristicEvaluator as any,
      llmEvaluator as any,
    ),
    executionModel,
    taskResultModel,
    taskResultDocument,
    outputFormatModel,
    heuristicEvaluator,
    llmEvaluator,
    streamEvents,
  };
}

describe('PlaybookFlowExecutionAdvisorService', () => {
  it('uses llm scoring by default and appends usage metadata', async () => {
    const { service, taskResultDocument, streamEvents, heuristicEvaluator, llmEvaluator } = createService();

    const result = await service.runTaskEvaluation('exec-1', 'task-1', 'user-1');

    expect(llmEvaluator.evaluate).toHaveBeenCalledTimes(1);
    expect(heuristicEvaluator.evaluate).not.toHaveBeenCalled();
    expect(taskResultDocument.save).toHaveBeenCalledTimes(2);
    expect(streamEvents.emitStepJudgeStarted).toHaveBeenCalledWith('user-1', 'exec-1', 'task-1', undefined, 'llm');
    expect(streamEvents.emitStepJudgeUpdated).toHaveBeenCalledWith(
      'user-1',
      'exec-1',
      'task-1',
      expect.objectContaining({ judgeStatus: 'evaluated', advisorScoringMode: 'llm' }),
      undefined,
    );
    expect(result.taskResult.judgeStatus).toBe('evaluated');
    expect(result.taskResult.judgeScoringMode).toBe('llm');
    expect(result.taskResult.judgeHistory).toHaveLength(1);
    expect(result.taskResult.judgeHistory[0]).toMatchObject({
      scoringMode: 'llm',
      usage: { totalTokens: 15 },
    });
    expect(result.taskResult.iteration).toBeUndefined();
  });

  it('uses heuristic scoring when explicitly requested', async () => {
    const { service, heuristicEvaluator, llmEvaluator } = createService();

    const result = await service.runTaskEvaluation('exec-1', 'task-1', 'user-1', { advisorScoringMode: 'heuristic' });

    expect(heuristicEvaluator.evaluate).toHaveBeenCalledTimes(1);
    expect(llmEvaluator.evaluate).not.toHaveBeenCalled();
    expect(result.taskResult.judgeScoringMode).toBe('heuristic');
    expect(result.taskResult.judgeHistory[0]).toMatchObject({ scoringMode: 'heuristic' });
  });

  it('returns not found when execution does not exist', async () => {
    const { service, executionModel } = createService();
    executionModel.findById = jest.fn(() => ({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      }),
    }));

    await expect(service.runTaskEvaluation('exec-1', 'task-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects non-completed task results', async () => {
    const { service, taskResultModel } = createService();
    const taskResultDocument = { status: 'running', judgeHistory: [], save: jest.fn() };
    taskResultModel.findOne = jest.fn(() => ({ sort: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(taskResultDocument) }) }));

    await expect(service.runTaskEvaluation('exec-1', 'task-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores failed advisor status when llm evaluation errors', async () => {
    const { service, llmEvaluator, taskResultDocument, streamEvents } = createService();
    llmEvaluator.evaluate.mockRejectedValueOnce(new Error('llm failed'));

    const result = await service.runTaskEvaluation('exec-1', 'task-1', 'user-1');

    expect(taskResultDocument.judgeStatus).toBe('failed');
    expect(result.taskResult.judgeStatus).toBe('failed');
    expect(streamEvents.emitStepJudgeUpdated).toHaveBeenCalledWith(
      'user-1',
      'exec-1',
      'task-1',
      expect.objectContaining({ judgeStatus: 'failed', judgeError: 'llm failed', advisorScoringMode: 'llm' }),
      undefined,
    );
  });
});
