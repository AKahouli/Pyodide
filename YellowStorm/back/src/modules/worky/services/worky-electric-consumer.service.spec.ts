import { ConfigService } from '@nestjs/config';
import { WorkyElectricConsumerService } from './worky-electric-consumer.service';

const makeService = () => {
  const taskModel = {
    findOneAndUpdate: jest.fn(),
    findOne: jest.fn(),
  };
  const messageModel = {
    findOneAndUpdate: jest.fn(),
  };
  const planProjectionModel = {
    findOneAndUpdate: jest.fn(),
  };
  const cursorModel = {
    findOne: jest.fn(),
    updateOne: jest.fn().mockReturnValue({ exec: () => Promise.resolve({ acknowledged: true }) }),
  };
  const streamService = {
    findByAiSessionId: jest.fn(),
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
        'worky.electricMessagesTable': 'messages',
        'worky.electricPlansTable': 'plans',
        'worky.electricPlanStepsTable': 'plan_steps',
        'worky.electricSecret': 'shh',
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
    messageModel as any,
    planProjectionModel as any,
    cursorModel as any,
  );

  return { service, taskModel, messageModel, planProjectionModel, cursorModel, streamService, events, logger };
};

describe('WorkyElectricConsumerService.handleMessages', () => {
  it('upserts a message by (streamId, externalId) and emits to the owner', async () => {
    const { service, messageModel, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });
    messageModel.findOneAndUpdate.mockReturnValue({ exec: () => Promise.resolve({ _id: 'obj-1' }) } as any);

    await service.handleMessages([
      {
        key: '"public"."messages"/"pg-msg-1"',
        headers: { operation: 'insert' },
        value: {
          id: 'pg-msg-1',
          session_id: 'sess-xyz',
          role: 'assistant',
          content: 'hello',
          created_at: '2026-07-03T00:00:00Z',
        },
      },
      { headers: { control: 'up-to-date' } },
    ]);

    expect(messageModel.findOneAndUpdate).toHaveBeenCalledWith(
      { streamId: 'stream-1', externalId: 'pg-msg-1' },
      expect.objectContaining({ $set: expect.objectContaining({ role: 'manager', content: 'hello' }) }),
      expect.objectContaining({ upsert: true, new: true }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      'owner-1',
      'stream-1',
      expect.objectContaining({ type: 'message.appended' }),
    );
  });

  it('skips delete operations (manager tombstones out of scope)', async () => {
    const { service, messageModel, streamService } = makeService();
    await service.handleMessages([
      { key: '"public"."messages"/"pg-1"', headers: { operation: 'delete' }, value: { id: 'pg-1', session_id: 'sess-xyz' } },
    ]);
    expect(messageModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(streamService.findByAiSessionId).not.toHaveBeenCalled();
  });

  it('skips rows for an unknown session and logs a warning', async () => {
    const { service, messageModel, streamService, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValue(null);

    await service.handleMessages([
      {
        key: '"public"."messages"/"pg-1"',
        headers: { operation: 'insert' },
        value: { id: 'pg-1', session_id: 'sess-unknown', role: 'user', content: 'hi', created_at: '2026-07-03T00:00:00Z' },
      },
    ]);

    expect(messageModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('continues processing subsequent rows when one row fails (per-row guard)', async () => {
    const { service, messageModel, streamService, events, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });
    messageModel.findOneAndUpdate
      .mockReturnValueOnce({ exec: () => Promise.reject(new Error('db down')) } as any)
      .mockReturnValueOnce({ exec: () => Promise.resolve({ _id: 'obj-2' }) } as any);

    const makeMsg = (id: string) => ({
      key: `"public"."messages"/"${id}"`,
      headers: { operation: 'insert' },
      value: { id, session_id: 'sess-xyz', role: 'user', content: 'hi', created_at: '2026-07-03T00:00:00Z' },
    });

    await expect(service.handleMessages([makeMsg('pg-1'), makeMsg('pg-2')])).resolves.toBeUndefined();

    expect(messageModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to process message row',
      expect.objectContaining({ error: 'db down' }),
    );
  });
});

describe('WorkyElectricConsumerService.handlePlanSteps', () => {
  it('upserts a plan_step by (streamId, externalId) and emits to the owner', async () => {
    const { service, taskModel, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });
    taskModel.findOneAndUpdate.mockReturnValue({ exec: () => Promise.resolve({ _id: 'obj-1' }) } as any);

    await service.handlePlanSteps([
      {
        key: '"public"."plan_steps"/"step-1"',
        headers: { operation: 'insert' },
        value: { session_id: 'sess-xyz', step_id: 'step-1', ordinal: 1, status: 'in_progress', description: 'Do it' },
      },
      { headers: { control: 'up-to-date' } },
    ]);

    expect(taskModel.findOneAndUpdate).toHaveBeenCalledWith(
      { streamId: 'stream-1', externalId: 'step-1' },
      expect.objectContaining({ $set: expect.objectContaining({ lane: 'running', ordinal: 1 }) }),
      expect.objectContaining({ upsert: true, new: true }),
    );
    expect(events.emit).toHaveBeenCalledWith('owner-1', 'stream-1', expect.objectContaining({ type: 'task.updated' }));
  });

  it('logs a warning for an unknown plan_step status but still upserts (defaults to backlog)', async () => {
    const { service, taskModel, streamService, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });
    taskModel.findOneAndUpdate.mockReturnValue({ exec: () => Promise.resolve({ _id: 'obj-1' }) } as any);

    await service.handlePlanSteps([
      {
        key: '"public"."plan_steps"/"step-1"',
        headers: { operation: 'insert' },
        value: { session_id: 'sess-xyz', step_id: 'step-1', ordinal: 1, status: 'some_weird_status', description: 'd' },
      },
    ]);

    expect(logger.warn).toHaveBeenCalledWith(
      'Unknown plan_step status',
      expect.objectContaining({ status: 'some_weird_status', step: 'step-1' }),
    );
    expect(taskModel.findOneAndUpdate).toHaveBeenCalledWith(
      { streamId: 'stream-1', externalId: 'step-1' },
      expect.objectContaining({ $set: expect.objectContaining({ lane: 'backlog' }) }),
      expect.objectContaining({ upsert: true, new: true }),
    );
  });

  it('skips delete operations', async () => {
    const { service, taskModel, streamService } = makeService();
    await service.handlePlanSteps([
      { key: '"public"."plan_steps"/"step-1"', headers: { operation: 'delete' }, value: { session_id: 'sess-xyz', step_id: 'step-1' } },
    ]);
    expect(taskModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(streamService.findByAiSessionId).not.toHaveBeenCalled();
  });

  it('skips rows for an unknown session and logs a warning', async () => {
    const { service, taskModel, streamService, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValue(null);

    await service.handlePlanSteps([
      {
        key: '"public"."plan_steps"/"step-1"',
        headers: { operation: 'insert' },
        value: { session_id: 'sess-unknown', step_id: 'step-1', ordinal: 1, status: 'pending', description: 'd' },
      },
    ]);

    expect(taskModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('continues processing subsequent rows when one row fails (per-row guard)', async () => {
    const { service, taskModel, streamService, events, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });
    taskModel.findOneAndUpdate
      .mockReturnValueOnce({ exec: () => Promise.reject(new Error('db down')) } as any)
      .mockReturnValueOnce({ exec: () => Promise.resolve({ _id: 'obj-2' }) } as any);

    const makeMsg = (id: string) => ({
      key: `"public"."plan_steps"/"${id}"`,
      headers: { operation: 'insert' },
      value: { session_id: 'sess-xyz', step_id: id, ordinal: 1, status: 'pending', description: 'd' },
    });

    await expect(service.handlePlanSteps([makeMsg('step-1'), makeMsg('step-2')])).resolves.toBeUndefined();

    expect(taskModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to process plan_step row',
      expect.objectContaining({ error: 'db down' }),
    );
  });
});

describe('WorkyElectricConsumerService.handlePlans', () => {
  it('upserts a plan projection by streamId and emits to the owner', async () => {
    const { service, planProjectionModel, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });
    planProjectionModel.findOneAndUpdate.mockReturnValue({ exec: () => Promise.resolve({ _id: 'obj-1' }) } as any);

    await service.handlePlans([
      {
        key: '"public"."plans"/"sess-xyz"',
        headers: { operation: 'insert' },
        value: { session_id: 'sess-xyz', title: 'My Plan', status: 'completed' },
      },
      { headers: { control: 'up-to-date' } },
    ]);

    expect(planProjectionModel.findOneAndUpdate).toHaveBeenCalledWith(
      { streamId: 'stream-1' },
      expect.objectContaining({ $set: expect.objectContaining({ title: 'My Plan', status: 'completed' }) }),
      expect.objectContaining({ upsert: true, new: true }),
    );
    expect(events.emit).toHaveBeenCalledWith('owner-1', 'stream-1', expect.objectContaining({ type: 'stream.updated' }));
  });

  it('skips delete operations', async () => {
    const { service, planProjectionModel, streamService } = makeService();
    await service.handlePlans([
      { key: '"public"."plans"/"sess-xyz"', headers: { operation: 'delete' }, value: { session_id: 'sess-xyz' } },
    ]);
    expect(planProjectionModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(streamService.findByAiSessionId).not.toHaveBeenCalled();
  });

  it('skips rows for an unknown session and logs a warning', async () => {
    const { service, planProjectionModel, streamService, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValue(null);

    await service.handlePlans([
      {
        key: '"public"."plans"/"sess-unknown"',
        headers: { operation: 'insert' },
        value: { session_id: 'sess-unknown', title: 'T', status: 'pending' },
      },
    ]);

    expect(planProjectionModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('continues processing subsequent rows when one row fails (per-row guard)', async () => {
    const { service, planProjectionModel, streamService, events, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });
    planProjectionModel.findOneAndUpdate
      .mockReturnValueOnce({ exec: () => Promise.reject(new Error('db down')) } as any)
      .mockReturnValueOnce({ exec: () => Promise.resolve({ _id: 'obj-2' }) } as any);

    const makeMsg = (id: string) => ({
      key: `"public"."plans"/"${id}"`,
      headers: { operation: 'insert' },
      value: { session_id: id, title: 'T', status: 'pending' },
    });

    await expect(service.handlePlans([makeMsg('sess-1'), makeMsg('sess-2')])).resolves.toBeUndefined();

    expect(planProjectionModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to process plan row',
      expect.objectContaining({ error: 'db down' }),
    );
  });
});

describe('WorkyElectricConsumerService.persistCursor', () => {
  it('upserts the cursor document for a shape', async () => {
    const { service, cursorModel } = makeService();
    await service.persistCursor('messages', 'handle-1', '1234_0');
    expect(cursorModel.updateOne).toHaveBeenCalledWith(
      { shape: 'messages' },
      { $set: { handle: 'handle-1', offset: '1234_0' } },
      { upsert: true },
    );
  });
});
