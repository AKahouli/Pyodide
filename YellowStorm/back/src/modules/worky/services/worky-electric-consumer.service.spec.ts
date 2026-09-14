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
    findOneAndUpdate: jest.fn().mockReturnValue({ exec: () => Promise.resolve({ acknowledged: true }) }),
  };
  const cursorModel = {
    findOne: jest.fn(),
    updateOne: jest.fn().mockReturnValue({ exec: () => Promise.resolve({ acknowledged: true }) }),
  };
  const messageComponentModel = {
    findOneAndUpdate: jest.fn().mockReturnValue({ exec: () => Promise.resolve({ _id: 'mc-1' }) }),
  };
  const planStepComponentModel = {
    findOneAndUpdate: jest.fn().mockReturnValue({ exec: () => Promise.resolve({ _id: 'pc-1' }) }),
  };
  const planStepArtifactModel = {
    findOneAndUpdate: jest.fn().mockReturnValue({ exec: () => Promise.resolve({ _id: 'pa-1' }) }),
  };
  const streamService = {
    findByAiSessionId: jest.fn(),
  };
  const events = {
    emit: jest.fn(),
  };
  const whatsappDelivery = {
    attempt: jest.fn().mockResolvedValue(undefined),
  };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, unknown> = {
        'worky.electricUrl': 'http://electric:3000/v1/shape',
        'worky.electricSessionsTable': 'sessions',
        'worky.electricMessagesTable': 'messages',
        'worky.electricPlansTable': 'plans',
        'worky.electricPlanStepsTable': 'plan_steps',
        'worky.electricMessageComponentsTable': 'message_components',
        'worky.electricPlanStepComponentsTable': 'plan_step_components',
        'worky.electricPlanStepArtifactsTable': 'plan_step_artifacts',
        'worky.electricSecret': 'shh',
        'worky.electricDebug': false,
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
    messageComponentModel as any,
    planStepComponentModel as any,
    planStepArtifactModel as any,
    whatsappDelivery as any,
  );

  return {
    service,
    taskModel,
    messageModel,
    planProjectionModel,
    cursorModel,
    messageComponentModel,
    planStepComponentModel,
    planStepArtifactModel,
    streamService,
    events,
    whatsappDelivery,
    logger,
  };
};

describe('WorkyElectricConsumerService.onModuleInit', () => {
  it('uses a versioned messages cursor so new columns receive a fresh snapshot', async () => {
    const { service } = makeService();
    const subscribe = jest.fn().mockResolvedValue(undefined);
    (service as any).subscribe = subscribe;

    await service.onModuleInit();

    expect(subscribe).toHaveBeenNthCalledWith(
      1,
      'messages',
      'messages',
      expect.any(Function),
      'messages:turn-id-v1',
    );
    expect(subscribe).toHaveBeenNthCalledWith(2, 'sessions', 'sessions', expect.any(Function), 'sessions:v1');
    expect(subscribe).toHaveBeenNthCalledWith(3, 'plans', 'plans', expect.any(Function), 'plans:v2');
    expect(subscribe).toHaveBeenNthCalledWith(4, 'plan_steps', 'plan_steps', expect.any(Function), 'plan_steps:v2');
  });
});

