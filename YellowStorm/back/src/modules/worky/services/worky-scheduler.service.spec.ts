import { Types } from 'mongoose';
import { WorkySchedulerService } from './worky-scheduler.service';

class FakeCollection {
  private readonly docs = new Map<string, any>();

  findOne(filter: Record<string, unknown> = {}): any {
    let sortKey: string | null = null;
    let sortDir: 1 | -1 = 1;
    const exec = async () => {
      const matches = Array.from(this.docs.values()).filter((d) => this.matches(d, filter));
      if (sortKey) {
        matches.sort((a, b) => {
          const av = a[sortKey as string];
          const bv = b[sortKey as string];
          if (av === bv) return 0;
          if (av === undefined || av === null) return 1;
          if (bv === undefined || bv === null) return -1;
          if (av < bv) return -1 * sortDir;
          if (av > bv) return 1 * sortDir;
          return 0;
        });
      }
      return matches[0] ?? null;
    };
    const lean = () => ({ exec });
    const sort = (sortSpec: Record<string, 1 | -1>) => {
      const [[key, dir]] = Object.entries(sortSpec);
      sortKey = key;
      sortDir = dir;
      return { exec, lean };
    };
    return { exec, lean, sort };
  }

  findOneAndUpdate(filter: Record<string, unknown>, update: Record<string, unknown>, options: Record<string, unknown> = {}): any {
    const exec = async () => {
      for (const doc of this.docs.values()) {
        if (this.matches(doc, filter)) {
          Object.assign(doc, (update as { $set: Record<string, unknown> }).$set ?? {});
          return (options as { new: boolean }).new ? doc : doc;
        }
      }
      return null;
    };
    return { exec };
  }

  async create(doc: Record<string, unknown>): Promise<any> {
    const _id = (doc._id as Types.ObjectId) ?? new Types.ObjectId();
    const persisted: any = { ...doc, _id };
    this.docs.set(_id.toString(), persisted);
    return persisted;
  }

  findById(id: any): any {
    const doc = this.docs.get(id.toString()) ?? null;
    const exec = async () => doc;
    return {
      exec,
      lean: () => ({ exec }),
      select: () => ({ exec, lean: () => ({ exec }) }),
    };
  }

  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): any {
    for (const doc of this.docs.values()) {
      if (this.matches(doc, filter)) {
        Object.assign(doc, (update as { $set: Record<string, unknown> }).$set ?? {});
        const exec = async () => ({ matchedCount: 1, modifiedCount: 1 });
        return { exec };
      }
    }
    const exec = async () => ({ matchedCount: 0, modifiedCount: 0 });
    return { exec };
  }

  updateMany(filter: Record<string, unknown>, update: Record<string, unknown>): any {
    let count = 0;
    for (const doc of this.docs.values()) {
      if (this.matches(doc, filter)) {
        Object.assign(doc, (update as { $set: Record<string, unknown> }).$set ?? {});
        count += 1;
      }
    }
    const exec = async () => ({ modifiedCount: count });
    return { exec };
  }

  private matches(doc: any, filter: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(filter)) {
      const dv = doc[k];
      // Recognize Mongo-style operator filters. `v` can be either an
      // object with `$op` keys (e.g. `{ $lte: ... }`) or an array of
      // alternatives for top-level `$or`.
      const vIsOperatorObject =
        v && typeof v === 'object' && !(v instanceof Date);
      if (vIsOperatorObject) {
        // Top-level $or: value is an array of sub-filters.
        if (k === '$or' && Array.isArray(v)) {
          const ors = v as Array<Record<string, unknown>>;
          if (!ors.some((sub) => this.matches(doc, sub))) return false;
          continue;
        }
        if (!Array.isArray(v) && '$lte' in (v as Record<string, unknown>)) {
          const lte = (v as { $lte: Date }).$lte;
          if (dv && dv.getTime && lte && lte.getTime) {
            if (dv.getTime() > lte.getTime()) return false;
            continue;
          }
          return false;
        }
        if (
          dv &&
          typeof dv === 'object' &&
          'toString' in (dv as object) &&
          'toString' in (v as object) &&
          !Array.isArray(v)
        ) {
          if ((v as { toString(): string }).toString() !== (dv as { toString(): string }).toString()) return false;
          continue;
        }
      }
      if (dv !== v) return false;
    }
    return true;
  }
}

function buildService() {
  const events = new FakeCollection();
  const tasks = new FakeCollection();
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const service = new WorkySchedulerService(
    events as never,
    tasks as never,
    logger as never,
  );
  return { service, events, tasks, logger };
}

