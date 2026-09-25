import { newObjectId } from '@common/postgres';
import { WorkyExecutionService } from './worky-execution.service';
import type { WorkyStreamRecord, WorkyTaskRecord } from '../worky.types';

const ownerId = newObjectId();

const makeTask = (over: Partial<WorkyTaskRecord> = {}) =>
  ({
    id: newObjectId(),
    streamId: newObjectId(),
    title: 'Draft brief',
    lane: 'running',
    executionState: 'running',
    controlState: 'active',
    ...over,
  }) as WorkyTaskRecord;

const makeStream = (over: Partial<WorkyStreamRecord> = {}) =>
  ({ id: newObjectId(), ownerUserId: ownerId, shares: [], ...over }) as WorkyStreamRecord;

function makeService(task: WorkyTaskRecord | null, stream: WorkyStreamRecord | null = makeStream()) {
  const tasks = {
    findById: jest.fn().mockResolvedValue(task),
    update: jest.fn(async (_id: string, patch: Partial<WorkyTaskRecord>): Promise<WorkyTaskRecord | null> => ({ ...task!, ...patch })),
  };
  const streams = { findById: jest.fn().mockResolvedValue(stream) };
  const events = { emit: jest.fn() };
  const service = new WorkyExecutionService(streams as never, tasks as never, events as never);
  return { service, tasks, streams, events };
}

describe('WorkyExecutionService.moveTask', () => {
  it('resets execution state when a task is moved to backlog', async () => {
    const task = makeTask();
    const { service, tasks, streams, events } = makeService(task);

    const result = await service.moveTask(task.id, ownerId, 'backlog', 'rethink');

    expect(streams.findById).toHaveBeenCalledWith(task.streamId);
    expect(tasks.update).toHaveBeenCalledWith(task.id, { lane: 'backlog', executionState: 'not_started' });
    expect(result).toEqual({ id: task.id, title: 'Draft brief', lane: 'backlog', executionState: 'not_started' });
    expect(events.emit).toHaveBeenCalledWith(task.streamId, task.streamId, expect.objectContaining({
      type: 'task.updated',
      payload: { taskId: task.id, lane: 'backlog', reason: 'rethink' },
    }));
  });

  it('keeps the execution state for a lane without a mapping', async () => {
    const task = makeTask();
    const { service, tasks } = makeService(task);

    await service.moveTask(task.id, ownerId, 'somewhere');

    expect(tasks.update).toHaveBeenCalledWith(task.id, { lane: 'somewhere' });
  });

  it('lets a write share move a task but not a read share', async () => {
    const writer = newObjectId();
    const reader = newObjectId();
    const task = makeTask();
    const stream = makeStream({
      shares: [
        { id: newObjectId(), streamId: task.streamId, userId: writer, permission: 'write', createdAt: new Date(), updatedAt: new Date() },
        { id: newObjectId(), streamId: task.streamId, userId: reader, permission: 'read', createdAt: new Date(), updatedAt: new Date() },
      ],
    });
    const { service, tasks } = makeService(task, stream);

    await expect(service.moveTask(task.id, writer, 'done')).resolves.toMatchObject({ lane: 'done' });
    await expect(service.moveTask(task.id, reader, 'done')).rejects.toMatchObject({ code: 'ERR_3501' });
    expect(tasks.update).toHaveBeenCalledTimes(1);
  });

  it('answers not found for a malformed or missing task', async () => {
    const { service, tasks } = makeService(null);

    await expect(service.moveTask('bad', ownerId, 'done')).rejects.toMatchObject({ code: 'ERR_3513' });
    expect(tasks.findById).not.toHaveBeenCalled();
    await expect(service.moveTask(newObjectId(), ownerId, 'done')).rejects.toMatchObject({ code: 'ERR_3513' });
  });

  it('answers not found when the task disappears before the write', async () => {
    const task = makeTask();
    const { service, tasks, events } = makeService(task);
    tasks.update.mockResolvedValueOnce(null);

    await expect(service.moveTask(task.id, ownerId, 'done')).rejects.toMatchObject({ code: 'ERR_3513' });
    expect(events.emit).not.toHaveBeenCalled();
  });
});

describe('WorkyExecutionService.pauseTask / resumeTask', () => {
  it('pauses a running task', async () => {
    const task = makeTask();
    const { service, tasks, events } = makeService(task);

    await service.pauseTask(task.id, ownerId);

    expect(tasks.update).toHaveBeenCalledWith(task.id, { controlState: 'paused' });
    expect(events.emit).toHaveBeenCalledWith(task.streamId, task.streamId, expect.objectContaining({
      payload: { taskId: task.id, controlState: 'paused', reason: '' },
    }));
  });

  it('refuses to pause a terminal task', async () => {
    const task = makeTask({ executionState: 'done', lane: 'done' });
    const { service, tasks } = makeService(task);

    await expect(service.pauseTask(task.id, ownerId)).rejects.toMatchObject({ code: 'ERR_3514' });
    expect(tasks.update).not.toHaveBeenCalled();
  });

  it('resumes a task', async () => {
    const task = makeTask({ controlState: 'paused' });
    const { service, tasks } = makeService(task);

    await service.resumeTask(task.id, ownerId);

    expect(tasks.update).toHaveBeenCalledWith(task.id, { controlState: 'active' });
  });
});

describe('WorkyExecutionService.cancelTask', () => {
  it('cancels a task that has not started', async () => {
    const task = makeTask({ lane: 'ready', executionState: 'not_started' });
    const { service, tasks, events } = makeService(task);

    const result = await service.cancelTask(task.id, ownerId, 'not needed');

    expect(tasks.update).toHaveBeenCalledWith(task.id, { lane: 'canceled', executionState: 'canceled', controlState: 'stopped' });
    expect(result).toMatchObject({ lane: 'canceled', executionState: 'canceled' });
    expect(events.emit).toHaveBeenCalledWith(task.streamId, task.streamId, expect.objectContaining({
      payload: { taskId: task.id, lane: 'canceled', reason: 'not needed' },
    }));
  });

  it('supersedes a done task', async () => {
    const task = makeTask({ lane: 'done', executionState: 'done' });
    const { service, tasks } = makeService(task);

    const result = await service.cancelTask(task.id, ownerId);

    expect(tasks.update).toHaveBeenCalledWith(task.id, { lane: 'superseded', controlState: 'stopped' });
    expect(result).toMatchObject({ lane: 'superseded', executionState: 'done' });
  });

  it('refuses to cancel a running task', async () => {
    const task = makeTask();
    const { service, tasks } = makeService(task);

    await expect(service.cancelTask(task.id, ownerId)).rejects.toMatchObject({ code: 'ERR_3514' });
    expect(tasks.update).not.toHaveBeenCalled();
  });
});

describe('WorkyExecutionService.reviewTask', () => {
  it('moves a running task to review', async () => {
    const task = makeTask();
    const { service, tasks } = makeService(task);

    const result = await service.reviewTask(task.id, ownerId);

    expect(tasks.update).toHaveBeenCalledWith(task.id, { lane: 'review', executionState: 'review' });
    expect(result).toMatchObject({ lane: 'review', executionState: 'review' });
  });

  it('refuses a task that is not running', async () => {
    const task = makeTask({ lane: 'ready', executionState: 'not_started' });
    const { service, tasks } = makeService(task);

    await expect(service.reviewTask(task.id, ownerId)).rejects.toMatchObject({ code: 'ERR_3514' });
    expect(tasks.update).not.toHaveBeenCalled();
  });
});
