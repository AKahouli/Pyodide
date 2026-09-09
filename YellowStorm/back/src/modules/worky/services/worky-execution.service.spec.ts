import { Types } from 'mongoose';
import { WorkyExecutionService } from './worky-execution.service';

describe('WorkyExecutionService.moveTask', () => {
  it('resets execution state when a task is moved to backlog', async () => {
    const taskId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const task = {
      _id: taskId,
      id: taskId.toString(),
      streamId: new Types.ObjectId(),
      title: 'Draft brief',
      lane: 'running',
      executionState: 'running',
      set: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const tasks = {
      findById: jest.fn().mockReturnValue({ exec: () => Promise.resolve(task) }),
    };
    const streams = {
      findById: jest.fn().mockReturnValue({
        select: () => ({
          lean: () => ({ exec: () => Promise.resolve({ ownerUserId: userId }) }),
        }),
      }),
    };
    const events = { emit: jest.fn() };
    const service = new WorkyExecutionService(streams as never, tasks as never, events as never);

    const result = await service.moveTask(taskId.toString(), userId.toString(), 'backlog');

    expect(task.executionState).toBe('not_started');
    expect(result).toMatchObject({ lane: 'backlog', executionState: 'not_started' });
  });
});
