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
  });
});

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