describe('WorkyElectricConsumerService batch cursor', () => {
  it('does not persist a cursor when shutdown interrupts batch processing', async () => {
    const { service } = makeService();
    const persist = jest.fn().mockResolvedValue(undefined);
    const handler = jest.fn().mockImplementation(async () => {
      service.onModuleDestroy();
    });

    await (service as any).processBatch(handler, [{ value: 'row' }], persist);

    expect(handler).toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
});

describe('WorkyElectricConsumerService.handleSessions', () => {
  it('upserts session state independently and emits stream.updated', async () => {
    const { service, planProjectionModel, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });
    planProjectionModel.findOneAndUpdate.mockReturnValue({ exec: () => Promise.resolve({}) } as any);

    await service.handleSessions([{
      key: 'sessions/session-1', headers: { operation: 'insert' },
      value: { id: 'session-1', status: 'waiting', interrupt_id: 'ask:1' },
    }]);

    expect(planProjectionModel.findOneAndUpdate).toHaveBeenCalledWith(
      { streamId: 'stream-1' },
      { $set: { streamId: 'stream-1', sessionStatus: 'waiting', activeInterruptId: 'ask:1' } },
      expect.objectContaining({ upsert: true, setDefaultsOnInsert: true }),
    );
    expect(events.emit).toHaveBeenCalledWith('owner-1', 'stream-1', expect.objectContaining({ type: 'stream.updated' }));
  });

  it('retries a failed session projection before completing the batch', async () => {
    const { service, planProjectionModel, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });
    planProjectionModel.findOneAndUpdate
      .mockReturnValueOnce({ exec: () => Promise.reject(new Error('mongo unavailable')) } as any)
      .mockReturnValueOnce({ exec: () => Promise.resolve({}) } as any);
    (service as any).waitForProjectionRetry = jest.fn().mockResolvedValue(undefined);

    await service.handleSessions([{
      key: 'sessions/session-1', headers: { operation: 'update' },
      value: { id: 'session-1', status: 'paused', interrupt_id: null },
    }]);

    expect(planProjectionModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('stops retrying without emitting when shutdown interrupts the batch', async () => {
    const { service, planProjectionModel, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });
    planProjectionModel.findOneAndUpdate.mockReturnValue({
      exec: () => Promise.reject(new Error('mongo unavailable')),
    } as any);
    (service as any).waitForProjectionRetry = jest.fn().mockImplementation(async () => {
      service.onModuleDestroy();
    });

    await service.handleSessions([{
      key: 'sessions/session-1', headers: { operation: 'update' },
      value: { id: 'session-1', status: 'paused', interrupt_id: null },
    }]);

    expect(planProjectionModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(events.emit).not.toHaveBeenCalled();
  });
});

describe('WorkyElectricConsumerService.handleMessages', () => {
  it('upserts a message by (streamId, externalId) and emits to the owner', async () => {
    const { service, messageModel, streamService, events, whatsappDelivery } = makeService();
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
      expect.objectContaining({
        $set: expect.objectContaining({ role: 'manager', content: 'hello' }),
        $setOnInsert: expect.objectContaining({
          whatsappDelivery: expect.objectContaining({ status: 'pending', attempts: 0 }),
        }),
      }),
      expect.objectContaining({ upsert: true, new: true }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      'owner-1',
      'stream-1',
      expect.objectContaining({ type: 'message.appended' }),
    );
    expect(whatsappDelivery.attempt).toHaveBeenCalledWith('obj-1');
  });

  it('does not block projection when immediate WhatsApp delivery hangs', async () => {
    const { service, messageModel, streamService, events, whatsappDelivery } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });
    messageModel.findOneAndUpdate
      .mockReturnValueOnce({ exec: () => Promise.resolve({ _id: 'message-1' }) } as any)
      .mockReturnValueOnce({ exec: () => Promise.resolve({ _id: 'message-2' }) } as any);
    whatsappDelivery.attempt.mockReturnValue(new Promise(() => undefined));
    const makeMessage = (id: string) => ({
      key: `"public"."messages"/"${id}"`,
      headers: { operation: 'insert' },
      value: {
        id,
        session_id: 'sess-xyz',
        role: 'assistant',
        content: 'hello',
        created_at: '2026-07-03T00:00:00Z',
      },
    });

    await expect(
      service.handleMessages([makeMessage('pg-msg-1'), makeMessage('pg-msg-2')]),
    ).resolves.toBeUndefined();

    expect(events.emit).toHaveBeenCalledTimes(2);
    expect(whatsappDelivery.attempt).toHaveBeenCalledTimes(2);
  });

  it('adopts the locally-persisted owner message instead of inserting a duplicate', async () => {
    const { service, messageModel, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });
    // The doc appendOwnerMessage already wrote for this same turn.
    messageModel.findOneAndUpdate.mockReturnValue({
      exec: () => Promise.resolve({ _id: 'mongo-1' }),
    } as any);

    await service.handleMessages([
      {
        key: '"public"."messages"/"pg-msg-1"',
        headers: { operation: 'insert' },
        value: {
          id: 'pg-msg-1',
          session_id: 'sess-xyz',
          role: 'user',
          content: 'ship the report',
          created_at: '2026-07-03T00:00:00Z',
        },
      },
    ]);

    // Matched on the un-mirrored local copy, not upserted by externalId.
    expect(messageModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(messageModel.findOneAndUpdate).toHaveBeenCalledWith(
      { streamId: 'stream-1', role: 'owner', content: 'ship the report', externalId: null },
      expect.objectContaining({ $set: expect.objectContaining({ externalId: 'pg-msg-1' }) }),
      expect.objectContaining({ new: true }),
    );
    // The SSE id is the Mongo id so it matches what the REST history returns.
    expect(events.emit).toHaveBeenCalledWith(
      'owner-1',
      'stream-1',
      expect.objectContaining({ payload: expect.objectContaining({ id: 'mongo-1' }) }),
    );
  });

  it('falls back to an externalId upsert when there is no local owner copy', async () => {
    const { service, messageModel, streamService } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });
    messageModel.findOneAndUpdate
      .mockReturnValueOnce({ exec: () => Promise.resolve(null) } as any) // nothing to adopt
      .mockReturnValueOnce({ exec: () => Promise.resolve({ _id: 'mongo-2' }) } as any);

    await service.handleMessages([
      {
        key: '"public"."messages"/"pg-msg-9"',
        headers: { operation: 'insert' },
        value: {
          id: 'pg-msg-9',
          session_id: 'sess-xyz',
          role: 'user',
          content: 'from whatsapp',
          created_at: '2026-07-03T00:00:00Z',
        },
      },
    ]);

    expect(messageModel.findOneAndUpdate).toHaveBeenLastCalledWith(
      { streamId: 'stream-1', externalId: 'pg-msg-9' },
      expect.anything(),
      expect.objectContaining({ upsert: true, new: true }),
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

  it('retries a failed message projection before advancing the batch', async () => {
    const { service, messageModel, streamService, events, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });
    messageModel.findOneAndUpdate
      .mockReturnValueOnce({ exec: () => Promise.reject(new Error('db down')) } as any)
      .mockReturnValueOnce({ exec: () => Promise.resolve({ _id: 'obj-1' }) } as any)
      .mockReturnValueOnce({ exec: () => Promise.resolve({ _id: 'obj-2' }) } as any);
    (service as any).waitForProjectionRetry = jest.fn().mockResolvedValue(undefined);

    const makeMsg = (id: string) => ({
      key: `"public"."messages"/"${id}"`,
      headers: { operation: 'insert' },
      value: { id, session_id: 'sess-xyz', role: 'user', content: 'hi', created_at: '2026-07-03T00:00:00Z' },
    });

    await expect(service.handleMessages([makeMsg('pg-1'), makeMsg('pg-2')])).resolves.toBeUndefined();

    expect(messageModel.findOneAndUpdate).toHaveBeenCalledTimes(3);
    expect(events.emit).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      '[worky-electric] projection failed; retrying before cursor advance',
      expect.objectContaining({ shape: 'messages', error: 'db down' }),
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

  it('retries a failed row before processing subsequent rows', async () => {
    const { service, taskModel, streamService, events, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });
    taskModel.findOneAndUpdate
      .mockReturnValueOnce({ exec: () => Promise.reject(new Error('db down')) } as any)
      .mockReturnValue({ exec: () => Promise.resolve({ _id: 'obj-2' }) } as any);
    (service as any).waitForProjectionRetry = jest.fn().mockResolvedValue(undefined);

    const makeMsg = (id: string) => ({
      key: `"public"."plan_steps"/"${id}"`,
      headers: { operation: 'insert' },
      value: { session_id: 'sess-xyz', step_id: id, ordinal: 1, status: 'pending', description: 'd' },
    });

    await expect(service.handlePlanSteps([makeMsg('step-1'), makeMsg('step-2')])).resolves.toBeUndefined();

    expect(taskModel.findOneAndUpdate).toHaveBeenCalledTimes(3);
    expect(events.emit).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('retrying before cursor advance'),
      expect.objectContaining({ shape: 'plan_steps', error: 'db down' }),
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

  it('retries a failed row before processing subsequent rows', async () => {
    const { service, planProjectionModel, streamService, events, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });
    planProjectionModel.findOneAndUpdate
      .mockReturnValueOnce({ exec: () => Promise.reject(new Error('db down')) } as any)
      .mockReturnValue({ exec: () => Promise.resolve({ _id: 'obj-2' }) } as any);
    (service as any).waitForProjectionRetry = jest.fn().mockResolvedValue(undefined);

    const makeMsg = (id: string) => ({
      key: `"public"."plans"/"${id}"`,
      headers: { operation: 'insert' },
      value: { session_id: id, title: 'T', status: 'pending' },
    });

    await expect(service.handlePlans([makeMsg('sess-1'), makeMsg('sess-2')])).resolves.toBeUndefined();

    expect(planProjectionModel.findOneAndUpdate).toHaveBeenCalledTimes(3);
    expect(events.emit).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('retrying before cursor advance'),
      expect.objectContaining({ shape: 'plans', error: 'db down' }),
    );
  });
});

describe('WorkyElectricConsumerService.onShapeError', () => {
  it('logs a WARN (not error) for a missing table so boot is not blocked', () => {
    const { service, logger } = makeService();
    service.onShapeError('message_components', 'message_components', new Error('Table "public"."message_components" does not exist.'));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('table missing'),
      expect.objectContaining({ shape: 'message_components' }),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs an ERROR for any other non-retryable failure', () => {
    const { service, logger } = makeService();
    service.onShapeError('messages', 'messages', new Error('boom'));
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('non-retryable'),
      expect.objectContaining({ shape: 'messages', error: 'boom' }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
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

describe('WorkyElectricConsumerService.handleMessageComponents', () => {
  it('upserts a component projection and emits message.component.appended', async () => {
    const { service, messageComponentModel, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: '507f1f77bcf86cd799439011', ownerUserId: 'u1' });
    await service.handleMessageComponents([
      { key: 'k', headers: { operation: 'insert' }, value: { session_id: 's1', message_id: 'msg-1', component_id: 'c-1', ordinal: 0, type: 'text', data: { content: 'hi' }, created_at: '2026-08-13T10:00:00.000Z' } },
    ]);
    expect(messageComponentModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'c-1' }),
      expect.objectContaining({ $set: expect.objectContaining({ externalId: 'c-1', messageExternalId: 'msg-1', type: 'text' }) }),
      expect.objectContaining({ upsert: true }),
    );
    expect(events.emit).toHaveBeenCalledWith('u1', '507f1f77bcf86cd799439011', expect.objectContaining({ type: 'message.component.appended' }));
  });

  it('skips control frames and delete ops', async () => {
    const { service, messageComponentModel } = makeService();
    await service.handleMessageComponents([
      { headers: { control: 'up-to-date' } },
      { key: 'k', headers: { operation: 'delete' }, value: { session_id: 's1', message_id: 'm', component_id: 'c', ordinal: 0, type: 'text', data: {}, created_at: '' } },
    ]);
    expect(messageComponentModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('also emits stream.terminal for an error component (releases the Stop button)', async () => {
    const { service, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: '507f1f77bcf86cd799439011', ownerUserId: 'u1' });
    await service.handleMessageComponents([
      { key: 'k', headers: { operation: 'insert' }, value: { session_id: 's1', message_id: 'msg-1', component_id: 'c-err', ordinal: 0, type: 'error', data: { title: 'x', content: 'boom' }, created_at: '2026-08-13T10:00:00.000Z' } },
    ]);
    expect(events.emit).toHaveBeenCalledWith('u1', '507f1f77bcf86cd799439011', expect.objectContaining({ type: 'message.component.appended' }));
    expect(events.emit).toHaveBeenCalledWith('u1', '507f1f77bcf86cd799439011', expect.objectContaining({ type: 'stream.terminal', payload: expect.objectContaining({ error: true }) }));
  });
});

describe('WorkyElectricConsumerService.handlePlanStepComponents', () => {
  it('upserts and emits task.component.appended', async () => {
    const { service, planStepComponentModel, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: '507f1f77bcf86cd799439011', ownerUserId: 'u1' });
    await service.handlePlanStepComponents([
      { key: 'k', headers: { operation: 'insert' }, value: { session_id: 's1', step_id: 'step-1', component_id: 'c-9', ordinal: 1, type: 'code', data: { content: 'x' }, created_at: '2026-08-13T10:00:00.000Z' } },
    ]);
    expect(planStepComponentModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'c-9' }),
      expect.objectContaining({ $set: expect.objectContaining({ stepExternalId: 'step-1', type: 'code' }) }),
      expect.objectContaining({ upsert: true }),
    );
    expect(events.emit).toHaveBeenCalledWith('u1', '507f1f77bcf86cd799439011', expect.objectContaining({ type: 'task.component.appended' }));
  });
});

describe('WorkyElectricConsumerService.handlePlanStepArtifacts', () => {
  it('upserts and emits task.artifact.appended', async () => {
    const { service, planStepArtifactModel, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: '507f1f77bcf86cd799439011', ownerUserId: 'u1' });
    await service.handlePlanStepArtifacts([
      { key: 'k', headers: { operation: 'insert' }, value: { session_id: 's1', step_id: 'step-1', artifact_id: 'a-1', file_path: 'key/abc', filename: 'r.pdf', artifact_kind: 'document', mime_type: 'application/pdf', size: 5, created_at: '2026-08-13T10:00:00.000Z' } },
    ]);
    expect(planStepArtifactModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'a-1' }),
      expect.objectContaining({ $set: expect.objectContaining({ stepExternalId: 'step-1', filePath: 'key/abc', filename: 'r.pdf' }) }),
      expect.objectContaining({ upsert: true }),
    );
    expect(events.emit).toHaveBeenCalledWith('u1', '507f1f77bcf86cd799439011', expect.objectContaining({ type: 'task.artifact.appended' }));
  });
});

