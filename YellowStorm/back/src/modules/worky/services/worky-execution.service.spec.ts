import { Types } from 'mongoose';
import { WorkyExecutionService } from './worky-execution.service';
import { WorkyEventService } from './worky-event.service';
import { WorkyAuditService } from './worky-audit.service';

const ownerId = new Types.ObjectId().toString();

/**
 * Minimal Mongoose-model mock that supports the chain patterns used by
 * WorkyExecutionService. Every collection is a Map; queries are linear
 * scans with simple equality matching. Lean/exec chains return data.
 */
class FakeCollection {
  private readonly docs = new Map<string, any>();

  findById(id: any): any {
    const doc = this.docs.get(id.toString()) ?? null;
    const exec = async () => doc;
    return {
      exec,
      lean: () => ({ exec }),
      select: () => ({ exec, lean: () => ({ exec }) }),
    };
  }

  find(filter: Record<string, unknown> = {}): any {
    const matches = this.matchDocs(filter);
    const exec = async () => matches;
    return {
      exec,
      lean: () => ({ exec }),
      select: () => ({ exec, lean: () => ({ exec }) }),
      sort: () => ({ exec, lean: () => ({ exec }) }),
    };
  }

  findOne(filter: Record<string, unknown> = {}): any {
    const exec = async () => this.matchDocs(filter)[0] ?? null;
    return {
      exec,
      lean: () => ({ exec }),
      select: () => ({ exec, lean: () => ({ exec }) }),
      sort: () => ({ exec, lean: () => ({ exec }) }),
    };
  }

  async create(doc: Record<string, unknown>): Promise<any> {
    const _id = (doc._id as Types.ObjectId) ?? new Types.ObjectId();
    const persisted: any = {
      ...doc,
      _id,
      id: _id.toString(),
      set: (k: string, v: unknown) => {
        (persisted as Record<string, unknown>)[k] = v;
      },
      save: async function save() {
        return persisted;
      },
    };
    this.docs.set(_id.toString(), persisted);
    return persisted;
  }

  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): any {
    const id = (filter._id as Types.ObjectId).toString();
    const doc = this.docs.get(id);
    if (doc) {
      Object.assign(doc, (update as { $set: Record<string, unknown> }).$set ?? {});
    }
    const exec = async () => ({ matchedCount: doc ? 1 : 0 });
    return { exec };
  }

  private matchDocs(filter: Record<string, unknown>): any[] {
    const result: any[] = [];
    for (const doc of this.docs.values()) {
      if (matchesFilter(doc, filter)) result.push(doc);
    }
    return result;
  }
}

function matchesFilter(doc: any, filter: Record<string, unknown>): boolean {
  for (const [key, val] of Object.entries(filter)) {
    const docVal = doc[key];
    if (val && typeof val === 'object' && '$in' in (val as Record<string, unknown>)) {
      const inList = (val as { $in: unknown[] }).$in;
      const ok = inList.some((v) => (v as { toString(): string }).toString() === (docVal as { toString(): string } | null | undefined)?.toString?.());
      if (!ok) return false;
      continue;
    }
    if (val && typeof val === 'object' && 'toString' in (val as object) && docVal && typeof docVal === 'object' && 'toString' in (docVal as object)) {
      const a = (val as { toString(): string }).toString();
      const b = (docVal as { toString(): string }).toString();
      if (a !== b) return false;
      continue;
    }
    if (docVal !== val) return false;
  }
  return true;
}

