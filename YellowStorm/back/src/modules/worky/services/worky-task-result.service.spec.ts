import { newObjectId } from '@common/postgres';
import { WorkyTaskResultService } from './worky-task-result.service';
import type { NewWorkyTaskResult } from '../persistence/worky-task-result.repository';
import type { WorkyTaskResultRecord } from '../worky.types';

const TERMINAL = ['done', 'failed', 'canceled', 'superseded'];

/** In-memory stand-ins for the result and task repositories. */
function buildService() {
  const rows: WorkyTaskResultRecord[] = [];
  const taskStates = new Map<string, string>();
  const results = {
    append: jest.fn(async (input: NewWorkyTaskResult) => {
      const version = Math.max(0, ...rows.filter((r) => r.taskId === input.taskId).map((r) => r.version)) + 1;
      const row: WorkyTaskResultRecord = { id: newObjectId(), version, createdAt: new Date(), updatedAt: new Date(), ...input };
      rows.push(row);
      return row;
    }),
    listForTask: jest.fn(async (taskId: string) =>
      rows.filter((r) => r.taskId === taskId).sort((a, b) => b.version - a.version),
    ),
  };
  const tasks = {
    completeIfOpen: jest.fn(async (id: string, transition: { lane: string; executionState: string }) => {
      const state = taskStates.get(id);
      if (state === undefined || TERMINAL.includes(state)) return false;
      taskStates.set(id, transition.executionState);
      return true;
    }),
  };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const service = new WorkyTaskResultService(results as never, tasks as never, logger as never);
  const seedTask = (executionState = 'not_started') => {
    const id = newObjectId();
    taskStates.set(id, executionState);
    return id;
  };
  return { service, results, tasks, seedTask };
}

describe('WorkyTaskResultService', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('persists the result row with a monotonically increasing version', async () => {
    const taskId = ctx.seedTask('running');
    const first = await ctx.service.record({ taskId, status: 'partial' });
    const second = await ctx.service.record({ taskId, status: 'partial' });
    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(second.taskResultId).not.toBe(first.taskResultId);
  });

  it('persists opaque payloads and exposes versioned task results, newest first', async () => {
    const taskId = ctx.seedTask();
    await ctx.service.record({ taskId, status: 'partial', summary: 'Draft' });
    await ctx.service.record({ taskId, status: 'done', summary: 'Result', payload: { output: 'Full output' } });
    const rows = await ctx.service.listForTask(taskId);
    expect(rows.map((r) => r.version)).toEqual([2, 1]);
    expect(rows[0]).toMatchObject({ taskId, summary: 'Result', payload: { output: 'Full output' } });
    expect(rows[1].payload).toBeNull();
  });

  it('truncates oversized summaries and preserves the full text in payload.output', async () => {
    const taskId = ctx.seedTask();
    const longSummary = 'x'.repeat(15091);
    await ctx.service.record({ taskId, status: 'done', summary: longSummary });
    const rows = await ctx.service.listForTask(taskId);
    expect(rows[0].summary.length).toBeLessThanOrEqual(5000);
    expect(rows[0].summary).toContain('[truncated]');
    expect(rows[0].payload).toMatchObject({ output: longSummary });
  });

  it('keeps an explicit payload.output when the summary is oversized', async () => {
    const taskId = ctx.seedTask();
    await ctx.service.record({ taskId, status: 'done', summary: 'y'.repeat(6000), payload: { output: 'mine' } });
    expect(ctx.results.append).toHaveBeenCalledWith(expect.objectContaining({ payload: { output: 'mine' } }));
  });

  it('drops malformed artifact and worker ids', async () => {
    const taskId = ctx.seedTask();
    await ctx.service.record({ taskId, status: 'partial', contentArtifactId: 'nope', createdByWorkerId: 'nope' });
    expect(ctx.results.append).toHaveBeenCalledWith(expect.objectContaining({ contentArtifactId: null, createdByWorkerId: null }));
  });

  it('transitions a running task to done and returns taskTransitionedTo=done', async () => {
    const taskId = ctx.seedTask('running');
    const result = await ctx.service.record({ taskId, status: 'done' });
    expect(result.taskTransitionedTo).toBe('done');
    expect(ctx.tasks.completeIfOpen).toHaveBeenCalledWith(taskId, { lane: 'done', executionState: 'done' }, expect.any(Date));
  });

  it('transitions a running task to failed and returns taskTransitionedTo=failed', async () => {
    const taskId = ctx.seedTask('running');
    const result = await ctx.service.record({ taskId, status: 'failed' });
    expect(result.taskTransitionedTo).toBe('failed');
    expect(ctx.tasks.completeIfOpen).toHaveBeenCalledWith(taskId, { lane: 'done', executionState: 'failed' }, expect.any(Date));
  });

  it('is a no-op on task state when the status is not terminal', async () => {
    const taskId = ctx.seedTask('running');
    const result = await ctx.service.record({ taskId, status: 'partial' });
    expect(result.taskTransitionedTo).toBe('no_change');
    expect(ctx.tasks.completeIfOpen).not.toHaveBeenCalled();
  });

  it('is a no-op on task state when the task is already terminal', async () => {
    const taskId = ctx.seedTask('done');
    const result = await ctx.service.record({ taskId, status: 'done' });
    expect(result.taskTransitionedTo).toBe('no_change');
  });

  it('reports a task that does not exist as a clear error', async () => {
    ctx.results.append.mockRejectedValueOnce(Object.assign(new Error('violates foreign key constraint'), { code: '23503' }));
    const taskId = newObjectId();
    await expect(ctx.service.record({ taskId, status: 'done' })).rejects.toThrow(
      `WorkyTaskResultService.record: task ${taskId} not found`,
    );
    expect(ctx.tasks.completeIfOpen).not.toHaveBeenCalled();
  });

  it('rejects a malformed task id', async () => {
    await expect(ctx.service.record({ taskId: 'nope', status: 'done' })).rejects.toThrow(/invalid taskId/);
    expect(await ctx.service.listForTask('nope')).toEqual([]);
    expect(ctx.results.append).not.toHaveBeenCalled();
  });
});
