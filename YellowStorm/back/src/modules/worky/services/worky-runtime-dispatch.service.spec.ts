import { Types } from 'mongoose';
import { WorkyRuntimeDispatchService } from './worky-runtime-dispatch.service';
import { LoggerService } from '../../logger';
import { WorkyRuntimeClient, WorkyRuntimeSseResult } from './worky-runtime.client';
import { WorkyEventService } from './worky-event.service';
import { ModelsService } from '../../models/models.service';
import { WorkyStreamDocument } from '../schemas/worky-stream.schema';

const ownerId = new Types.ObjectId();

function makeStream(overrides: Partial<{ _id: Types.ObjectId; workerModelId: string | null; currentPlanVersion: number; executionPlanVersion: number | null }> = {}): WorkyStreamDocument {
  const _id = overrides._id ?? new Types.ObjectId();
  const stream: WorkyStreamDocument = {
    _id,
    ownerUserId: ownerId,
    workspaceId: new Types.ObjectId(),
    artifactWorkspaceId: new Types.ObjectId(),
    managerAgentId: new Types.ObjectId(),
    title: 'T',
    status: 'active',
    controlState: 'active',
    schedulerEnabled: true,
    currentPlanVersion: overrides.currentPlanVersion ?? 1,
    executionPlanVersion: overrides.executionPlanVersion ?? 1,
    budget: { limitUsd: 0, limitTokens: 0, spendUsd: 0, tokensUsed: 0, enforcement: 'hard_stop' },
    activeDurationMinutes: 0,
    lastActivityAt: new Date(),
    workerModelId: overrides.workerModelId ?? null,
  } as unknown as WorkyStreamDocument;
  return stream;
}

function buildService(overrides: { runtimeResult?: WorkyRuntimeSseResult; defaultModel?: string | null } = {}) {
  const runtime: { start: jest.Mock; resume: jest.Mock; stop: jest.Mock; cancelTask: jest.Mock } = {
    start: jest.fn().mockResolvedValue(overrides.runtimeResult ?? { ok: true, frames: [] }),
    resume: jest.fn().mockResolvedValue(overrides.runtimeResult ?? { ok: true, frames: [] }),
    stop: jest.fn().mockResolvedValue(overrides.runtimeResult ?? { ok: true, frames: [] }),
    cancelTask: jest.fn().mockResolvedValue(overrides.runtimeResult ?? { ok: true, frames: [] }),
  };
  const events = { emit: jest.fn() };
  const models = {
    getDefaultModel: jest.fn().mockResolvedValue({ id: 'admin-default', litellmModel: overrides.defaultModel ?? 'openai/gpt-4o-mini' }),
    getModelIdentifier: jest.fn((m: { id: string; litellmModel: string } | null) => m?.litellmModel ?? m?.id ?? null),
  };
  const tasks = {
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      }),
    }),
  };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as LoggerService;
  const service = new WorkyRuntimeDispatchService(
    runtime as unknown as WorkyRuntimeClient,
    events as unknown as WorkyEventService,
    models as unknown as ModelsService,
    tasks as any,
    logger,
  );
  return { service, runtime, events, models, tasks, logger };
}

describe('WorkyRuntimeDispatchService', () => {
  it('dispatchStart sends ready task ids and resolves worker model from stream persistent field', async () => {
    const stream = makeStream({ workerModelId: 'openai/gpt-4o' });
    const { service, runtime, events } = buildService();
    await service.dispatchStart(stream, ['t1', 't2']);
    expect(runtime.start).toHaveBeenCalledWith(
      stream._id.toString(),
      expect.objectContaining({
        ready_task_ids: ['t1', 't2'],
        worker_model_id: 'openai/gpt-4o',
      }),
    );
    expect(events.emit).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ type: 'stream.terminal' }),
    );
  });

  it('dispatchStart falls back to admin default model when stream field is empty', async () => {
    const stream = makeStream({ workerModelId: null });
    const { service, runtime } = buildService({ defaultModel: 'azure/gpt-4o-mini' });
    await service.dispatchStart(stream, ['t1']);
    expect(runtime.start).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ worker_model_id: 'azure/gpt-4o-mini' }),
    );
  });

  it('dispatchStart sends task contexts to the runtime', async () => {
    const taskId = new Types.ObjectId();
    const stream = makeStream({ workerModelId: 'openai/gpt-4o' });
    const { service, runtime, tasks } = buildService();
    tasks.find.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: taskId,
              title: 'Write report',
              description: 'Draft the result',
              priority: 'high',
              actionCategory: 'drafting',
              acceptanceCriteria: ['Clear summary'],
              dependsOn: [],
              requiredTools: [],
              assigneeType: 'ephemeral_ai_agent',
            },
          ]),
        }),
      }),
    });
    await service.dispatchStart(stream, [taskId.toString()]);
    expect(runtime.start).toHaveBeenCalledWith(
      stream._id.toString(),
      expect.objectContaining({
        task_contexts: expect.objectContaining({
          [taskId.toString()]: expect.objectContaining({ title: 'Write report' }),
        }),
      }),
    );
  });


  it('dispatchStart emits a stream.terminal error frame when the runtime returns ok=false', async () => {
    const stream = makeStream();
    const { service, events } = buildService({ runtimeResult: { ok: false, status: 503, frames: [], error: 'Runtime returned 503' } });
    await service.dispatchStart(stream, ['t1']);
    expect(events.emit).toHaveBeenCalledWith(
      ownerId.toString(),
      stream._id.toString(),
      expect.objectContaining({ type: 'stream.terminal', payload: expect.objectContaining({ error: true, source: 'execution-runtime-start' }) }),
    );
  });

  it('dispatchStart forwards runtime SSE frames to canonical Worky events', async () => {
    const stream = makeStream();
    const frames = [
      { type: 'execution.bootstrap', emitted_at: 1, payload: { stream_id: stream._id.toString() } },
      { type: 'worker.spawned', emitted_at: 2, payload: { task_id: 't1' } },
      { type: 'execution.done', emitted_at: 3, payload: {} },
    ];
    const { service, events } = buildService({ runtimeResult: { ok: true, frames } });
    await service.dispatchStart(stream, ['t1']);
    expect(events.emit).toHaveBeenCalledWith(
      ownerId.toString(),
      stream._id.toString(),
      expect.objectContaining({ type: 'worker.spawned' }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      ownerId.toString(),
      stream._id.toString(),
      expect.objectContaining({ type: 'stream.terminal', payload: expect.objectContaining({ error: false, source: 'execution-runtime-start-done' }) }),
    );
  });

  it('dispatchStop calls runtime.stop and surfaces a warning when the runtime is unreachable', async () => {
    const stream = makeStream();
    const { service, runtime, logger } = buildService({ runtimeResult: { ok: false, status: 500, frames: [], error: 'boom' } });
    await service.dispatchStop(stream);
    expect(runtime.stop).toHaveBeenCalledWith(stream._id.toString());
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('runtime stop failed'),
      expect.anything(),
    );
  });

  it('dispatchSingleTask always passes a single-element ready_task_ids array', async () => {
    const stream = makeStream();
    const { service, runtime } = buildService();
    await service.dispatchSingleTask(stream, 'task-7');
    expect(runtime.start).toHaveBeenCalledWith(
      stream._id.toString(),
      expect.objectContaining({ ready_task_ids: ['task-7'] }),
    );
  });
});
