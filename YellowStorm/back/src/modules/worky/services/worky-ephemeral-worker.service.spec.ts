import { Types } from 'mongoose';
import { WorkyEphemeralWorkerService } from './worky-ephemeral-worker.service';

class FakeCollection {
  private readonly docs = new Map<string, any>();
  findById(id: any): any {
    const doc = this.docs.get(id.toString()) ?? null;
    const exec = async () => doc;
    return { exec, lean: () => ({ exec }), select: () => ({ exec, lean: () => ({ exec }) }) };
  }
  findOne(filter: Record<string, unknown> = {}): any {
    const exec = async () => {
      for (const doc of this.docs.values()) {
        if (this.matches(doc, filter)) return doc;
      }
      return null;
    };
    return { exec, lean: () => ({ exec }) };
  }
  async create(doc: Record<string, unknown>): Promise<any> {
    const _id = (doc._id as Types.ObjectId) ?? new Types.ObjectId();
    const persisted: any = { ...doc, _id, id: _id.toString() };
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
  private matches(doc: any, filter: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(filter)) {
      const dv = doc[k];
      if (v && typeof v === 'object' && 'toString' in (v as object) && dv && typeof dv === 'object' && 'toString' in (dv as object)) {
        if ((v as { toString(): string }).toString() !== (dv as { toString(): string }).toString()) return false;
        continue;
      }
      if (dv !== v) return false;
    }
    return true;
  }
}

function buildService() {
  const streams = new FakeCollection();
  const tasks = new FakeCollection();
  const workers = new FakeCollection();
  const agents = new FakeCollection();
  const governance = {
    resolve: jest.fn(async (_streamId: string, category: string) => {
      if (category === 'external_send') {
        return { resolvedLevel: 'approval', source: 'default' };
      }
      if (category === 'hard_block') {
        return { resolvedLevel: 'hard_block', source: 'default' };
      }
      return { resolvedLevel: 'off', source: 'default' };
    }),
  };
  const events = { emit: jest.fn() };
  const audit = { append: jest.fn().mockResolvedValue(undefined) };
  const agentTypes = {
    findBySlug: jest
      .fn()
      .mockResolvedValue({ id: new Types.ObjectId().toString(), name: 'Manager', slug: 'manager' }),
  };
  const service = new WorkyEphemeralWorkerService(
    streams as never,
    tasks as never,
    workers as never,
    agents as never,
    agentTypes as never,
    governance as never,
    events as never,
    audit as never,
    { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as never,
  );
  return { service, streams, tasks, workers, agents, agentTypes, governance, events, audit };
}

async function seedStream(streams: FakeCollection, ownerId = new Types.ObjectId()): Promise<string> {
  const id = new Types.ObjectId();
  await streams.create({
    _id: id,
    ownerUserId: ownerId,
    workspaceId: new Types.ObjectId(),
    managerAgentId: new Types.ObjectId(),
  });
  return id.toString();
}

async function seedTask(tasks: FakeCollection, streamId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const id = new Types.ObjectId();
  await tasks.create({
    _id: id,
    streamId: new Types.ObjectId(streamId),
    title: 'T',
    lane: 'ready',
    actionCategory: 'internal_analysis',
    ...overrides,
  });
  return id.toString();
}

describe('WorkyEphemeralWorkerService', () => {
  let ctx: ReturnType<typeof buildService>;
  beforeEach(() => {
    ctx = buildService();
  });

  it('binds an ephemeral worker with the requested tools when governance is off', async () => {
    const streamId = await seedStream(ctx.streams);
    const taskId = await seedTask(ctx.tasks, streamId);
    const binding = await ctx.service.bindForTask({
      streamId,
      taskId,
      role: 'analyzer',
      // Two skill:* refs both classify as `internal_artifact_write` (off)
      // so the worker gets them all.
      toolRefs: ['skill:pdf-read', 'skill:summarize'],
    });
    expect(binding.role).toBe('analyzer');
    expect(binding.scopedToolRefs).toEqual(['skill:pdf-read', 'skill:summarize']);
    expect(binding.withheldToolRefs).toEqual([]);
    expect(ctx.governance.resolve).toHaveBeenCalledTimes(2);
    expect(ctx.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'worker.spawned' }),
    );
  });

  it('withholds gated tools from the worker until owner approves', async () => {
    const streamId = await seedStream(ctx.streams);
    const taskId = await seedTask(ctx.tasks, streamId, { actionCategory: 'external_send' });
    const binding = await ctx.service.bindForTask({
      streamId,
      taskId,
      role: 'comms',
      toolRefs: ['connector:send_email', 'skill:pdf-read'],
    });
    expect(binding.scopedToolRefs).toEqual(['skill:pdf-read']);
    expect(binding.withheldToolRefs).toEqual(['connector:send_email']);
  });

  it('refuses to bind for an unknown stream', async () => {
    await expect(
      ctx.service.bindForTask({
        streamId: new Types.ObjectId().toString(),
        taskId: new Types.ObjectId().toString(),
        role: 'analyzer',
        toolRefs: [],
      }),
    ).rejects.toMatchObject({ code: 'ERR_3500' });
  });

  it('refuses to bind for an unknown task', async () => {
    const streamId = await seedStream(ctx.streams);
    await expect(
      ctx.service.bindForTask({
        streamId,
        taskId: new Types.ObjectId().toString(),
        role: 'analyzer',
        toolRefs: [],
      }),
    ).rejects.toMatchObject({ code: 'ERR_3513' });
  });

  it('retire updates the worker status', async () => {
    const streamId = await seedStream(ctx.streams);
    const taskId = await seedTask(ctx.tasks, streamId);
    const binding = await ctx.service.bindForTask({
      streamId,
      taskId,
      role: 'analyzer',
      toolRefs: [],
    });
    await ctx.service.retire(binding.ephemeralWorkerId, 'done');
    const stored = (await ctx.workers.findById(binding.ephemeralWorkerId).exec()) as { status: string };
    expect(stored.status).toBe('done');
  });
});
