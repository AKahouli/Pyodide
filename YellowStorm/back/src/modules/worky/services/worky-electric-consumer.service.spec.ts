import { ConfigService } from '@nestjs/config';
import { WorkyElectricConsumerService } from './worky-electric-consumer.service';

const makeService = () => {
  const taskModel = {
    findOneAndUpdate: jest.fn(),
    findOne: jest.fn(),
  };
  const resultModel = {
    findOneAndUpdate: jest.fn(),
  };
  const cursorModel = {
    findOne: jest.fn(),
    updateOne: jest.fn().mockReturnValue({ exec: () => Promise.resolve({ acknowledged: true }) }),
  };
  const streamService = {
    findByAiSessionId: jest.fn(),
    getOwnerByStreamId: jest.fn(),
  };
  const events = {
    emit: jest.fn(),
  };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        'worky.electricUrl': 'http://electric:3000/v1/shape',
        'worky.electricTasksTable': 'worky_tasks',
        'worky.electricTaskResultsTable': 'worky_task_results',
      };
      return values[key];
    }),
  } as unknown as ConfigService;

  const service = new WorkyElectricConsumerService(
    config,
    streamService as any,
    events as any,
    logger as any,
    taskModel as any,
    resultModel as any,
    cursorModel as any,
  );

  return { service, taskModel, resultModel, cursorModel, streamService, events, logger };
};

