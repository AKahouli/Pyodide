import { PlaybookRepeatabilityService } from './playbook-repeatability.service';

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

  const mockFindOne = (value: any) => ({
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  });

  beforeEach(() => {
    playbookModel = { findById: jest.fn() };
    executionModel = { find: jest.fn() };
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
        overallVerdict: 'no_baseline',
        totalTasks: 0,
        evaluatedTasks: 0,
        tasks: [],
      });
    });

    it('returns no_baseline when playbook has no tasks', async () => {
      playbookModel.findById.mockReturnValue(mockFindOne({ _id: '507f1f77bcf86cd799439011', tasks: [] }));

      const result = await service.getRepeatability('507f1f77bcf86cd799439011');
      expect(result.overallVerdict).toBe('no_baseline');
      expect(result.totalTasks).toBe(0);
    });

    it('returns insufficient_data when fewer than 2 completed executions', async () => {
      playbookModel.findById.mockReturnValue(mockFindOne({
        _id: '507f1f77bcf86cd799439011',
        tasks: [{ id: 't1', title: 'Step 1', taskType: 'generic' }],
      }));

      executionModel.find.mockReturnValue(mockChain([]));

      const result = await service.getRepeatability('507f1f77bcf86cd799439011');
      expect(result.overallVerdict).toBe('insufficient_data');
      expect(result.tasks[0].verdict).toBe('insufficient_data');
    });

    it('computes repeatability with golden baseline and matching outputs', async () => {
      const taskId = 't1';
      playbookModel.findById.mockReturnValue(mockFindOne({
        _id: '507f1f77bcf86cd799439011',
        tasks: [{ id: taskId, title: 'Revenue Analysis', taskType: 'generic', expectedResult: null }],
      }));

      const baselineOutput = 'Revenue is $1.2M with 15% growth';
      const matchingOutput = 'Revenue is $1.2M with 15% growth';
      const slightlyDifferentOutput = 'Revenue is $1.1M with 14% growth';

      executionModel.find.mockReturnValue(mockChain([
        { _id: 'e1', executionNumber: 1, status: 'completed', taskResults: [{ taskId, status: 'completed', output: matchingOutput }] },
        { _id: 'e2', executionNumber: 2, status: 'completed', taskResults: [{ taskId, status: 'completed', output: slightlyDifferentOutput }] },
      ]));

      replayModel.find.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve([{ taskId, referenceOutput: baselineOutput }]) }) });

      const result = await service.getRepeatability('507f1f77bcf86cd799439011');
      expect(result.overallVerdict).toBe('stable');
      expect(result.tasks[0].expectedResultSource).toBe('golden_baseline');
      expect(result.tasks[0].repeatabilityScore).toBeGreaterThan(50);
      expect(result.tasks[0].comparableCount).toBe(2);
    });

    it('uses node_field expectedResult over golden baseline', async () => {
      const taskId = 't1';
      playbookModel.findById.mockReturnValue(mockFindOne({
        _id: '507f1f77bcf86cd799439011',
        tasks: [{ id: taskId, title: 'Step 1', taskType: 'generic', expectedResult: 'Expected output text' }],
      }));

      executionModel.find.mockReturnValue(mockChain([
        { _id: 'e1', executionNumber: 1, status: 'completed', taskResults: [{ taskId, status: 'completed', output: 'Expected output text' }] },
        { _id: 'e2', executionNumber: 2, status: 'completed', taskResults: [{ taskId, status: 'completed', output: 'Expected output text' }] },
      ]));

      replayModel.find.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve([{ taskId, referenceOutput: 'Golden baseline' }]) }) });

      const result = await service.getRepeatability('507f1f77bcf86cd799439011');
      expect(result.tasks[0].expectedResultSource).toBe('node_field');
      expect(result.tasks[0].repeatabilityScore).toBe(100);
    });

    it('returns no_baseline when task has no expectedResult and no replay', async () => {
      const taskId = 't1';
      playbookModel.findById.mockReturnValue(mockFindOne({
        _id: '507f1f77bcf86cd799439011',
        tasks: [{ id: taskId, title: 'Step 1', taskType: 'generic' }],
      }));

      executionModel.find.mockReturnValue(mockChain([
        { _id: 'e1', executionNumber: 1, status: 'completed', taskResults: [{ taskId, status: 'completed', output: 'output' }] },
        { _id: 'e2', executionNumber: 2, status: 'completed', taskResults: [{ taskId, status: 'completed', output: 'output' }] },
      ]));

      replayModel.find.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve([]) }) });

      const result = await service.getRepeatability('507f1f77bcf86cd799439011');
      expect(result.tasks[0].verdict).toBe('no_baseline');
      expect(result.tasks[0].repeatabilityScore).toBeNull();
    });

    it('filters out evaluation tasks from analysis', async () => {
      playbookModel.findById.mockReturnValue(mockFindOne({
        _id: '507f1f77bcf86cd799439011',
        tasks: [
          { id: 't1', title: 'Agent Step', taskType: 'generic' },
          { id: 't2', title: 'Eval Step', taskType: 'evaluation' },
        ],
      }));

      executionModel.find.mockReturnValue(mockChain([
        { _id: 'e1', executionNumber: 1, status: 'completed', taskResults: [{ taskId: 't1', status: 'completed', output: 'output' }] },
        { _id: 'e2', executionNumber: 2, status: 'completed', taskResults: [{ taskId: 't1', status: 'completed', output: 'output' }] },
      ]));

      replayModel.find.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve([]) }) });

      const result = await service.getRepeatability('507f1f77bcf86cd799439011');
      expect(result.totalTasks).toBe(1);
      expect(result.tasks[0].taskId).toBe('t1');
    });

    it('reports unstable when outputs diverge significantly', async () => {
      const taskId = 't1';
      playbookModel.findById.mockReturnValue(mockFindOne({
        _id: '507f1f77bcf86cd799439011',
        tasks: [{ id: taskId, title: 'Step 1', taskType: 'generic', expectedResult: 'The revenue is growing at 15% year over year' }],
      }));

      executionModel.find.mockReturnValue(mockChain([
        { _id: 'e1', executionNumber: 1, status: 'completed', taskResults: [{ taskId, status: 'completed', output: 'The revenue is growing at 15% year over year' }] },
        { _id: 'e2', executionNumber: 2, status: 'completed', taskResults: [{ taskId, status: 'completed', output: 'Completely different output about weather patterns and climate change data' }] },
      ]));

      replayModel.find.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve([]) }) });

      const result = await service.getRepeatability('507f1f77bcf86cd799439011');
      expect(result.overallVerdict).toBe('unstable');
      expect(result.tasks[0].findings.length).toBeGreaterThan(0);
    });
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

    it('returns task repeatability for specific task', async () => {
      const taskId = 't1';
      playbookModel.findById.mockReturnValue(mockFindOne({
        _id: '507f1f77bcf86cd799439011',
        tasks: [{ id: taskId, title: 'Step 1', taskType: 'generic', expectedResult: 'Expected' }],
      }));

      executionModel.find.mockReturnValue(mockChain([
        { _id: 'e1', executionNumber: 1, status: 'completed', taskResults: [{ taskId, status: 'completed', output: 'Expected' }] },
        { _id: 'e2', executionNumber: 2, status: 'completed', taskResults: [{ taskId, status: 'completed', output: 'Expected' }] },
      ]));

      replayModel.find.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve([]) }) });

      const result = await service.getTaskRepeatability('507f1f77bcf86cd799439011', taskId);
      expect(result).not.toBeNull();
      expect(result!.taskId).toBe(taskId);
      expect(result!.repeatabilityScore).toBe(100);
      expect(result!.expectedResultSource).toBe('node_field');
    });
  });
});