describe('WorkyElectricConsumerService.handleSessions', () => {
  it('emits stream.terminal (error) when a session goes failed', async () => {
    const { service, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });

    await service.handleSessions([
      { key: '"public"."sessions"/"sess-1"', headers: { operation: 'update' }, value: { id: 'sess-1', user_id: 'u1', status: 'failed' } },
    ]);

    expect(events.emit).toHaveBeenCalledWith(
      'owner-1',
      'stream-1',
      expect.objectContaining({ type: 'stream.terminal', payload: expect.objectContaining({ error: true }) }),
    );
  });

  it('emits stream.terminal (no error) when a session completes', async () => {
    const { service, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });

    await service.handleSessions([
      { key: '"public"."sessions"/"sess-1"', headers: { operation: 'update' }, value: { id: 'sess-1', user_id: 'u1', status: 'completed' } },
    ]);

    expect(events.emit).toHaveBeenCalledWith(
      'owner-1',
      'stream-1',
      expect.objectContaining({ type: 'stream.terminal', payload: expect.objectContaining({ error: false }) }),
    );
  });

  it('emits stream.updated but not stream.terminal for non-terminal statuses (running/blocked)', async () => {
    const { service, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });

    await service.handleSessions([
      { key: '"public"."sessions"/"sess-1"', headers: { operation: 'update' }, value: { id: 'sess-1', user_id: 'u1', status: 'running' } },
      { key: '"public"."sessions"/"sess-1"', headers: { operation: 'update' }, value: { id: 'sess-1', user_id: 'u1', status: 'blocked' } },
    ]);

    const emitCalls = events.emit.mock.calls;
    expect(emitCalls.every((call: unknown[]) => (call[2] as Record<string, unknown>)?.type !== 'stream.terminal')).toBe(true);
  });
});
