import { PlaybookFlowExecutionAdvisorService } from './playbook-flow-execution-advisor.service';
import { PlaybookFlowExecutionAdvisorMapper } from './playbook-flow-execution-advisor.mapper';
import { NotFoundException, BadRequestException } from '@modules/exceptions';

function createService() {
  const executionRepository = {
    findById: jest.fn().mockResolvedValue({
      id: 'exec-1',
      ownerId: 'user-1',
      flowId: '507f1f77bcf86cd799439011',
      advisorScoringMode: 'llm',
      snapshot: { nodes: [{ id: 'task-1', label: 'Task 1', metadata: { expectedResult: 'expected' } }] },
    }),
  };
  const taskResultRecord: Record<string, unknown> = {
    id: 'tr-1',
    executionId: 'exec-1',
    taskId: 'task-1',
    iteration: 0,
    status: 'completed',
    output: 'result output',
    error: null,
    toolTrace: [],
    artifacts: [],
    judgeStatus: 'idle',
    judgeScoringMode: null,
    judgeError: null,
    judgeHistory: [],
  };
  const taskResultRepository = {
    find: jest.fn().mockResolvedValue(taskResultRecord),
    findLatestForTask: jest.fn().mockResolvedValue(taskResultRecord),
    listForExecution: jest.fn().mockResolvedValue([]),
    updateJudge: jest.fn().mockResolvedValue(true),
    pushJudgeHistory: jest.fn().mockResolvedValue(true),
  };
  const outputFormatRepository = {
    findActive: jest.fn().mockResolvedValue(null),
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
        relevanceScore: 80,
        specificityScore: 80,
        formatComplianceScore: 80,
        evidenceGroundingScore: 80,
        handoffReadinessScore: 80,
        hitlAppropriatenessScore: 80,
        determinismScore: 80,
        costEfficiencyScore: 50,
        stepOptimizationPriority: 20,
        playbookOptimizationPriority: 20,
        costOptimizationPriority: 0,
        estimatedTokenReductionPct: null,
        estimatedLatencyReductionPct: null,
        riskSeverity: 'low',
        blockingIssueCount: 0,
        downstreamImpactLevel: 'none',
        recommendedAction: 'review_only',
        availableActions: { optimizeStep: true, optimizePlaybook: true },
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
        costOptimizationHints: [],
        scriptReplacementHints: [],
        llmStillRequiredReasons: [],
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
        relevanceScore: 84,
        specificityScore: 84,
        formatComplianceScore: 84,
        evidenceGroundingScore: 84,
        handoffReadinessScore: 84,
        hitlAppropriatenessScore: 84,
        determinismScore: 84,
        costEfficiencyScore: 50,
        stepOptimizationPriority: 16,
        playbookOptimizationPriority: 16,
        costOptimizationPriority: 0,
        estimatedTokenReductionPct: null,
        estimatedLatencyReductionPct: null,
        riskSeverity: 'low',
        blockingIssueCount: 0,
        downstreamImpactLevel: 'none',
        recommendedAction: 'review_only',
        availableActions: { optimizeStep: true, optimizePlaybook: true },
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
        costOptimizationHints: [],
        scriptReplacementHints: [],
        llmStillRequiredReasons: [],
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
  const flowService = { findOne: jest.fn() };
  const intentService = { analyze: jest.fn() };

  return {
    service: new PlaybookFlowExecutionAdvisorService(
      executionRepository as any,
      taskResultRepository as any,
      outputFormatRepository as any,
      streamEvents as any,
      mapper,
      heuristicEvaluator as any,
      llmEvaluator as any,
      flowService as any,
      intentService as any,
    ),
    executionRepository,
    taskResultRepository,
    taskResultRecord,
    outputFormatRepository,
    heuristicEvaluator,
    llmEvaluator,
    flowService,
    intentService,
    streamEvents,
  };
}

describe('PlaybookFlowExecutionAdvisorService', () => {
  it('uses llm scoring by default and appends usage metadata', async () => {
    const { service, taskResultRepository, executionRepository, streamEvents, heuristicEvaluator, llmEvaluator } = createService();

    const result = await service.runTaskEvaluation('exec-1', 'task-1', 'user-1');

    expect(executionRepository.findById).toHaveBeenCalledWith('exec-1', { withSnapshot: true });
    expect(taskResultRepository.findLatestForTask).toHaveBeenCalledWith('exec-1', 'task-1');
    expect(llmEvaluator.evaluate).toHaveBeenCalledTimes(1);
    expect(heuristicEvaluator.evaluate).toHaveBeenCalledTimes(1);
    expect(taskResultRepository.updateJudge).toHaveBeenCalledTimes(1);
    expect(taskResultRepository.updateJudge).toHaveBeenCalledWith('tr-1', { judgeStatus: 'evaluating', judgeError: null });
    expect(taskResultRepository.pushJudgeHistory).toHaveBeenCalledWith(
      'tr-1',
      expect.objectContaining({ attemptNumber: 1, scoringMode: 'llm', usage: expect.objectContaining({ totalTokens: 15 }) }),
      expect.objectContaining({ judgeStatus: 'evaluated', judgeScoringMode: 'llm', judgeError: null, judgeResult: expect.objectContaining({ overallScore: 80 }) }),
    );
    expect(streamEvents.emitStepJudgeStarted).toHaveBeenCalledWith('user-1', 'exec-1', 'task-1', 0, 'llm');
    expect(streamEvents.emitStepJudgeUpdated).toHaveBeenCalledWith(
      'user-1',
      'exec-1',
      'task-1',
      expect.objectContaining({ judgeStatus: 'evaluated', advisorScoringMode: 'llm' }),
      0,
    );
    expect(result.taskResult.judgeStatus).toBe('evaluated');
    expect(result.taskResult.judgeScoringMode).toBe('llm');
    expect(result.taskResult.judgeHistory).toHaveLength(1);
    expect(result.taskResult.judgeHistory[0]).toMatchObject({
      scoringMode: 'llm',
      usage: { totalTokens: 15 },
    });
    expect(result.taskResult.iteration).toBe(0);
    // A task result without an error answers with no error key, as the Mongo document did.
    expect(result.taskResult.error).toBeUndefined();
  });

  it('reads the requested iteration and numbers the attempt after the stored history', async () => {
    const { service, taskResultRepository, taskResultRecord } = createService();
    taskResultRecord.iteration = 2;
    taskResultRecord.judgeHistory = [{
      id: 'h-1', createdAt: new Date('2026-01-01T00:00:00Z'), attemptNumber: 1, scoringMode: 'heuristic', judgeResult: { overallScore: 10 },
    }];

    const result = await service.runTaskEvaluation('exec-1', 'task-1', 'user-1', { iteration: 2 });

    expect(taskResultRepository.find).toHaveBeenCalledWith({ executionId: 'exec-1', taskId: 'task-1', iteration: 2 });
    expect(taskResultRepository.findLatestForTask).not.toHaveBeenCalled();
    expect(taskResultRepository.pushJudgeHistory).toHaveBeenCalledWith('tr-1', expect.objectContaining({ attemptNumber: 2 }), expect.anything());
    expect(result.taskResult.judgeHistory).toHaveLength(2);
    expect(result.taskResult.judgeHistory[0]).toMatchObject({ id: 'h-1', createdAt: '2026-01-01T00:00:00.000Z', scoringMode: 'heuristic' });
  });

  it('returns not found when the task result does not exist', async () => {
    const { service, taskResultRepository } = createService();
    taskResultRepository.findLatestForTask.mockResolvedValue(null);

    await expect(service.runTaskEvaluation('exec-1', 'task-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(taskResultRepository.updateJudge).not.toHaveBeenCalled();
  });

  it('passes the active output format guide of the node to the evaluator', async () => {
    const { service, outputFormatRepository, llmEvaluator } = createService();
    outputFormatRepository.findActive.mockResolvedValue({ formatGuide: 'Use a table.' });

    await service.runTaskEvaluation('exec-1', 'task-1', 'user-1');

    expect(outputFormatRepository.findActive).toHaveBeenCalledWith('507f1f77bcf86cd799439011', 'task-1');
    expect(llmEvaluator.evaluate).toHaveBeenCalledWith(expect.objectContaining({ outputFormatGuide: 'Use a table.' }));
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
    const { service, executionRepository } = createService();
    executionRepository.findById.mockResolvedValue(null);

    await expect(service.runTaskEvaluation('exec-1', 'task-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns not found when another user owns the execution', async () => {
    const { service } = createService();

    await expect(service.runTaskEvaluation('exec-1', 'task-1', 'user-2')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects non-completed task results', async () => {
    const { service, taskResultRepository } = createService();
    taskResultRepository.findLatestForTask.mockResolvedValue({ id: 'tr-2', iteration: 0, status: 'running', judgeHistory: [] });

    await expect(service.runTaskEvaluation('exec-1', 'task-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(taskResultRepository.updateJudge).not.toHaveBeenCalled();
  });

  it('stores failed advisor status when llm evaluation errors', async () => {
    const { service, llmEvaluator, taskResultRepository, streamEvents } = createService();
    llmEvaluator.evaluate.mockRejectedValueOnce(new Error('llm failed'));

    const result = await service.runTaskEvaluation('exec-1', 'task-1', 'user-1');

    expect(taskResultRepository.updateJudge).toHaveBeenLastCalledWith('tr-1', { judgeStatus: 'failed', judgeError: 'llm failed' });
    expect(taskResultRepository.pushJudgeHistory).not.toHaveBeenCalled();
    expect(result.taskResult.judgeStatus).toBe('failed');
    expect(result.taskResult.judgeHistory).toEqual([]);
    expect(streamEvents.emitStepJudgeUpdated).toHaveBeenCalledWith(
      'user-1',
      'exec-1',
      'task-1',
      expect.objectContaining({ judgeStatus: 'failed', judgeError: 'llm failed', advisorScoringMode: 'llm' }),
      0,
    );
  });

  it('lists the judge findings of the run as remediation items', async () => {
    const { service, taskResultRepository } = createService();
    taskResultRepository.listForExecution.mockResolvedValue([
      { taskId: 'task-1', judgeResult: { missingFacts: ['Add the totals'], costOptimizationPriority: 0, scriptReplacementHints: ['Use a script'] } },
      { taskId: 'task-2', judgeResult: null },
    ]);

    const items = await service.getRemediations('exec-1', 'user-1', 'task-1');

    expect(taskResultRepository.listForExecution).toHaveBeenCalledWith('exec-1', { taskIds: ['task-1'], light: true, with: ['judgeResult'] });
    expect(items).toEqual([
      expect.objectContaining({ id: 'task-1-structure-0', scope: 'task', targetTaskId: 'task-1', severity: 'medium', suggestedAction: 'optimize_step' }),
      expect.objectContaining({ id: 'task-1-cost_efficiency-0', severity: 'low', suggestedAction: 'replace_with_deterministic_script' }),
    ]);

    await service.getRemediations('exec-1', 'user-1');
    expect(taskResultRepository.listForExecution).toHaveBeenLastCalledWith('exec-1', { light: true, with: ['judgeResult'] });
    await expect(service.getRemediations('exec-1', 'user-2')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('previews optimize-step remediation with the model suggestion instead of direct fallback', async () => {
    const { service, executionRepository, flowService, intentService } = createService();
    executionRepository.findById.mockResolvedValue({
      id: 'exec-1',
      ownerId: 'user-1',
      flowId: 'flow-1',
    });
    flowService.findOne.mockResolvedValue({
      definitionRevision: 3,
      nodes: [{ id: 'task-1', label: 'Generate PDF', description: 'Old description' }],
    });
    intentService.analyze.mockResolvedValue({
      suggestions: [
        {
          id: 'intent-fallback',
          kind: 'single_change',
          label: '',
          summary: 'advisor prompt text',
          reason: '',
          confidence: 1,
          operationType: 'update_node',
          task: { title: 'advisor prompt text', description: 'advisor prompt text' },
          targetTaskId: 'task-1',
          isDirectIntentFallback: true,
        },
        {
          id: 'intent-0',
          kind: 'single_change',
          label: 'Improve PDF generation',
          summary: '',
          reason: '',
          confidence: 0.65,
          operationType: 'update_node',
          task: { title: 'Generate PDF', description: 'Improved description' },
          targetTaskId: 'task-1',
          isDirectIntentFallback: false,
        },
      ],
      model: 'model',
      settings: {},
    });

    const preview = await service.previewRemediation('flow-1', 'user-1', {
      executionId: 'exec-1',
      mode: 'optimize-step',
      targetTaskId: 'task-1',
      items: [{ id: 'item-1', category: 'prompt', description: 'Clarify output filename.' }],
    });

    expect(preview.suggestion.id).toBe('intent-0');
    expect(preview.suggestion.kind).toBe('single_change');
    if (preview.suggestion.kind === 'single_change') {
      expect(preview.suggestion.task).toMatchObject({ description: 'Improved description' });
    }
    expect(preview.validation.valid).toBe(true);
    expect(preview.expectedDefinitionRevision).toBe(3);
  });

  it('builds optimize-step fallback intent with no selected findings', async () => {
    const { service, executionRepository, flowService, intentService } = createService();
    executionRepository.findById.mockResolvedValue({ id: 'exec-1', ownerId: 'user-1', flowId: 'flow-1' });
    flowService.findOne.mockResolvedValue({
      definitionRevision: 3,
      nodes: [{ id: 'task-1', label: 'Generate PDF', description: 'Old description' }],
    });
    intentService.analyze.mockResolvedValueOnce({
      suggestions: [{
        id: 'intent-1',
        kind: 'single_change',
        label: 'Improve step',
        summary: '',
        reason: '',
        confidence: 0.7,
        operationType: 'update_node',
        task: { description: 'Improved deterministic contract' },
        targetTaskId: 'task-1',
        isDirectIntentFallback: false,
      }],
      model: 'model',
      settings: {},
    });

    const preview = await service.previewRemediation('flow-1', 'user-1', {
      executionId: 'exec-1',
      mode: 'optimize-step',
      targetTaskId: 'task-1',
      items: [],
    });

    expect(preview.suggestion.id).toBe('intent-1');
    expect(preview.intent).toContain('No specific advisor findings were selected');
  });

  it('rejects optimize-step suggestions targeting another task', async () => {
    const { service, executionRepository, flowService, intentService } = createService();
    executionRepository.findById.mockResolvedValue({ id: 'exec-1', ownerId: 'user-1', flowId: 'flow-1' });
    flowService.findOne.mockResolvedValue({
      definitionRevision: 3,
      nodes: [{ id: 'task-1', label: 'Generate PDF', description: 'Old description' }],
    });
    intentService.analyze.mockResolvedValueOnce({
      suggestions: [{
        id: 'bad-intent',
        kind: 'single_change',
        label: 'Wrong target',
        summary: '',
        reason: '',
        confidence: 0.9,
        operationType: 'update_node',
        task: { description: 'Wrong node' },
        targetTaskId: 'task-2',
        isDirectIntentFallback: false,
      }],
      model: 'model',
      settings: {},
    });

    await expect(service.previewRemediation('flow-1', 'user-1', {
      executionId: 'exec-1',
      mode: 'optimize-step',
      targetTaskId: 'task-1',
      items: [],
    })).rejects.toThrow('Advisor remediation did not produce an applicable suggestion.');
  });
});
