import { PlaybookFlowResultsService } from './playbook-flow-results.service';

describe('PlaybookFlowResultsService', () => {
  const taskResultRepository = { upsert: jest.fn(), find: jest.fn(), listForExecution: jest.fn() };
  const service = new PlaybookFlowResultsService(taskResultRepository as any);
  const key = { executionId: 'exec-1', taskId: 'task-1', iteration: 2 };

  beforeEach(() => {
    jest.clearAllMocks();
    taskResultRepository.upsert.mockResolvedValue(true);
    taskResultRepository.find.mockResolvedValue({ id: 'result-1', ...key, status: 'completed' });
    taskResultRepository.listForExecution.mockResolvedValue([]);
  });

  it('upserts the result of one task iteration and returns it as stored', async () => {
    const endedAt = new Date('2026-09-01T10:00:00Z');

    await expect(service.upsertResult('exec-1', 'task-1', 2, { status: 'completed', output: 'done', endedAt })).resolves.toEqual({ id: 'result-1', ...key, status: 'completed' });

    expect(taskResultRepository.upsert).toHaveBeenCalledWith(key, { status: 'completed', output: 'done', endedAt });
    expect(taskResultRepository.find).toHaveBeenCalledWith(key);
  });

  it('writes only the fields it is given', async () => {
    await service.upsertResult('exec-1', 'task-1', 2, { error: 'boom' });

    expect(taskResultRepository.upsert).toHaveBeenCalledWith(key, { error: 'boom' });
  });

  it('returns null when the execution no longer exists', async () => {
    taskResultRepository.upsert.mockResolvedValue(false);

    await expect(service.upsertResult('exec-1', 'task-1', 2, { status: 'running' })).resolves.toBeNull();
    expect(taskResultRepository.find).not.toHaveBeenCalled();
  });

  it('lists the results of an execution, or of one of its tasks, in task and iteration order', async () => {
    await service.getResults('exec-1');
    await service.getResultsForTask('exec-1', 'task-1');

    expect(taskResultRepository.listForExecution).toHaveBeenNthCalledWith(1, 'exec-1');
    expect(taskResultRepository.listForExecution).toHaveBeenNthCalledWith(2, 'exec-1', { taskIds: ['task-1'] });
  });
});
