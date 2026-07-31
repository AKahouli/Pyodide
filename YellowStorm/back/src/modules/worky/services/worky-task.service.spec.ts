import { Types } from 'mongoose';
import { WorkyTaskService } from './worky-task.service';

/**
 * Proxy-based query-chain stub: any method (find/sort/limit/lean/…) returns the
 * chain again; only `exec` resolves, to the supplied task docs.
 */
const makeChain = (tasks: unknown[]): unknown => {
  const handler = {
    get: (_t: unknown, prop: string) =>
      prop === 'exec' ? () => Promise.resolve(tasks) : () => proxy,
  };
  const proxy: unknown = new Proxy({}, handler);
  return proxy;
};

const makeService = (tasks: unknown[]) => {
  const model = makeChain(tasks) as never;
  const logger = { setContext: jest.fn() } as never;
  return new WorkyTaskService(model, logger);
};

describe('WorkyTaskService.projectForBoard', () => {
  const streamId = new Types.ObjectId().toString();

  it('projects assigneeKey onto the board task view', async () => {
    const service = makeService([
      { _id: new Types.ObjectId(), streamId, title: 'T', lane: 'running', assigneeKey: 'Researcher' },
    ]);
    const lanes = await service.projectForBoard(streamId, new Map());
    expect((lanes.running[0] as { assigneeKey?: string | null }).assigneeKey).toBe('Researcher');
  });

  it('defaults assigneeKey to null when absent', async () => {
    const service = makeService([
      { _id: new Types.ObjectId(), streamId, title: 'T', lane: 'ready' },
    ]);
    const lanes = await service.projectForBoard(streamId, new Map());
    expect((lanes.ready[0] as { assigneeKey?: string | null }).assigneeKey).toBeNull();
  });
});