describe('WorkySchedulerService', () => {
  let ctx: ReturnType<typeof buildService>;
  beforeEach(() => {
    ctx = buildService();
  });

  it('schedule creates a pending row', async () => {
    const row = await ctx.service.schedule({
      streamId: new Types.ObjectId().toString(),
      taskId: null,
      eventType: 'reminder',
      fireAt: new Date(Date.now() + 60_000),
    });
    expect(row.status).toBe('pending');
    expect(row.eventType).toBe('reminder');
  });

  it('cancel only affects pending rows', async () => {
    const row = await ctx.service.schedule({
      streamId: new Types.ObjectId().toString(),
      taskId: null,
      eventType: 'reminder',
      fireAt: new Date(Date.now() + 60_000),
    });
    await ctx.service.cancel((row._id as Types.ObjectId).toString());
    const stored = (await ctx.events.findOne({ _id: row._id }).exec()) as { status: string };
    expect(stored.status).toBe('canceled');
  });

  it('claimDue is a no-op when no events are due', async () => {
    await ctx.service.schedule({
      streamId: new Types.ObjectId().toString(),
      taskId: null,
      eventType: 'reminder',
      fireAt: new Date(Date.now() + 60_000),
    });
    const claimed = await ctx.service.claimDue();
    expect(claimed).toBeNull();
  });

  it('claimDue picks the earliest due event and marks it claimed', async () => {
    const streamId = new Types.ObjectId().toString();
    const a = await ctx.service.schedule({
      streamId,
      taskId: null,
      eventType: 'reminder',
      fireAt: new Date(Date.now() - 1_000),
    });
    const b = await ctx.service.schedule({
      streamId,
      taskId: null,
      eventType: 'reminder',
      fireAt: new Date(Date.now() - 2_000),
    });
    const claimed = await ctx.service.claimDue();
    expect(claimed).toBeTruthy();
    expect((claimed!._id as Types.ObjectId).toString()).toBe((b._id as Types.ObjectId).toString());
    expect(claimed!.status).toBe('claimed');
    // The other one is still pending.
    const aStored = (await ctx.events.findOne({ _id: a._id }).exec()) as { status: string };
    expect(aStored.status).toBe('pending');
  });

  it('claimDue does not claim a row held by another worker within the lease window', async () => {
    const row = await ctx.service.schedule({
      streamId: new Types.ObjectId().toString(),
      taskId: null,
      eventType: 'reminder',
      fireAt: new Date(Date.now() - 1_000),
    });
    const first = await ctx.service.claimDue();
    expect(first).toBeTruthy();
    // Second attempt should not return the same row (it's still claimed).
    const second = await ctx.service.claimDue();
    expect(second).toBeNull();
    const stored = (await ctx.events.findOne({ _id: row._id }).exec()) as { status: string };
    expect(stored.status).toBe('claimed');
  });

  it('dispatchClaimed marks the row fired for a non-terminal task', async () => {
    const taskId = new Types.ObjectId();
    await ctx.tasks.create({
      _id: taskId,
      streamId: new Types.ObjectId(),
      title: 'T',
      executionState: 'running',
      lane: 'running',
    });
    const row = await ctx.service.schedule({
      streamId: new Types.ObjectId().toString(),
      taskId: taskId.toString(),
      eventType: 'reminder',
      fireAt: new Date(Date.now() - 1_000),
    });
    const claimed = await ctx.service.claimDue();
    expect(claimed).toBeTruthy();
    const outcome = await ctx.service.dispatchClaimed(claimed!);
    expect(outcome).toBe('fired');
    const stored = (await ctx.events.findOne({ _id: row._id }).exec()) as { status: string };
    expect(stored.status).toBe('fired');
  });

  it('dispatchClaimed is a no-op for terminal tasks', async () => {
    const taskId = new Types.ObjectId();
    await ctx.tasks.create({
      _id: taskId,
      streamId: new Types.ObjectId(),
      title: 'T',
      executionState: 'done',
      lane: 'done',
    });
    await ctx.service.schedule({
      streamId: new Types.ObjectId().toString(),
      taskId: taskId.toString(),
      eventType: 'reminder',
      fireAt: new Date(Date.now() - 1_000),
    });
    const claimed = await ctx.service.claimDue();
    expect(claimed).toBeTruthy();
    const outcome = await ctx.service.dispatchClaimed(claimed!);
    expect(outcome).toBe('skipped_terminal');
  });

  it('reconcile re-queues claimed rows whose lease expired', async () => {
    const row = await ctx.service.schedule({
      streamId: new Types.ObjectId().toString(),
      taskId: null,
      eventType: 'reminder',
      fireAt: new Date(Date.now() - 1_000),
    });
    const claimed = await ctx.service.claimDue();
    expect(claimed).toBeTruthy();
    // Simulate lease expiry by setting claimedAt to a time in the past.
    await ctx.events.updateOne(
      { _id: row._id },
      { $set: { claimedAt: new Date(Date.now() - 5 * 60_000) } },
    );
    const requeued = await ctx.service.reconcile();
    expect(requeued).toBe(1);
    const stored = (await ctx.events.findOne({ _id: row._id }).exec()) as {
      status: string;
      claimToken: string | null;
    };
    expect(stored.status).toBe('pending');
    expect(stored.claimToken).toBeNull();
  });

  it('reconcile is a no-op when there are no expired leases', async () => {
    await ctx.service.schedule({
      streamId: new Types.ObjectId().toString(),
      taskId: null,
      eventType: 'reminder',
      fireAt: new Date(Date.now() - 1_000),
    });
    const claimed = await ctx.service.claimDue();
    expect(claimed).toBeTruthy();
    const requeued = await ctx.service.reconcile();
    expect(requeued).toBe(0);
  });

  it('replays of dispatchClaimed are no-ops', async () => {
    const taskId = new Types.ObjectId();
    await ctx.tasks.create({
      _id: taskId,
      streamId: new Types.ObjectId(),
      title: 'T',
      executionState: 'running',
      lane: 'running',
    });
    const row = await ctx.service.schedule({
      streamId: new Types.ObjectId().toString(),
      taskId: taskId.toString(),
      eventType: 'reminder',
      fireAt: new Date(Date.now() - 1_000),
    });
    const claimed = await ctx.service.claimDue();
    expect(claimed).toBeTruthy();
    const first = await ctx.service.dispatchClaimed(claimed!);
    const second = await ctx.service.dispatchClaimed({
      ...(claimed as object),
      status: 'fired',
    } as never);
    expect(first).toBe('fired');
    expect(second).toBe('skipped_already_fired');
  });
});
