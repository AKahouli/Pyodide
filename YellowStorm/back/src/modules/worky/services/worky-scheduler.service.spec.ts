import { newObjectId } from '@common/postgres';
import { WorkySchedulerService } from './worky-scheduler.service';
import type { WorkyScheduledEventRecord, WorkyTaskRecord } from '../worky.types';

const timer = (over: Partial<WorkyScheduledEventRecord> = {}): WorkyScheduledEventRecord => ({
  id: newObjectId(),
  streamId: newObjectId(),
  taskId: null,
  eventType: 'reminder',
  fireAt: new Date(Date.now() - 1_000),
  status: 'claimed',
  claimToken: 'token',
  claimedAt: new Date(),
  firedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const task = (executionState: string, lane: string): WorkyTaskRecord =>
  ({ id: newObjectId(), streamId: newObjectId(), title: 'T', executionState, lane }) as WorkyTaskRecord;

function buildService() {
  const timers = {
    create: jest.fn().mockImplementation(async (input: Record<string, unknown>) =>
      timer({ ...input, status: 'pending', claimToken: null, claimedAt: null }),
    ),
    cancelPending: jest.fn().mockResolvedValue(undefined),
    claimDue: jest.fn().mockResolvedValue(null),
    markFired: jest.fn().mockResolvedValue(true),
    requeueExpired: jest.fn().mockResolvedValue(0),
  };
  const tasks = { findById: jest.fn().mockResolvedValue(null) };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const service = new WorkySchedulerService(timers as never, tasks as never, logger as never);
  return { service, timers, tasks, logger };
}

describe('WorkySchedulerService', () => {
  let ctx: ReturnType<typeof buildService>;
  beforeEach(() => {
    ctx = buildService();
  });

  describe('schedule', () => {
    it('creates a pending row and returns it', async () => {
      const streamId = newObjectId();
      const fireAt = new Date(Date.now() + 60_000);
      const row = await ctx.service.schedule({ streamId, taskId: null, eventType: 'reminder', fireAt });

      expect(ctx.timers.create).toHaveBeenCalledWith({ streamId, taskId: null, eventType: 'reminder', fireAt });
      expect(row.status).toBe('pending');
      expect(row.eventType).toBe('reminder');
    });

    it('rejects a malformed stream or task id', async () => {
      await expect(
        ctx.service.schedule({ streamId: 'nope', taskId: null, eventType: 'reminder', fireAt: new Date() }),
      ).rejects.toThrow(/invalid streamId/);
      await expect(
        ctx.service.schedule({ streamId: newObjectId(), taskId: 'nope', eventType: 'reminder', fireAt: new Date() }),
      ).rejects.toThrow(/invalid taskId/);
      expect(ctx.timers.create).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('cancels only a pending timer (the repository guards the status)', async () => {
      const id = newObjectId();
      await ctx.service.cancel(id);
      expect(ctx.timers.cancelPending).toHaveBeenCalledWith(id);
    });

    it('rejects a malformed id', async () => {
      await expect(ctx.service.cancel('nope')).rejects.toThrow(/invalid id/);
      expect(ctx.timers.cancelPending).not.toHaveBeenCalled();
    });
  });

  describe('claimDue', () => {
    // Ordering, the lease and concurrent claimers are the SQL statement's job: see the scheduler
    // cases of persistence/worky.repositories.spec.ts.
    it('is a no-op when no events are due', async () => {
      expect(await ctx.service.claimDue()).toBeNull();
    });

    it('claims with the current time and a fresh claim token per call', async () => {
      const claimed = timer();
      ctx.timers.claimDue.mockResolvedValueOnce(claimed).mockResolvedValueOnce(null);
      const before = Date.now();

      expect(await ctx.service.claimDue()).toBe(claimed);
      await ctx.service.claimDue();

      const [[firstNow, firstToken], [, secondToken]] = ctx.timers.claimDue.mock.calls as Array<[Date, string]>;
      expect(firstNow.getTime()).toBeGreaterThanOrEqual(before);
      expect(firstNow.getTime()).toBeLessThanOrEqual(Date.now());
      expect(firstToken).toMatch(/^[0-9a-f-]{36}$/);
      expect(secondToken).not.toBe(firstToken);
    });
  });

  describe('dispatchClaimed', () => {
    it('marks the row fired for a non-terminal task', async () => {
      const row = timer({ taskId: newObjectId() });
      ctx.tasks.findById.mockResolvedValueOnce(task('running', 'running'));

      const outcome = await ctx.service.dispatchClaimed(row);

      expect(outcome).toBe('fired');
      expect(ctx.tasks.findById).toHaveBeenCalledWith(row.taskId);
      expect(ctx.timers.markFired).toHaveBeenCalledWith(row.id, expect.any(Date));
    });

    it('is a no-op for terminal tasks, but still consumes the timer', async () => {
      const row = timer({ taskId: newObjectId() });
      ctx.tasks.findById.mockResolvedValueOnce(task('done', 'done'));

      const outcome = await ctx.service.dispatchClaimed(row);

      expect(outcome).toBe('skipped_terminal');
      expect(ctx.timers.markFired).toHaveBeenCalledWith(row.id, expect.any(Date));
      expect(ctx.logger.log).toHaveBeenCalledWith('Worky scheduled event skipped (task terminal)', expect.anything());
    });

    it('treats a task in a terminal lane as terminal', async () => {
      ctx.tasks.findById.mockResolvedValueOnce(task('not_started', 'archived'));
      expect(await ctx.service.dispatchClaimed(timer({ taskId: newObjectId() }))).toBe('skipped_terminal');
    });

    it('fires a stream-level timer without looking up a task', async () => {
      expect(await ctx.service.dispatchClaimed(timer())).toBe('fired');
      expect(ctx.tasks.findById).not.toHaveBeenCalled();
    });

    it('replays of dispatchClaimed are no-ops', async () => {
      expect(await ctx.service.dispatchClaimed(timer({ status: 'fired' }))).toBe('skipped_already_fired');
      expect(await ctx.service.dispatchClaimed(timer({ status: 'canceled' }))).toBe('skipped_already_fired');
      expect(ctx.timers.markFired).not.toHaveBeenCalled();
    });
  });

  describe('reconcile', () => {
    it('re-queues claimed rows whose lease expired a minute ago', async () => {
      ctx.timers.requeueExpired.mockResolvedValueOnce(1);
      const before = Date.now();

      expect(await ctx.service.reconcile()).toBe(1);

      const [cutoff] = ctx.timers.requeueExpired.mock.calls[0] as [Date];
      expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now() - 60_000);
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - 60_000);
      expect(ctx.logger.warn).toHaveBeenCalledWith('Worky scheduled events re-queued by reconciler', { count: 1 });
    });

    it('is a no-op when there are no expired leases', async () => {
      expect(await ctx.service.reconcile()).toBe(0);
      expect(ctx.logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('cronClaimDue', () => {
    it('drains the due timers until none is left', async () => {
      ctx.timers.claimDue.mockResolvedValueOnce(timer()).mockResolvedValueOnce(timer()).mockResolvedValueOnce(null);

      await ctx.service.cronClaimDue();

      expect(ctx.timers.claimDue).toHaveBeenCalledTimes(3);
      expect(ctx.timers.markFired).toHaveBeenCalledTimes(2);
    });

    it('logs instead of throwing when a claim fails', async () => {
      ctx.timers.claimDue.mockRejectedValueOnce(new Error('db down'));

      await expect(ctx.service.cronClaimDue()).resolves.toBeUndefined();

      expect(ctx.logger.error).toHaveBeenCalledWith('Worky scheduler claim-due failed', { error: 'db down' });
    });
  });
});
