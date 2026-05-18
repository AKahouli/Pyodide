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
  const grpcService = {
    isAvailable: true,
    evaluateTask: jest.fn().mockResolvedValue({
      accuracy_score: 80,
      completeness_score: 70,
      result_matching_score: 75,
      overall_score: 76,
      confidence: 0.8,
      tool_usage_score: 68,
      expected_result_source: 'node_field',
      expected_result_type: 'semantic_description',
      expected_result_matched: true,
      expected_result_reason: 'Matched',
      missing_facts: [],
      incoherences: [],
      unsupported_claims: [],
      handoff_risks: [],
      rewrite_hints: [],
      tool_selection_issues: [],
      missing_tool_calls: [],
      redundant_tool_calls: [],
      tool_output_use_issues: [],
      tool_sequencing_issues: [],
      tool_usage_strengths: [],
      tool_usage_recommendation: 'Looks fine',
      safe_auto_fix_type: 'none',
      recommendation: 'none',
      reason: 'Done',
      model: 'advisor-v1',
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
      grpcService as any,
      streamEvents as any,
      mapper,
    ),
    executionModel,
    taskResultModel,
    taskResultDocument,
    outputFormatModel,
    grpcService,
    streamEvents,
  };
}

describe('PlaybookFlowExecutionAdvisorService', () => {
  it('evaluates a completed task and appends judge history', async () => {
    const { service, taskResultDocument, streamEvents } = createService();

    const result = await service.runTaskEvaluation('exec-1', 'task-1', 'user-1');

    expect(taskResultDocument.save).toHaveBeenCalledTimes(2);
    expect(streamEvents.emitStepJudgeStarted).toHaveBeenCalledWith('user-1', 'exec-1', 'task-1', undefined);
    expect(streamEvents.emitStepJudgeUpdated).toHaveBeenCalledWith(
      'user-1',
      'exec-1',
      'task-1',
      expect.objectContaining({ judgeStatus: 'evaluated' }),
      undefined,
    );
    expect(result.taskResult.judgeStatus).toBe('evaluated');
    expect(result.taskResult.judgeHistory).toHaveLength(1);
    expect(result.taskResult.iteration).toBeUndefined();
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

  it('stores failed advisor status when grpc evaluation errors', async () => {
    const { service, grpcService, taskResultDocument, streamEvents } = createService();
    grpcService.evaluateTask.mockRejectedValueOnce(new Error('grpc failed'));

    const result = await service.runTaskEvaluation('exec-1', 'task-1', 'user-1');

    expect(taskResultDocument.judgeStatus).toBe('failed');
    expect(result.taskResult.judgeStatus).toBe('failed');
    expect(streamEvents.emitStepJudgeUpdated).toHaveBeenCalledWith(
      'user-1',
      'exec-1',
      'task-1',
      expect.objectContaining({ judgeStatus: 'failed', judgeError: 'grpc failed' }),
      undefined,
    );
  });
});
