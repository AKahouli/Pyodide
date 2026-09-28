import { ConfigService } from '@nestjs/config';
import { ShapeStream } from '@electric-sql/client';
import { newObjectId } from '@common/postgres';
import { WorkyElectricConsumerService } from './worky-electric-consumer.service';

jest.mock('@electric-sql/client', () => ({
  ...jest.requireActual('@electric-sql/client'),
  ShapeStream: jest.fn(),
}));

const STREAM_ID = newObjectId();
const OWNER_ID = newObjectId();
const TARGET = { streamId: STREAM_ID, ownerUserId: OWNER_ID };

const makeService = () => {
  const tasks = {
    upsertMirrored: jest.fn().mockImplementation(async (streamId: string, externalId: string) => ({
      id: newObjectId(),
      streamId,
      externalId,
    })),
  };
  const messages = {
    mirror: jest.fn().mockImplementation(async (streamId: string, externalId: string) => ({
      id: newObjectId(),
      streamId,
      externalId,
    })),
    upsertComponent: jest.fn().mockResolvedValue({ id: newObjectId() }),
  };
  const mirror = {
    upsertProjection: jest.fn().mockResolvedValue({ id: newObjectId() }),
    upsertStepComponent: jest.fn().mockResolvedValue({ id: newObjectId() }),
    upsertStepArtifact: jest.fn().mockResolvedValue({ id: newObjectId() }),
    findCursor: jest.fn().mockResolvedValue(null),
    saveCursor: jest.fn().mockResolvedValue(undefined),
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
    streamService as never,
    events as never,
    logger as never,
    tasks as never,
    messages as never,
    mirror as never,
  );

  return { service, tasks, messages, mirror, streamService, events, logger };
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

describe('WorkyElectricConsumerService.subscribe', () => {
  const ShapeStreamMock = ShapeStream as unknown as jest.Mock;
  let onBatch: ((messages: unknown[]) => Promise<void>) | undefined;

  beforeEach(() => {
    onBatch = undefined;
    ShapeStreamMock.mockReset();
    ShapeStreamMock.mockImplementation(() => ({
      shapeHandle: 'handle-2',
      lastOffset: '43_0',
      subscribe: jest.fn((callback: (messages: unknown[]) => Promise<void>) => {
        onBatch = callback;
        return jest.fn();
      }),
    }));
  });

  it('resumes the shape from the stored handle and log offset', async () => {
    const { service, mirror } = makeService();
    mirror.findCursor.mockResolvedValue({ shape: 'messages:turn-id-v1', handle: 'handle-1', logOffset: '42_0' });

    await (service as any).subscribe('messages', 'messages', jest.fn(), 'messages:turn-id-v1');

    expect(mirror.findCursor).toHaveBeenCalledWith('messages:turn-id-v1');
    expect(ShapeStreamMock).toHaveBeenCalledWith(expect.objectContaining({
      url: 'http://electric:3000/v1/shape',
      params: { table: 'messages', replica: 'full', secret: 'shh' },
      handle: 'handle-1',
      offset: '42_0',
    }));
  });

  it('starts from scratch when no cursor was stored for the shape', async () => {
    const { service, mirror } = makeService();

    await (service as any).subscribe('plan_step_artifacts', 'plan_step_artifacts', jest.fn());

    expect(mirror.findCursor).toHaveBeenCalledWith('plan_step_artifacts');
    const options = ShapeStreamMock.mock.calls[0][0];
    expect(options.handle).toBeUndefined();
    expect(options.offset).toBeUndefined();
  });

  it('persists the stream position under the cursor key once the batch is handled', async () => {
    const { service, mirror } = makeService();
    const handler = jest.fn().mockResolvedValue(undefined);

    await (service as any).subscribe('messages', 'messages', handler, 'messages:turn-id-v1');
    await onBatch!([{ headers: { control: 'up-to-date' } }]);

    expect(handler).toHaveBeenCalledWith([{ headers: { control: 'up-to-date' } }]);
    expect(mirror.saveCursor).toHaveBeenCalledWith('messages:turn-id-v1', 'handle-2', '43_0');
    expect(handler.mock.invocationCallOrder[0]).toBeLessThan(mirror.saveCursor.mock.invocationCallOrder[0]);
  });

  it('stops only the failing shape on a non-retryable error instead of throwing', async () => {
    const { service, logger } = makeService();

    await (service as any).subscribe('message_components', 'message_components', jest.fn());
    const { onError } = ShapeStreamMock.mock.calls[0][0];

    expect(onError(new Error('Table "public"."message_components" does not exist.'))).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('table missing'),
      expect.objectContaining({ shape: 'message_components', table: 'message_components' }),
    );
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
    const { service, mirror, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue(TARGET);

    await service.handleSessions([{
      key: 'sessions/session-1', headers: { operation: 'insert' },
      value: { id: 'session-1', status: 'waiting', interrupt_id: 'ask:1' },
    }]);

    expect(streamService.findByAiSessionId).toHaveBeenCalledWith('session-1');
    // Only the session half: the plans shape owns title/goal/status.
    expect(mirror.upsertProjection).toHaveBeenCalledWith(
      STREAM_ID,
      { streamId: STREAM_ID, sessionStatus: 'waiting', activeInterruptId: 'ask:1' },
    );
    expect(events.emit).toHaveBeenCalledWith(OWNER_ID, STREAM_ID, expect.objectContaining({ type: 'stream.updated' }));
  });

  it('retries a failed session projection before completing the batch', async () => {
    const { service, mirror, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue(TARGET);
    mirror.upsertProjection
      .mockRejectedValueOnce(new Error('postgres unavailable'))
      .mockResolvedValueOnce({});
    (service as any).waitForProjectionRetry = jest.fn().mockResolvedValue(undefined);

    await service.handleSessions([{
      key: 'sessions/session-1', headers: { operation: 'update' },
      value: { id: 'session-1', status: 'paused', interrupt_id: null },
    }]);

    expect(mirror.upsertProjection).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('stops retrying without emitting when shutdown interrupts the batch', async () => {
    const { service, mirror, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue(TARGET);
    mirror.upsertProjection.mockRejectedValue(new Error('postgres unavailable'));
    (service as any).waitForProjectionRetry = jest.fn().mockImplementation(async () => {
      service.onModuleDestroy();
    });

    await service.handleSessions([{
      key: 'sessions/session-1', headers: { operation: 'update' },
      value: { id: 'session-1', status: 'paused', interrupt_id: null },
    }]);

    expect(mirror.upsertProjection).toHaveBeenCalledTimes(1);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('skips rows for an unknown session and logs a warning', async () => {
    const { service, mirror, streamService, events, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValue(null);

    await service.handleSessions([{
      key: 'sessions/session-9', headers: { operation: 'update' },
      value: { id: 'session-9', status: 'running', interrupt_id: null },
    }]);

    expect(mirror.upsertProjection).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[worky-electric] unknown session',
      { shape: 'sessions', sid: 'session-9' },
    );
  });
});

describe('WorkyElectricConsumerService.handleMessages', () => {
  it('upserts a message by (streamId, externalId) and emits the stored id to the owner', async () => {
    const { service, messages, streamService, events } = makeService();
    const storedId = newObjectId();
    streamService.findByAiSessionId.mockResolvedValue(TARGET);
    messages.mirror.mockResolvedValue({ id: storedId, streamId: STREAM_ID, externalId: 'pg-msg-1' });

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

    expect(messages.mirror).toHaveBeenCalledTimes(1);
    expect(messages.mirror).toHaveBeenCalledWith(
      STREAM_ID,
      'pg-msg-1',
      expect.objectContaining({ role: 'manager', content: 'hello', emittedAt: new Date('2026-07-03T00:00:00Z') }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      OWNER_ID,
      STREAM_ID,
      expect.objectContaining({
        type: 'message.appended',
        payload: expect.objectContaining({ id: storedId, role: 'manager', content: 'hello' }),
      }),
    );
  });

  it('emits the id of the adopted local owner copy, not the manager row id', async () => {
    // The adoption itself (match the un-mirrored local copy, stamp it with the
    // manager id, fall back to an externalId upsert) lives in
    // WorkyMessageRepository.mirror and is covered by its integration spec.
    const { service, messages, streamService, events } = makeService();
    const localId = newObjectId();
    streamService.findByAiSessionId.mockResolvedValue(TARGET);
    messages.mirror.mockResolvedValue({ id: localId, streamId: STREAM_ID, externalId: 'pg-msg-1', role: 'owner' });

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

    expect(messages.mirror).toHaveBeenCalledWith(
      STREAM_ID,
      'pg-msg-1',
      expect.objectContaining({ role: 'owner', content: 'ship the report' }),
    );
    // The SSE id is the stored id so it matches what the REST history returns.
    expect(events.emit).toHaveBeenCalledWith(
      OWNER_ID,
      STREAM_ID,
      expect.objectContaining({ payload: expect.objectContaining({ id: localId }) }),
    );
    expect(events.emit.mock.calls[0][2].payload.id).not.toBe('pg-msg-1');
  });

  it('skips delete operations (manager tombstones out of scope)', async () => {
    const { service, messages, streamService } = makeService();
    await service.handleMessages([
      { key: '"public"."messages"/"pg-1"', headers: { operation: 'delete' }, value: { id: 'pg-1', session_id: 'sess-xyz' } },
    ]);
    expect(messages.mirror).not.toHaveBeenCalled();
    expect(streamService.findByAiSessionId).not.toHaveBeenCalled();
  });

  it('skips rows for an unknown session and logs a warning', async () => {
    const { service, messages, streamService, events, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValue(null);

    await service.handleMessages([
      {
        key: '"public"."messages"/"pg-1"',
        headers: { operation: 'insert' },
        value: { id: 'pg-1', session_id: 'sess-unknown', role: 'user', content: 'hi', created_at: '2026-07-03T00:00:00Z' },
      },
    ]);

    expect(messages.mirror).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[worky-electric] unknown session',
      { shape: 'messages', sid: 'sess-unknown' },
    );
  });

  it('retries a failed message projection before advancing the batch', async () => {
    const { service, messages, streamService, events, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValue(TARGET);
    messages.mirror.mockRejectedValueOnce(new Error('db down'));
    (service as any).waitForProjectionRetry = jest.fn().mockResolvedValue(undefined);

    const makeMsg = (id: string) => ({
      key: `"public"."messages"/"${id}"`,
      headers: { operation: 'insert' },
      value: { id, session_id: 'sess-xyz', role: 'user', content: 'hi', created_at: '2026-07-03T00:00:00Z' },
    });

    await expect(service.handleMessages([makeMsg('pg-1'), makeMsg('pg-2')])).resolves.toBeUndefined();

    expect(messages.mirror).toHaveBeenCalledTimes(3);
    expect(messages.mirror.mock.calls.map((call) => call[1])).toEqual(['pg-1', 'pg-1', 'pg-2']);
    expect(events.emit).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      '[worky-electric] projection failed; retrying before cursor advance',
      expect.objectContaining({ shape: 'messages', error: 'db down' }),
    );
  });
});

describe('WorkyElectricConsumerService.handlePlanSteps', () => {
  it('upserts a plan_step by (streamId, externalId) and emits to the owner', async () => {
    const { service, tasks, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue(TARGET);

    await service.handlePlanSteps([
      {
        key: '"public"."plan_steps"/"step-1"',
        headers: { operation: 'insert' },
        value: { session_id: 'sess-xyz', step_id: 'step-1', ordinal: 1, status: 'in_progress', description: 'Do it' },
      },
      { headers: { control: 'up-to-date' } },
    ]);

    expect(tasks.upsertMirrored).toHaveBeenCalledTimes(1);
    expect(tasks.upsertMirrored).toHaveBeenCalledWith(
      STREAM_ID,
      'step-1',
      expect.objectContaining({ lane: 'running', executionState: 'running', ordinal: 1, title: 'Do it' }),
    );
    expect(events.emit).toHaveBeenCalledWith(OWNER_ID, STREAM_ID, expect.objectContaining({ type: 'task.updated' }));
  });

  it('logs a warning for an unknown plan_step status but still upserts (defaults to backlog)', async () => {
    const { service, tasks, streamService, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValue(TARGET);

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
    expect(tasks.upsertMirrored).toHaveBeenCalledWith(
      STREAM_ID,
      'step-1',
      expect.objectContaining({ lane: 'backlog' }),
    );
  });

  it('skips delete operations', async () => {
    const { service, tasks, streamService } = makeService();
    await service.handlePlanSteps([
      { key: '"public"."plan_steps"/"step-1"', headers: { operation: 'delete' }, value: { session_id: 'sess-xyz', step_id: 'step-1' } },
    ]);
    expect(tasks.upsertMirrored).not.toHaveBeenCalled();
    expect(streamService.findByAiSessionId).not.toHaveBeenCalled();
  });

  it('skips rows for an unknown session and logs a warning', async () => {
    const { service, tasks, streamService, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValue(null);

    await service.handlePlanSteps([
      {
        key: '"public"."plan_steps"/"step-1"',
        headers: { operation: 'insert' },
        value: { session_id: 'sess-unknown', step_id: 'step-1', ordinal: 1, status: 'pending', description: 'd' },
      },
    ]);

    expect(tasks.upsertMirrored).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[worky-electric] unknown session',
      { shape: 'plan_steps', sid: 'sess-unknown' },
    );
  });

  it('retries a failed row before processing subsequent rows', async () => {
    const { service, tasks, streamService, events, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValue(TARGET);
    tasks.upsertMirrored.mockRejectedValueOnce(new Error('db down'));
    (service as any).waitForProjectionRetry = jest.fn().mockResolvedValue(undefined);

    const makeMsg = (id: string) => ({
      key: `"public"."plan_steps"/"${id}"`,
      headers: { operation: 'insert' },
      value: { session_id: 'sess-xyz', step_id: id, ordinal: 1, status: 'pending', description: 'd' },
    });

    await expect(service.handlePlanSteps([makeMsg('step-1'), makeMsg('step-2')])).resolves.toBeUndefined();

    expect(tasks.upsertMirrored).toHaveBeenCalledTimes(3);
    expect(tasks.upsertMirrored.mock.calls.map((call) => call[1])).toEqual(['step-1', 'step-1', 'step-2']);
    expect(events.emit).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('retrying before cursor advance'),
      expect.objectContaining({ shape: 'plan_steps', error: 'db down' }),
    );
  });
});

describe('WorkyElectricConsumerService.handlePlans', () => {
  it('upserts a plan projection by streamId and emits to the owner', async () => {
    const { service, mirror, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue(TARGET);

    await service.handlePlans([
      {
        key: '"public"."plans"/"sess-xyz"',
        headers: { operation: 'insert' },
        value: { session_id: 'sess-xyz', title: 'My Plan', status: 'completed' },
      },
      { headers: { control: 'up-to-date' } },
    ]);

    expect(mirror.upsertProjection).toHaveBeenCalledTimes(1);
    // Only the plan half: the sessions shape owns sessionStatus/activeInterruptId.
    expect(mirror.upsertProjection).toHaveBeenCalledWith(
      STREAM_ID,
      { streamId: STREAM_ID, title: 'My Plan', goal: '', status: 'completed' },
    );
    expect(events.emit).toHaveBeenCalledWith(OWNER_ID, STREAM_ID, expect.objectContaining({ type: 'stream.updated' }));
  });

  it('skips delete operations', async () => {
    const { service, mirror, streamService } = makeService();
    await service.handlePlans([
      { key: '"public"."plans"/"sess-xyz"', headers: { operation: 'delete' }, value: { session_id: 'sess-xyz' } },
    ]);
    expect(mirror.upsertProjection).not.toHaveBeenCalled();
    expect(streamService.findByAiSessionId).not.toHaveBeenCalled();
  });

  it('skips rows for an unknown session and logs a warning', async () => {
    const { service, mirror, streamService, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValue(null);

    await service.handlePlans([
      {
        key: '"public"."plans"/"sess-unknown"',
        headers: { operation: 'insert' },
        value: { session_id: 'sess-unknown', title: 'T', status: 'pending' },
      },
    ]);

    expect(mirror.upsertProjection).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[worky-electric] unknown session',
      { shape: 'plans', sid: 'sess-unknown' },
    );
  });

  it('retries a failed row before processing subsequent rows', async () => {
    const { service, mirror, streamService, events, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValue(TARGET);
    mirror.upsertProjection.mockRejectedValueOnce(new Error('db down'));
    (service as any).waitForProjectionRetry = jest.fn().mockResolvedValue(undefined);

    const makeMsg = (id: string) => ({
      key: `"public"."plans"/"${id}"`,
      headers: { operation: 'insert' },
      value: { session_id: id, title: 'T', status: 'pending' },
    });

    await expect(service.handlePlans([makeMsg('sess-1'), makeMsg('sess-2')])).resolves.toBeUndefined();

    expect(mirror.upsertProjection).toHaveBeenCalledTimes(3);
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
  it('saves the handle and the offset of a shape', async () => {
    const { service, mirror } = makeService();
    await service.persistCursor('messages', 'handle-1', '1234_0');
    expect(mirror.saveCursor).toHaveBeenCalledWith('messages', 'handle-1', '1234_0');
  });

  it('stores a null handle when the stream has none yet', async () => {
    const { service, mirror } = makeService();
    await service.persistCursor('messages', undefined, '-1');
    expect(mirror.saveCursor).toHaveBeenCalledWith('messages', null, '-1');
  });
});

describe('WorkyElectricConsumerService.handleMessageComponents', () => {
  it('upserts a component projection and emits message.component.appended', async () => {
    const { service, messages, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: '507f1f77bcf86cd799439011', ownerUserId: 'u1' });
    await service.handleMessageComponents([
      { key: 'k', headers: { operation: 'insert' }, value: { session_id: 's1', message_id: 'msg-1', component_id: 'c-1', ordinal: 0, type: 'text', data: { content: 'hi' }, created_at: '2026-08-13T10:00:00.000Z' } },
    ]);
    expect(messages.upsertComponent).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      'c-1',
      expect.objectContaining({ externalId: 'c-1', messageExternalId: 'msg-1', type: 'text', data: { content: 'hi' } }),
    );
    expect(events.emit).toHaveBeenCalledWith('u1', '507f1f77bcf86cd799439011', expect.objectContaining({ type: 'message.component.appended' }));
  });

  it('skips control frames and delete ops', async () => {
    const { service, messages } = makeService();
    await service.handleMessageComponents([
      { headers: { control: 'up-to-date' } },
      { key: 'k', headers: { operation: 'delete' }, value: { session_id: 's1', message_id: 'm', component_id: 'c', ordinal: 0, type: 'text', data: {}, created_at: '' } },
    ]);
    expect(messages.upsertComponent).not.toHaveBeenCalled();
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

  it('skips a row for an unknown session and keeps going', async () => {
    const { service, messages, streamService, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValueOnce(null).mockResolvedValueOnce(TARGET);
    await service.handleMessageComponents([
      { key: 'k1', headers: { operation: 'insert' }, value: { session_id: 's-unknown', message_id: 'm', component_id: 'c-1', ordinal: 0, type: 'text', data: {}, created_at: '' } },
      { key: 'k2', headers: { operation: 'insert' }, value: { session_id: 's1', message_id: 'm', component_id: 'c-2', ordinal: 1, type: 'text', data: {}, created_at: '' } },
    ]);
    expect(logger.warn).toHaveBeenCalledWith('[worky-electric] unknown session', { shape: 'message_components', sid: 's-unknown' });
    expect(messages.upsertComponent).toHaveBeenCalledTimes(1);
    expect(messages.upsertComponent).toHaveBeenCalledWith(STREAM_ID, 'c-2', expect.anything());
  });

  it('logs a failed row and moves on without retrying', async () => {
    const { service, messages, streamService, events, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValue(TARGET);
    messages.upsertComponent.mockRejectedValueOnce(new Error('db down'));
    await service.handleMessageComponents([
      { key: 'k1', headers: { operation: 'insert' }, value: { session_id: 's1', message_id: 'm', component_id: 'c-1', ordinal: 0, type: 'text', data: {}, created_at: '' } },
      { key: 'k2', headers: { operation: 'insert' }, value: { session_id: 's1', message_id: 'm', component_id: 'c-2', ordinal: 1, type: 'text', data: {}, created_at: '' } },
    ]);
    expect(logger.error).toHaveBeenCalledWith('Failed to process message_component row', { error: 'db down' });
    expect(messages.upsertComponent).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenCalledTimes(1);
  });
});

describe('WorkyElectricConsumerService.handlePlanStepComponents', () => {
  it('upserts and emits task.component.appended', async () => {
    const { service, mirror, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: '507f1f77bcf86cd799439011', ownerUserId: 'u1' });
    await service.handlePlanStepComponents([
      { key: 'k', headers: { operation: 'insert' }, value: { session_id: 's1', step_id: 'step-1', component_id: 'c-9', ordinal: 1, type: 'code', data: { content: 'x' }, created_at: '2026-08-13T10:00:00.000Z' } },
    ]);
    expect(mirror.upsertStepComponent).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      'c-9',
      expect.objectContaining({ stepExternalId: 'step-1', ordinal: 1, type: 'code', data: { content: 'x' } }),
    );
    expect(events.emit).toHaveBeenCalledWith('u1', '507f1f77bcf86cd799439011', expect.objectContaining({ type: 'task.component.appended' }));
  });

  it('skips control frames, delete ops and unknown sessions', async () => {
    const { service, mirror, streamService, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValue(null);
    await service.handlePlanStepComponents([
      { headers: { control: 'up-to-date' } },
      { key: 'k', headers: { operation: 'delete' }, value: { session_id: 's1', step_id: 'step-1', component_id: 'c', ordinal: 0, type: 'code', data: {}, created_at: '' } },
      { key: 'k', headers: { operation: 'insert' }, value: { session_id: 's-unknown', step_id: 'step-1', component_id: 'c', ordinal: 0, type: 'code', data: {}, created_at: '' } },
    ]);
    expect(streamService.findByAiSessionId).toHaveBeenCalledTimes(1);
    expect(mirror.upsertStepComponent).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('[worky-electric] unknown session', { shape: 'plan_step_components', sid: 's-unknown' });
  });
});

describe('WorkyElectricConsumerService.handlePlanStepArtifacts', () => {
  it('upserts and emits task.artifact.appended', async () => {
    const { service, mirror, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: '507f1f77bcf86cd799439011', ownerUserId: 'u1' });
    await service.handlePlanStepArtifacts([
      { key: 'k', headers: { operation: 'insert' }, value: { session_id: 's1', step_id: 'step-1', artifact_id: 'a-1', file_path: 'key/abc', filename: 'r.pdf', artifact_kind: 'document', mime_type: 'application/pdf', size: 5, created_at: '2026-08-13T10:00:00.000Z' } },
    ]);
    expect(mirror.upsertStepArtifact).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      'a-1',
      expect.objectContaining({ stepExternalId: 'step-1', filePath: 'key/abc', filename: 'r.pdf', mimeType: 'application/pdf', size: 5 }),
    );
    expect(events.emit).toHaveBeenCalledWith('u1', '507f1f77bcf86cd799439011', expect.objectContaining({ type: 'task.artifact.appended' }));
  });

  it('skips control frames, delete ops and unknown sessions', async () => {
    const { service, mirror, streamService, logger } = makeService();
    streamService.findByAiSessionId.mockResolvedValue(null);
    await service.handlePlanStepArtifacts([
      { headers: { control: 'up-to-date' } },
      { key: 'k', headers: { operation: 'delete' }, value: { session_id: 's1', step_id: 'step-1', artifact_id: 'a', file_path: 'p', filename: 'f', created_at: '' } },
      { key: 'k', headers: { operation: 'insert' }, value: { session_id: 's-unknown', step_id: 'step-1', artifact_id: 'a', file_path: 'p', filename: 'f', created_at: '' } },
    ]);
    expect(streamService.findByAiSessionId).toHaveBeenCalledTimes(1);
    expect(mirror.upsertStepArtifact).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('[worky-electric] unknown session', { shape: 'plan_step_artifacts', sid: 's-unknown' });
  });
});

describe('WorkyElectricConsumerService.handleSessions terminal statuses', () => {
  it('emits stream.terminal (error) when a session goes failed', async () => {
    const { service, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue(TARGET);

    await service.handleSessions([
      { key: '"public"."sessions"/"sess-1"', headers: { operation: 'update' }, value: { id: 'sess-1', user_id: 'u1', status: 'failed' } },
    ]);

    expect(events.emit).toHaveBeenCalledWith(
      OWNER_ID,
      STREAM_ID,
      expect.objectContaining({ type: 'stream.terminal', payload: expect.objectContaining({ error: true }) }),
    );
  });

  it('emits stream.terminal (no error) when a session completes', async () => {
    const { service, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue(TARGET);

    await service.handleSessions([
      { key: '"public"."sessions"/"sess-1"', headers: { operation: 'update' }, value: { id: 'sess-1', user_id: 'u1', status: 'completed' } },
    ]);

    expect(events.emit).toHaveBeenCalledWith(
      OWNER_ID,
      STREAM_ID,
      expect.objectContaining({ type: 'stream.terminal', payload: expect.objectContaining({ error: false }) }),
    );
  });

  it('emits stream.updated but not stream.terminal for non-terminal statuses (running/blocked)', async () => {
    const { service, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue(TARGET);

    await service.handleSessions([
      { key: '"public"."sessions"/"sess-1"', headers: { operation: 'update' }, value: { id: 'sess-1', user_id: 'u1', status: 'running' } },
      { key: '"public"."sessions"/"sess-1"', headers: { operation: 'update' }, value: { id: 'sess-1', user_id: 'u1', status: 'blocked' } },
    ]);

    const emitCalls = events.emit.mock.calls;
    expect(emitCalls).toHaveLength(2);
    expect(emitCalls.every((call: unknown[]) => (call[2] as Record<string, unknown>)?.type === 'stream.updated')).toBe(true);
  });
});
