import { Types } from 'mongoose';
import { PlaybookRepeatabilityService } from './playbook-repeatability.service';
import { StepStatus } from '../schemas/playbook-execution.schema';

describe('PlaybookRepeatabilityService', () => {
  let service: PlaybookRepeatabilityService;
  let playbookModel: any;
  let executionModel: any;
  let replayModel: any;
  let logger: any;

  const mockChain = (value: any) => ({
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  });

  const mockCountChain = (value: any) => ({
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  });

  const mockFindOne = (value: any) => ({
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  });

  beforeEach(() => {
    playbookModel = { findById: jest.fn() };
    executionModel = { find: jest.fn(), countDocuments: jest.fn() };
    replayModel = { find: jest.fn() };
    logger = { setContext: jest.fn(), warn: jest.fn() };

    service = new PlaybookRepeatabilityService(
      playbookModel,
      executionModel,
      replayModel,
      logger,
    );
  });

  describe('resolveExpectedResult', () => {
    it('returns node_field when task has expectedResult', () => {
      const result = service.resolveExpectedResult(
        { expectedResult: 'Revenue is $1M' },
        'Golden baseline output',
      );
      expect(result).toEqual({ value: 'Revenue is $1M', source: 'node_field' });
    });

    it('returns node_field even if golden baseline exists', () => {
      const result = service.resolveExpectedResult(
        { expectedResult: 'Custom expected' },
        'Golden baseline output',
      );
      expect(result).toEqual({ value: 'Custom expected', source: 'node_field' });
    });

    it('falls back to golden_baseline when expectedResult is empty', () => {
      const result = service.resolveExpectedResult(
        { expectedResult: '' },
        'Golden baseline output',
      );
      expect(result).toEqual({ value: 'Golden baseline output', source: 'golden_baseline' });
    });

    it('falls back to golden_baseline when expectedResult is null', () => {
      const result = service.resolveExpectedResult(
        { expectedResult: null },
        'Golden baseline output',
      );
      expect(result).toEqual({ value: 'Golden baseline output', source: 'golden_baseline' });
    });

    it('returns none when both are absent', () => {
      const result = service.resolveExpectedResult({}, null);
      expect(result).toEqual({ value: null, source: 'none' });
    });

    it('returns none when both are empty/whitespace', () => {
      const result = service.resolveExpectedResult({ expectedResult: '   ' }, null);
      expect(result).toEqual({ value: null, source: 'none' });
    });

    it('trims whitespace from expectedResult', () => {
      const result = service.resolveExpectedResult(
        { expectedResult: '  trimmed value  ' },
        null,
      );
      expect(result).toEqual({ value: 'trimmed value', source: 'node_field' });
    });
  });

  describe('getRepeatability', () => {
    it('returns empty summary when playbook not found', async () => {
      playbookModel.findById.mockReturnValue(mockFindOne(null));

      const result = await service.getRepeatability('507f1f77bcf86cd799439011');
      expect(result).toMatchObject({
        playbookId: '507f1f77bcf86cd799439011',
        totalIterations: 0,
        overallAverageMatchScore: null,
        overallAdvisorScore: null,
        iterations: [],
      });
    });

    it('returns empty summary when playbook has no tasks', async () => {
      playbookModel.findById.mockReturnValue(mockFindOne({ _id: '507f1f77bcf86cd799439011', tasks: [] }));

      const result = await service.getRepeatability('507f1f77bcf86cd799439011');
      expect(result.totalIterations).toBe(0);
      expect(result.iterations.length).toBe(0);
    });

    it('returns empty iterations when fewer than 2 completed executions', async () => {
      playbookModel.findById.mockReturnValue(mockFindOne({
        _id: '507f1f77bcf86cd799439011',
        tasks: [{ id: 't1', title: 'Step 1', taskType: 'generic' }],
      }));

      executionModel.countDocuments.mockResolvedValue(1);
      executionModel.find.mockReturnValue(mockChain([]));

      const result = await service.getRepeatability('507f1f77bcf86cd799439011');
      expect(result.totalIterations).toBe(1);
      expect(result.evaluatedIterations).toBe(0);
    });

    it('computes iteration summaries with golden baseline and matching outputs', async () => {
      const taskId = 't1';
      playbookModel.findById.mockReturnValue(mockFindOne({
        _id: '507f1f77bcf86cd799439011',
        tasks: [{ id: taskId, title: 'Revenue Analysis', taskType: 'generic', expectedResult: null }],
      }));

      const baselineOutput = 'Revenue is $1.2M with 15% growth';
      const matchingOutput = 'Revenue is $1.2M with 15% growth';
      const slightlyDifferentOutput = 'Revenue is $1.1M with 14% growth';

      executionModel.countDocuments.mockResolvedValue(2);
      executionModel.find.mockReturnValue(mockChain([
        { _id: 'e1', executionNumber: 1, completedAt: new Date(), taskResults: [{ taskId, status: 'completed', output: matchingOutput }] },
        { _id: 'e2', executionNumber: 2, completedAt: new Date(), taskResults: [{ taskId, status: 'completed', output: slightlyDifferentOutput }] },
      ]));

      replayModel.find.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve([{ taskId, referenceOutput: baselineOutput }]) }) });

      const result = await service.getRepeatability('507f1f77bcf86cd799439011');
      expect(result.iterations.length).toBe(2);
      const firstTask = result.iterations[0].tasks[0];
      expect(firstTask.expectedResultSource).toBe('golden_baseline');
      expect(firstTask.evaluated).toBe(true);
    });

    it('uses node_field expectedResult over golden baseline', async () => {
      const taskId = 't1';
      playbookModel.findById.mockReturnValue(mockFindOne({
        _id: '507f1f77bcf86cd799439011',
        tasks: [{ id: taskId, title: 'Step 1', taskType: 'generic', expectedResult: 'Expected output text' }],
      }));

      executionModel.countDocuments.mockResolvedValue(2);
      executionModel.find.mockReturnValue(mockChain([
        { _id: 'e1', executionNumber: 1, completedAt: new Date(), taskResults: [{ taskId, status: 'completed', output: 'Expected output text' }] },
        { _id: 'e2', executionNumber: 2, completedAt: new Date(), taskResults: [{ taskId, status: 'completed', output: 'Expected output text' }] },
      ]));

      replayModel.find.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve([{ taskId, referenceOutput: 'Golden baseline' }]) }) });

      const result = await service.getRepeatability('507f1f77bcf86cd799439011');
      expect(result.iterations[0].tasks[0].expectedResultSource).toBe('node_field');
      expect(result.iterations[0].tasks[0].evaluated).toBe(true);
    });

    it('returns not_evaluated when task has no expectedResult and no replay', async () => {
      const taskId = 't1';
      playbookModel.findById.mockReturnValue(mockFindOne({
        _id: '507f1f77bcf86cd799439011',
        tasks: [{ id: taskId, title: 'Step 1', taskType: 'generic' }],
      }));

      executionModel.countDocuments.mockResolvedValue(2);
      executionModel.find.mockReturnValue(mockChain([
        { _id: 'e1', executionNumber: 1, completedAt: new Date(), taskResults: [{ taskId, status: 'completed', output: 'output' }] },
        { _id: 'e2', executionNumber: 2, completedAt: new Date(), taskResults: [{ taskId, status: 'completed', output: 'output' }] },
      ]));

      replayModel.find.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve([]) }) });

      const result = await service.getRepeatability('507f1f77bcf86cd799439011');
      const task = result.iterations[0].tasks[0];
      expect(task.matchState).toBe('not_evaluated');
      expect(task.evaluated).toBe(false);
      expect(task.passed).toBe(false);
    });

    it('filters out evaluation tasks from analysis', async () => {
      playbookModel.findById.mockReturnValue(mockFindOne({
        _id: '507f1f77bcf86cd799439011',
        tasks: [
          { id: 't1', title: 'Agent Step', taskType: 'generic' },
          { id: 't2', title: 'Eval Step', taskType: 'evaluation' },
        ],
      }));

      executionModel.countDocuments.mockResolvedValue(2);
      executionModel.find.mockReturnValue(mockChain([
        { _id: 'e1', executionNumber: 1, completedAt: new Date(), taskResults: [{ taskId: 't1', status: 'completed', output: 'output' }] },
        { _id: 'e2', executionNumber: 2, completedAt: new Date(), taskResults: [{ taskId: 't1', status: 'completed', output: 'output' }] },
      ]));

      replayModel.find.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve([]) }) });

      const result = await service.getRepeatability('507f1f77bcf86cd799439011');
      expect(result.iterations[0].taskCount).toBe(1);
      expect(result.iterations[0].tasks[0].taskId).toBe('t1');
    });

    it('computes matched/passed state from advisor judgeResult', async () => {
      const taskId = 't1';
      playbookModel.findById.mockReturnValue(mockFindOne({
        _id: '507f1f77bcf86cd799439011',
        tasks: [{ id: taskId, title: 'Step 1', taskType: 'generic', expectedResult: 'Expected' }],
      }));

      executionModel.countDocuments.mockResolvedValue(2);
      executionModel.find.mockReturnValue(mockChain([
        {
          _id: 'e1', executionNumber: 1, completedAt: new Date(),
          taskResults: [{ taskId, status: 'completed', output: 'Expected', judgeResult: { expectedResultMatched: true, resultMatchingScore: 95, expectedResultSource: 'node_field', expectedResultType: 'exact_value', expectedResultReason: 'Good' } }],
        },
        {
          _id: 'e2', executionNumber: 2, completedAt: new Date(),
          taskResults: [{ taskId, status: 'completed', output: 'Wrong', judgeResult: { expectedResultMatched: false, resultMatchingScore: 40, expectedResultSource: 'node_field', expectedResultType: 'exact_value', expectedResultReason: 'Bad' } }],
        },
      ]));

      replayModel.find.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve([]) }) });

      const result = await service.getRepeatability('507f1f77bcf86cd799439011');

      const iter1 = result.iterations[0];
      expect(iter1.tasks[0].matchState).toBe('matched');
      expect(iter1.tasks[0].passed).toBe(true);
      expect(iter1.passed).toBe(true);

      const iter2 = result.iterations[1];
      expect(iter2.tasks[0].matchState).toBe('not_matched');
      expect(iter2.tasks[0].passed).toBe(false);
      expect(iter2.passed).toBe(false);
    });

    it('computes overall average and passed iterations from evaluated iterations', async () => {
      const taskId = 't1';
      playbookModel.findById.mockReturnValue(mockFindOne({
        _id: '507f1f77bcf86cd799439011',
        tasks: [{ id: taskId, title: 'Step 1', taskType: 'generic', expectedResult: 'Expected' }],
      }));

      executionModel.countDocuments.mockResolvedValue(3);
      executionModel.find.mockReturnValue(mockChain([
        {
          _id: 'e1', executionNumber: 1, completedAt: new Date(),
          taskResults: [{ taskId, status: 'completed', output: 'A', judgeResult: { expectedResultMatched: true, resultMatchingScore: 90, overallScore: 92, expectedResultSource: 'node_field' } }],
        },
        {
          _id: 'e2', executionNumber: 2, completedAt: new Date(),
          taskResults: [{ taskId, status: 'completed', output: 'B', judgeResult: { expectedResultMatched: true, resultMatchingScore: 80, overallScore: 0.8, expectedResultSource: 'node_field' } }],
        },
        {
          _id: 'e3', executionNumber: 3, completedAt: new Date(),
          taskResults: [{ taskId, status: 'completed', output: 'C', judgeResult: { expectedResultMatched: false, resultMatchingScore: 50, overallScore: 50, expectedResultSource: 'node_field' } }],
        },
      ]));

      replayModel.find.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve([]) }) });

      const result = await service.getRepeatability('507f1f77bcf86cd799439011');
      expect(result.evaluatedIterations).toBe(3);
      expect(result.passedIterations).toBe(2);
      expect(result.overallAverageMatchScore).toBeGreaterThan(0);
      expect(result.overallAdvisorScore).toBe(74);
    });

    it('returns null advisor score when no advisor scores are available', async () => {
      const taskId = 't1';
      playbookModel.findById.mockReturnValue(mockFindOne({
        _id: '507f1f77bcf86cd799439011',
        tasks: [{ id: taskId, title: 'Step 1', taskType: 'generic', expectedResult: 'Expected' }],
      }));

      executionModel.countDocuments.mockResolvedValue(2);
      executionModel.find.mockReturnValue(mockChain([
        { _id: 'e1', executionNumber: 1, completedAt: new Date(), taskResults: [{ taskId, status: 'completed', output: 'Expected' }] },
        { _id: 'e2', executionNumber: 2, completedAt: new Date(), taskResults: [{ taskId, status: 'completed', output: 'Expected' }] },
      ]));

      replayModel.find.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve([]) }) });

      const result = await service.getRepeatability('507f1f77bcf86cd799439011');
      expect(result.overallAdvisorScore).toBeNull();
    });
  });

  it('prefers persisted resultMatchingScore over lexical similarity when available', async () => {
    const taskId = 'task-1';
    const playbookId = new Types.ObjectId().toHexString();
    playbookModel.findById.mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve({ tasks: [{ id: taskId, title: 'Step 1', taskType: 'generic', expectedResult: 'Generate a document with regional sales numbers' }] }) }),
    });
    executionModel.countDocuments.mockResolvedValue(2);
    executionModel.find.mockReturnValue({
      sort: () => ({
        lean: () => ({
          exec: () => Promise.resolve([
              {
                _id: new Types.ObjectId(),
                executionNumber: 2,
                completedAt: new Date(),
                taskResults: [{ taskId, status: StepStatus.COMPLETED, output: 'Done', judgeResult: { resultMatchingScore: 92, expectedResultSource: 'node_field' } }],
              },
              {
                _id: new Types.ObjectId(),
                executionNumber: 1,
                completedAt: new Date(),
                taskResults: [{ taskId, status: StepStatus.COMPLETED, output: 'Done again', judgeResult: { resultMatchingScore: 88, expectedResultSource: 'node_field' } }],
              },
            ]),
          }),
        }),
      });
    replayModel.find.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve([]) }) });

    const result = await service.getRepeatability(playbookId, 5);

    expect(result.iterations[0].tasks[0].matchScore).toBe(92);
    expect(result.iterations[1].tasks[0].matchScore).toBe(88);
  });

  describe('getTaskRepeatability', () => {
    it('returns null when playbook not found', async () => {
      playbookModel.findById.mockReturnValue(mockFindOne(null));

      const result = await service.getTaskRepeatability('507f1f77bcf86cd799439011', 't1');
      expect(result).toBeNull();
    });

    it('returns null when task not found', async () => {
      playbookModel.findById.mockReturnValue(mockFindOne({
        _id: '507f1f77bcf86cd799439011',
        tasks: [{ id: 'other-task', title: 'Other', taskType: 'generic' }],
      }));

      const result = await service.getTaskRepeatability('507f1f77bcf86cd799439011', 't1');
      expect(result).toBeNull();
    });

    it('returns task execution summaries across iterations', async () => {
      const taskId = 't1';
      playbookModel.findById.mockReturnValue(mockFindOne({
        _id: '507f1f77bcf86cd799439011',
        tasks: [{ id: taskId, title: 'Step 1', taskType: 'generic', expectedResult: 'Expected' }],
      }));

      executionModel.find.mockReturnValue(mockChain([
        { _id: 'e1', executionNumber: 1, completedAt: new Date(), taskResults: [{ taskId, status: 'completed', output: 'Expected', judgeResult: { expectedResultMatched: true, resultMatchingScore: 95 } }] },
        { _id: 'e2', executionNumber: 2, completedAt: new Date(), taskResults: [{ taskId, status: 'completed', output: 'Expected', judgeResult: { expectedResultMatched: true, resultMatchingScore: 90 } }] },
      ]));

      replayModel.find.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve([]) }) });

      const result = await service.getTaskRepeatability('507f1f77bcf86cd799439011', taskId);
      expect(result).not.toBeNull();
      expect(result!.length).toBe(2);
      expect(result![0].taskId).toBe(taskId);
      expect(result![0].expectedResultSource).toBe('node_field');
      expect(result![0].passed).toBe(true);
    });
  });

  describe('evaluateTaskExecution', () => {
    const evaluateTaskExecution = (
      execution: any,
      task: { id: string; title: string; expectedResult?: string | null },
      goldenBaselines = new Map<string, string>(),
    ) => (service as any).evaluateTaskExecution(execution, task, goldenBaselines);

    it('passes when judge explicitly matches expected result', () => {
      const result = evaluateTaskExecution(
        {
          _id: 'execution-1',
          completedAt: new Date('2026-04-27T10:00:00.000Z'),
          taskResults: [{
            taskId: 'task-1',
            status: StepStatus.COMPLETED,
            output: 'Final output',
            judgeResult: {
              expectedResultMatched: true,
              resultMatchingScore: 32,
              expectedResultSource: 'node_field',
              expectedResultType: 'semantic_description',
              expectedResultReason: 'Semantic meaning matches',
            },
          }],
        },
        { id: 'task-1', title: 'Task 1', expectedResult: 'Expected result' },
      );

      expect(result).toEqual(expect.objectContaining({
        expectedResultSource: 'node_field',
        expectedResultMatched: true,
        matchScore: 32,
        matchState: 'matched',
        evaluated: true,
        passed: true,
      }));
    });

    it('passes when judge does not match but score fallback is at least 80', () => {
      const result = evaluateTaskExecution(
        {
          _id: 'execution-2',
          completedAt: new Date('2026-04-27T10:00:00.000Z'),
          taskResults: [{
            taskId: 'task-1',
            status: StepStatus.COMPLETED,
            output: 'Nearly identical output',
            judgeResult: {
              expectedResultMatched: false,
              resultMatchingScore: 80,
              expectedResultSource: 'node_field',
              expectedResultType: 'semantic_description',
              expectedResultReason: 'Boolean false but score indicates acceptable similarity',
            },
          }],
        },
        { id: 'task-1', title: 'Task 1', expectedResult: 'Expected result' },
      );

      expect(result).toEqual(expect.objectContaining({
        expectedResultMatched: true,
        matchScore: 80,
        matchState: 'matched',
        evaluated: true,
        passed: true,
      }));
    });

    it('fails when judge does not match and score fallback is below 80', () => {
      const result = evaluateTaskExecution(
        {
          _id: 'execution-3',
          completedAt: new Date('2026-04-27T10:00:00.000Z'),
          taskResults: [{
            taskId: 'task-1',
            status: StepStatus.COMPLETED,
            output: 'Different output',
            judgeResult: {
              expectedResultMatched: false,
              resultMatchingScore: 79,
              expectedResultSource: 'node_field',
              expectedResultType: 'semantic_description',
              expectedResultReason: 'Below pass threshold',
            },
          }],
        },
        { id: 'task-1', title: 'Task 1', expectedResult: 'Expected result' },
      );

      expect(result).toEqual(expect.objectContaining({
        expectedResultMatched: false,
        matchScore: 79,
        matchState: 'not_matched',
        evaluated: true,
        passed: false,
      }));
    });

    it('returns not_evaluated when expected result source is none', () => {
      const result = evaluateTaskExecution(
        {
          _id: 'execution-4',
          completedAt: new Date('2026-04-27T10:00:00.000Z'),
          taskResults: [{
            taskId: 'task-1',
            status: StepStatus.COMPLETED,
            output: 'Some output',
            judgeResult: {
              expectedResultMatched: false,
              resultMatchingScore: 99,
              expectedResultSource: 'none',
              expectedResultType: 'none',
              expectedResultReason: 'No expected result configured',
            },
          }],
        },
        { id: 'task-1', title: 'Task 1', expectedResult: null },
      );

      expect(result).toEqual(expect.objectContaining({
        expectedResultSource: 'none',
        expectedResult: null,
        matchScore: null,
        matchState: 'not_evaluated',
        evaluated: false,
        passed: false,
      }));
    });
  });
});