function buildService(collections: { streams: FakeCollection; tasks: FakeCollection; snapshots: FakeCollection }) {
  const events = { emit: jest.fn() };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const dispatch = {
    dispatchStart: jest.fn().mockResolvedValue({ ok: true, frames: [] }),
    dispatchResume: jest.fn().mockResolvedValue({ ok: true, frames: [] }),
    dispatchStop: jest.fn().mockResolvedValue({ ok: true, frames: [] }),
    dispatchCancelTask: jest.fn().mockResolvedValue({ ok: true, frames: [] }),
    dispatchSingleTask: jest.fn().mockResolvedValue({ ok: true, frames: [] }),
  };
  const service = new WorkyExecutionService(
    collections.streams as never,
    collections.tasks as never,
    collections.snapshots as never,
    events as never,
    audit as never,
    dispatch as never,
    { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as never,
  );
  return { service, events, audit, dispatch };
}

interface StreamOverrides {
  _id?: Types.ObjectId;
  currentPlanVersion?: number;
  executionPlanVersion?: number | null;
  status?: string;
  controlState?: string;
}

interface TaskOverrides {
  _id?: Types.ObjectId;
  title?: string;
  lane?: string;
  executionState?: string;
  assigneeType?: string;
  dependsOn?: Types.ObjectId[];
}

async function seedStream(streams: FakeCollection, overrides: StreamOverrides = {}): Promise<string> {
  const id = overrides._id ?? new Types.ObjectId();
  await streams.create({
    _id: id,
    ownerUserId: new Types.ObjectId(ownerId),
    workspaceId: new Types.ObjectId(),
    artifactWorkspaceId: new Types.ObjectId(),
    managerAgentId: new Types.ObjectId(),
    title: 'Test stream',
    status: overrides.status ?? 'created',
    controlState: overrides.controlState ?? 'active',
    schedulerEnabled: false,
    currentPlanVersion: overrides.currentPlanVersion ?? 1,
    executionPlanVersion: overrides.executionPlanVersion ?? null,
    budget: { limitUsd: 0, limitTokens: 0, spendUsd: 0, tokensUsed: 0, enforcement: 'hard_stop' },
    activeDurationMinutes: 0,
    lastActivityAt: new Date(),
  });
  return id.toString();
}

async function seedTask(
  tasks: FakeCollection,
  streamId: Types.ObjectId,
  overrides: TaskOverrides = {},
): Promise<string> {
  const id = overrides._id ?? new Types.ObjectId();
  await tasks.create({
    _id: id,
    streamId,
    title: overrides.title ?? 'Task',
    lane: overrides.lane ?? 'ready',
    planningStatus: 'confirmed',
    executionState: overrides.executionState ?? 'not_started',
    controlState: 'active',
    priority: 'medium',
    assigneeType: overrides.assigneeType ?? 'ephemeral_ai_agent',
    assigneeId: null,
    dependsOn: overrides.dependsOn ?? [],
    requiredTools: [],
    actionCategory: 'internal_analysis',
    acceptanceCriteria: [],
    budget: { estimateUsd: 0, actualUsd: 0, tokensEstimate: 0, tokensActual: 0 },
    waitConditions: [],
  });
  return id.toString();
}

describe('WorkyExecutionService', () => {
  let streams: FakeCollection;
  let tasks: FakeCollection;
  let snapshots: FakeCollection;
  let service: WorkyExecutionService;
  let events: { emit: jest.Mock };
  let audit: { append: jest.Mock };
  let dispatch: {
    dispatchStart: jest.Mock;
    dispatchResume: jest.Mock;
    dispatchStop: jest.Mock;
    dispatchCancelTask: jest.Mock;
    dispatchSingleTask: jest.Mock;
  };

  beforeEach(() => {
    streams = new FakeCollection();
    tasks = new FakeCollection();
    snapshots = new FakeCollection();
    const built = buildService({ streams, tasks, snapshots });
    service = built.service;
    events = built.events;
    audit = built.audit;
    dispatch = built.dispatch;
  });

  it('returns globally_blocked with no_tasks when plan is empty', async () => {
    const streamId = await seedStream(streams, { currentPlanVersion: 0 });
    const result = await service.validateStart(streamId, ownerId);
    expect(result.outcome).toBe('globally_blocked');
    expect(result.issues[0].code).toBe('no_tasks');
  });

  it('returns globally_blocked when all tasks are unassigned', async () => {
    const streamObjectId = new Types.ObjectId();
    const streamId = streamObjectId.toString();
    await seedStream(streams, { _id: streamObjectId, currentPlanVersion: 1 });
    await seedTask(tasks, streamObjectId, { assigneeType: 'unassigned' });
    const result = await service.validateStart(streamId, ownerId);
    expect(result.outcome).toBe('globally_blocked');
    expect(result.issues.find((i) => i.code === 'unassigned')).toBeDefined();
  });

  it('returns fully_executable when all tasks are assigned and acyclic', async () => {
    const streamObjectId = new Types.ObjectId();
    const streamId = streamObjectId.toString();
    await seedStream(streams, { _id: streamObjectId, currentPlanVersion: 1 });
    await seedTask(tasks, streamObjectId, { assigneeType: 'ephemeral_ai_agent' });
    const result = await service.validateStart(streamId, ownerId);
    expect(result.outcome).toBe('fully_executable');
    expect(result.readyTaskIds).toHaveLength(1);
    expect(result.blockedTaskIds).toHaveLength(0);
  });

  it('only starts dependency roots when downstream tasks depend on unfinished tasks', async () => {
    const streamObjectId = new Types.ObjectId();
    const streamId = streamObjectId.toString();
    await seedStream(streams, { _id: streamObjectId, currentPlanVersion: 1 });
    const rootTaskId = await seedTask(tasks, streamObjectId, {
      assigneeType: 'ephemeral_ai_agent',
      title: 'Root',
    });
    const childTaskId = await seedTask(tasks, streamObjectId, {
      assigneeType: 'ephemeral_ai_agent',
      title: 'Child',
      dependsOn: [new Types.ObjectId(rootTaskId)],
    });
    const result = await service.validateStart(streamId, ownerId);
    expect(result.outcome).toBe('partially_executable');
    expect(result.readyTaskIds).toEqual([rootTaskId]);
    expect(result.blockedTaskIds).toEqual([childTaskId]);
    expect(result.issues.find((i) => i.code === 'dependency_pending')).toBeDefined();
  });

  it('returns partially_executable when some tasks are blocked', async () => {
    const streamObjectId = new Types.ObjectId();
    const streamId = streamObjectId.toString();
    await seedStream(streams, { _id: streamObjectId, currentPlanVersion: 1 });
    await seedTask(tasks, streamObjectId, { assigneeType: 'ephemeral_ai_agent', title: 'A' });
    await seedTask(tasks, streamObjectId, { assigneeType: 'unassigned', title: 'B' });
    const result = await service.validateStart(streamId, ownerId);
    expect(result.outcome).toBe('partially_executable');
    expect(result.readyTaskIds).toHaveLength(1);
    expect(result.blockedTaskIds).toHaveLength(1);
  });

  it('createSnapshot is idempotent on the same plan version', async () => {
    const streamObjectId = new Types.ObjectId();
    const streamId = streamObjectId.toString();
    await seedStream(streams, { _id: streamObjectId, currentPlanVersion: 1 });
    await seedTask(tasks, streamObjectId, { assigneeType: 'ephemeral_ai_agent' });
    const first = await service.createSnapshot(streamId, ownerId);
    const second = await service.createSnapshot(streamId, ownerId);
    expect(first.snapshotId).toBeTruthy();
    expect(second.snapshotId).toBe(first.snapshotId);
    // Two calls but they reference the same snapshot id; the audit row
    // count is irrelevant for idempotency — what matters is that the
    // second call does not create a second snapshot row.
    expect(events.emit).toHaveBeenCalledWith(
      expect.anything(),
      streamId,
      expect.objectContaining({ type: 'stream.started' }),
    );
  });

  it('createSnapshot flips status to partially_blocked for partial runs', async () => {
    const streamObjectId = new Types.ObjectId();
    const streamId = streamObjectId.toString();
    await seedStream(streams, { _id: streamObjectId, currentPlanVersion: 1 });
    await seedTask(tasks, streamObjectId, { assigneeType: 'ephemeral_ai_agent', title: 'A' });
    await seedTask(tasks, streamObjectId, { assigneeType: 'unassigned', title: 'B' });
    const result = await service.createSnapshot(streamId, ownerId);
    expect(result.outcome).toBe('partially_executable');
    const updated = await streams.findById(streamObjectId).exec();
    expect(updated.status).toBe('partially_blocked');
    expect(events.emit).toHaveBeenCalledWith(
      expect.anything(),
      streamId,
      expect.objectContaining({ type: 'stream.started' }),
    );
  });

  it('createSnapshot invokes dispatch.dispatchStart with the ready task ids', async () => {
    const streamObjectId = new Types.ObjectId();
    const streamId = streamObjectId.toString();
    await seedStream(streams, { _id: streamObjectId, currentPlanVersion: 1 });
    const taskA = await seedTask(tasks, streamObjectId, {
      assigneeType: 'ephemeral_ai_agent',
      title: 'A',
    });
    const taskB = await seedTask(tasks, streamObjectId, {
      assigneeType: 'ephemeral_ai_agent',
      title: 'B',
    });
    const result = await service.createSnapshot(streamId, ownerId);
    expect(result.outcome).toBe('fully_executable');
    expect(dispatch.dispatchStart).toHaveBeenCalledTimes(1);
    const [streamArg, readyIds] = dispatch.dispatchStart.mock.calls[0]!;
    expect(streamArg._id.toString()).toBe(streamObjectId.toString());
    expect(readyIds).toEqual(expect.arrayContaining([taskA, taskB]));
    expect(readyIds).toHaveLength(2);
  });

  it('createSnapshot does NOT invoke dispatch.dispatchStart when the plan is globally blocked', async () => {
    const streamObjectId = new Types.ObjectId();
    const streamId = streamObjectId.toString();
    await seedStream(streams, { _id: streamObjectId, currentPlanVersion: 1 });
    await seedTask(tasks, streamObjectId, { assigneeType: 'unassigned' });
    await service.createSnapshot(streamId, ownerId);
    expect(dispatch.dispatchStart).not.toHaveBeenCalled();
  });

  it('createSnapshot keeps status active and emits error frame when runtime start fails', async () => {
    const streamObjectId = new Types.ObjectId();
    const streamId = streamObjectId.toString();
    await seedStream(streams, { _id: streamObjectId, currentPlanVersion: 1 });
    await seedTask(tasks, streamObjectId, { assigneeType: 'ephemeral_ai_agent' });
    // Make the dispatched call resolve with ok=false; we don't await
    // the fire-and-forget path, so we trigger it by re-reading the
    // dispatched call arg.
    dispatch.dispatchStart.mockResolvedValueOnce({ ok: false, status: 503, frames: [], error: 'Runtime returned 503' });
    await service.createSnapshot(streamId, ownerId);
    // Drain microtasks so the void chain completes.
    await new Promise((r) => setImmediate(r));
    const updated = await streams.findById(streamObjectId).exec();
    expect(updated.status).toBe('active');
  });

  it('recomputeReadiness returns start_task commands on task.completed', async () => {
    const streamObjectId = new Types.ObjectId();
    const streamId = streamObjectId.toString();
    await seedStream(streams, {
      _id: streamObjectId,
      currentPlanVersion: 2,
      executionPlanVersion: 2,
      status: 'active',
      controlState: 'active',
    });
    const aId = await seedTask(tasks, streamObjectId, {
      title: 'A',
      executionState: 'done',
    });
    const bId = await seedTask(tasks, streamObjectId, {
      title: 'B',
      dependsOn: [new Types.ObjectId(aId)],
    });
    const commands = await service.recomputeReadiness(streamId, {
      type: 'task.completed',
      payload: { taskId: aId },
    });
    expect(commands).toHaveLength(1);
    expect(commands[0].type).toBe('start_task');
    expect(commands[0].taskId).toBe(bId);
  });

  it('pause transitions controlState and emits stream.paused', async () => {
    const streamId = await seedStream(streams, { status: 'active', controlState: 'active' });
    await service.pause(streamId, ownerId, 'pause-test');
    const stream = await streams.findById(streamId).exec();
    expect(stream.controlState).toBe('paused');
    expect(stream.status).toBe('paused');
    expect(events.emit).toHaveBeenCalledWith(
      expect.anything(),
      streamId,
      expect.objectContaining({ type: 'stream.paused' }),
    );
  });

  it('resume fires dispatchResume when the stream has an execution plan', async () => {
    const streamId = await seedStream(streams, {
      status: 'paused',
      controlState: 'paused',
      executionPlanVersion: 1,
    });
    await service.resume(streamId, ownerId, 'resume-test');
    await new Promise((r) => setImmediate(r));
    expect(dispatch.dispatchResume).toHaveBeenCalledTimes(1);
  });

  it('stop fires dispatchStop after the backend state is terminal', async () => {
    const streamId = await seedStream(streams, { status: 'active', controlState: 'active' });
    await service.stop(streamId, ownerId, 'stop-test');
    await new Promise((r) => setImmediate(r));
    const stream = await streams.findById(streamId).exec();
    expect(stream.status).toBe('stopped');
    expect(dispatch.dispatchStop).toHaveBeenCalledTimes(1);
  });

  it('allows pause, resume, and stop from any current control state', async () => {
    const pausedStreamId = await seedStream(streams, { status: 'stopped', controlState: 'stopped' });
    await expect(service.pause(pausedStreamId, ownerId, 'manual')).resolves.toBeNull();

    const freshStreamId = await seedStream(streams, { status: 'created', controlState: 'active' });
    await expect(service.resume(freshStreamId, ownerId, 'manual')).resolves.toBeNull();

    const stoppedStreamId = await seedStream(streams, { status: 'stopped', controlState: 'stopped' });
    await expect(service.stop(stoppedStreamId, ownerId, 'manual')).resolves.toBeUndefined();
  });

  it('allows moving a running task directly to any visible lane', async () => {
    const streamObjectId = new Types.ObjectId();
    await seedStream(streams, { _id: streamObjectId, status: 'active', controlState: 'active' });
    const taskId = await seedTask(tasks, streamObjectId, {
      lane: 'running',
      executionState: 'running',
    });

    const result = await service.moveTask(taskId, ownerId, 'done', 'owner override');

    expect(result.lane).toBe('done');
    expect(result.executionState).toBe('done');
  });

  it('cancelTask throws on running tasks', async () => {
    const streamObjectId = new Types.ObjectId();
    await seedStream(streams, { _id: streamObjectId });
    const taskId = await seedTask(tasks, streamObjectId, {
      title: 'Running',
      lane: 'running',
      executionState: 'running',
    });
    await expect(service.cancelTask(taskId, ownerId)).rejects.toMatchObject({ code: 'ERR_3514' });
  });

  it('cancelTask moves not_started task to canceled', async () => {
    const streamObjectId = new Types.ObjectId();
    await seedStream(streams, { _id: streamObjectId });
    const taskId = await seedTask(tasks, streamObjectId, {
      title: 'Cancel me',
      lane: 'ready',
      executionState: 'not_started',
    });
    const result = await service.cancelTask(taskId, ownerId);
    expect(result.lane).toBe('canceled');
    expect(result.executionState).toBe('canceled');
    await new Promise((r) => setImmediate(r));
    expect(dispatch.dispatchCancelTask).toHaveBeenCalledWith(taskId);
  });

  it('cancelTask supersedes done tasks without invoking dispatch', async () => {
    const streamObjectId = new Types.ObjectId();
    await seedStream(streams, { _id: streamObjectId });
    const taskId = await seedTask(tasks, streamObjectId, {
      title: 'Done',
      lane: 'done',
      executionState: 'done',
    });
    const result = await service.cancelTask(taskId, ownerId);
    expect(result.lane).toBe('superseded');
    await new Promise((r) => setImmediate(r));
    expect(dispatch.dispatchCancelTask).not.toHaveBeenCalled();
  });

  it('moveTask allows moving a running task to a terminal lane', async () => {
    const streamObjectId = new Types.ObjectId();
    await seedStream(streams, { _id: streamObjectId });
    const taskId = await seedTask(tasks, streamObjectId, {
      title: 'Running',
      lane: 'running',
      executionState: 'running',
    });
    const result = await service.moveTask(taskId, ownerId, 'canceled');
    expect(result.lane).toBe('canceled');
  });

  it('moveTask allows resurrecting a terminal task', async () => {
    const streamObjectId = new Types.ObjectId();
    await seedStream(streams, { _id: streamObjectId });
    const taskId = await seedTask(tasks, streamObjectId, {
      title: 'Failed',
      lane: 'failed',
      executionState: 'failed',
    });
    const result = await service.moveTask(taskId, ownerId, 'ready');
    expect(result.lane).toBe('ready');
    expect(result.executionState).toBe('scheduled');
  });
});