describe('WorkyElectricConsumerService.handleTaskMessages', () => {
  it('upserts a task by externalId and emits to the owner', async () => {
    const { service, taskModel, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });
    taskModel.findOneAndUpdate.mockReturnValue({ exec: () => Promise.resolve({ _id: 'obj-1' }) } as any);

    await service.handleTaskMessages([
      {
        key: '"public"."worky_tasks"/"pg-1"',
        headers: { operation: 'insert' },
        value: {
          id: 'pg-1',
          session_id: 'sess-xyz',
          title: 'T',
          lane: 'running',
          execution_state: 'running',
          description: null,
          priority: null,
          assignee_type: null,
          action_category: null,
          started_at: null,
          completed_at: null,
          updated_at: '2026-07-03T00:00:00Z',
        },
      },
      { headers: { control: 'up-to-date' } },
    ]);

    expect(taskModel.findOneAndUpdate).toHaveBeenCalledWith(
      { streamId: 'stream-1', externalId: 'pg-1' },
      expect.objectContaining({ $set: expect.objectContaining({ lane: 'running' }) }),
      expect.objectContaining({ upsert: true, new: true }),
    );
    expect(events.emit).toHaveBeenCalledWith('owner-1', 'stream-1', expect.objectContaining({ type: 'task.updated' }));
  });

  it('is idempotent: same row twice upserts once per call with the same filter', async () => {
    const { service, taskModel, streamService } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });
    taskModel.findOneAndUpdate.mockReturnValue({ exec: () => Promise.resolve({ _id: 'obj-1' }) } as any);
    const msg = {
      key: '"public"."worky_tasks"/"pg-1"',
      headers: { operation: 'update' },
      value: {
        id: 'pg-1',
        session_id: 'sess-xyz',
        title: 'T',
        lane: 'done',
        execution_state: 'done',
        description: null,
        priority: null,
        assignee_type: null,
        action_category: null,
        started_at: null,
        completed_at: '2026-07-03T01:00:00Z',
        updated_at: '2026-07-03T01:00:00Z',
      },
    };
    await service.handleTaskMessages([msg]);
    await service.handleTaskMessages([msg]);
    expect(taskModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
    // both calls use the same upsert filter → one row
    expect(taskModel.findOneAndUpdate.mock.calls[0][0]).toEqual(taskModel.findOneAndUpdate.mock.calls[1][0]);
  });

  it('skips delete operations (manager tombstones out of scope)', async () => {
    const { service, taskModel, streamService } = makeService();
    await service.handleTaskMessages([
      { key: '"public"."worky_tasks"/"pg-1"', headers: { operation: 'delete' }, value: { id: 'pg-1', session_id: 'sess-xyz' } },
    ]);
    expect(taskModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(streamService.findByAiSessionId).not.toHaveBeenCalled();
  });

  it('continues processing subsequent rows when one row fails (per-row guard)', async () => {
    const { service, taskModel, streamService, events, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });
    taskModel.findOneAndUpdate
      .mockReturnValueOnce({ exec: () => Promise.reject(new Error('db down')) } as any)
      .mockReturnValueOnce({ exec: () => Promise.resolve({ _id: 'obj-2' }) } as any);

    const makeMsg = (id: string) => ({
      key: `"public"."worky_tasks"/"${id}"`,
      headers: { operation: 'insert' },
      value: {
        id,
        session_id: 'sess-xyz',
        title: 'T',
        lane: 'running',
        execution_state: 'running',
        description: null,
        priority: null,
        assignee_type: null,
        action_category: null,
        started_at: null,
        completed_at: null,
        updated_at: '2026-07-03T00:00:00Z',
      },
    });

    await expect(
      service.handleTaskMessages([makeMsg('pg-1'), makeMsg('pg-2')]),
    ).resolves.toBeUndefined();

    expect(taskModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith('owner-1', 'stream-1', expect.objectContaining({ type: 'task.updated' }));
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to process task message',
      expect.objectContaining({ error: 'db down' }),
    );
  });

  it('skips rows for an unknown session and logs a warning', async () => {
    const { service, taskModel, streamService, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValue(null);

    await service.handleTaskMessages([
      {
        key: '"public"."worky_tasks"/"pg-1"',
        headers: { operation: 'insert' },
        value: {
          id: 'pg-1',
          session_id: 'sess-unknown',
          title: 'T',
          lane: 'running',
          execution_state: 'running',
          description: null,
          priority: null,
          assignee_type: null,
          action_category: null,
          started_at: null,
          completed_at: null,
          updated_at: '2026-07-03T00:00:00Z',
        },
      },
    ]);

    expect(taskModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('WorkyElectricConsumerService.handleTaskResultMessages', () => {
  it('upserts a task result by (taskId, version) and emits to the owner', async () => {
    const { service, taskModel, resultModel, streamService, events } = makeService();
    taskModel.findOne.mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve({ _id: 'obj-1', streamId: 'stream-1' }) }),
    } as any);
    resultModel.findOneAndUpdate.mockReturnValue({ exec: () => Promise.resolve({ _id: 'result-1' }) } as any);
    streamService.getOwnerByStreamId.mockResolvedValue('owner-1');

    await service.handleTaskResultMessages([
      {
        key: '"public"."worky_task_results"/"pgr-1"',
        headers: { operation: 'insert' },
        value: {
          id: 'pgr-1',
          task_id: 'pg-1',
          version: 1,
          status: 'success',
          summary: 'done',
          payload: null,
        },
      },
      { headers: { control: 'up-to-date' } },
    ]);

    expect(resultModel.findOneAndUpdate).toHaveBeenCalledWith(
      { taskId: 'obj-1', version: 1 },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'success' }) }),
      expect.objectContaining({ upsert: true, new: true }),
    );
    expect(events.emit).toHaveBeenCalledWith('owner-1', 'stream-1', expect.objectContaining({ type: 'task.completed' }));
  });

  it('is idempotent: same row twice upserts once per call with the same filter', async () => {
    const { service, taskModel, resultModel, streamService } = makeService();
    taskModel.findOne.mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve({ _id: 'obj-1', streamId: 'stream-1' }) }),
    } as any);
    resultModel.findOneAndUpdate.mockReturnValue({ exec: () => Promise.resolve({ _id: 'result-1' }) } as any);
    streamService.getOwnerByStreamId.mockResolvedValue('owner-1');
    const msg = {
      key: '"public"."worky_task_results"/"pgr-1"',
      headers: { operation: 'insert' },
      value: { id: 'pgr-1', task_id: 'pg-1', version: 1, status: 'success', summary: 'done', payload: null },
    };

    await service.handleTaskResultMessages([msg]);
    await service.handleTaskResultMessages([msg]);

    expect(resultModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(resultModel.findOneAndUpdate.mock.calls[0][0]).toEqual(resultModel.findOneAndUpdate.mock.calls[1][0]);
  });

  it('skips results for an unknown task and logs a warning', async () => {
    const { service, resultModel, taskModel, logger } = makeService();
    taskModel.findOne.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(null) }) } as any);

    await service.handleTaskResultMessages([
      {
        key: '"public"."worky_task_results"/"pgr-1"',
        headers: { operation: 'insert' },
        value: { id: 'pgr-1', task_id: 'pg-missing', version: 1, status: 'success', summary: null, payload: null },
      },
    ]);

    expect(resultModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('skips delete operations', async () => {
    const { service, resultModel, taskModel } = makeService();
    await service.handleTaskResultMessages([
      { key: '"public"."worky_task_results"/"pgr-1"', headers: { operation: 'delete' }, value: { id: 'pgr-1', task_id: 'pg-1', version: 1 } },
    ]);
    expect(taskModel.findOne).not.toHaveBeenCalled();
    expect(resultModel.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('WorkyElectricConsumerService.persistCursor', () => {
  it('upserts the cursor document for a shape', async () => {
    const { service, cursorModel } = makeService();
    await service.persistCursor('tasks', 'handle-1', '1234_0');
    expect(cursorModel.updateOne).toHaveBeenCalledWith(
      { shape: 'tasks' },
      { $set: { handle: 'handle-1', offset: '1234_0' } },
      { upsert: true },
    );
  });
});
