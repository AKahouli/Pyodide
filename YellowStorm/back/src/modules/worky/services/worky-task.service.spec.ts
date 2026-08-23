import { Types } from 'mongoose';
import { WorkyTaskService, BOARD_LANES } from './worky-task.service';

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
  const stepComponents = makeChain([]) as never;
  const stepArtifacts = makeChain([]) as never;
  return new WorkyTaskService(model, logger, stepComponents, stepArtifacts);
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

  // Terminal lanes must stay on the board so a stopped/failed run shows its
  // canceled/failed tasks instead of the tasks silently vanishing. The status
  // itself comes from the API via Electric; we only surface it.
  it('keeps canceled tasks on the board in the canceled lane', async () => {
    const service = makeService([
      { _id: new Types.ObjectId(), streamId, title: 'Stopped task', lane: 'canceled' },
    ]);
    const lanes = await service.projectForBoard(streamId, new Map());
    expect(lanes.canceled).toHaveLength(1);
    expect((lanes.canceled[0] as { title: string }).title).toBe('Stopped task');
  });

  it('keeps failed tasks on the board in the failed lane', async () => {
    const service = makeService([
      { _id: new Types.ObjectId(), streamId, title: 'Broken task', lane: 'failed' },
    ]);
    const lanes = await service.projectForBoard(streamId, new Map());
    expect(lanes.failed).toHaveLength(1);
    expect((lanes.failed[0] as { title: string }).title).toBe('Broken task');
  });

  it('includes the terminal failed/canceled lanes in the board query set', () => {
    // BOARD_LANES is the `$in` filter for the Mongo board query, so terminal
    // lanes must be listed or the docs never load.
    expect(BOARD_LANES).toContain('failed');
    expect(BOARD_LANES).toContain('canceled');
  });
});

describe('WorkyTaskService.getResultContent', () => {
  it('returns sorted components + artifacts for a task, keyed by externalId', async () => {
    const task = { streamId: { toString: () => 'stream-oid' }, externalId: 'step-1' };
    const tasks = { findById: jest.fn().mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(task) }) }) };
    const stepComponents = { find: jest.fn().mockReturnValue({ sort: () => ({ lean: () => ({ exec: () => Promise.resolve([
      { externalId: 'c-1', ordinal: 0, type: 'text', data: { content: 'done' } },
    ]) }) }) }) };
    const stepArtifacts = { find: jest.fn().mockReturnValue({ sort: () => ({ lean: () => ({ exec: () => Promise.resolve([
      { externalId: 'a-1', filePath: 'k/1', filename: 'r.pdf', artifactKind: 'document', mimeType: 'application/pdf', size: 9, createdAt: new Date('2026-08-13T10:00:00Z') },
    ]) }) }) }) };

    const service: any = Object.create(WorkyTaskService.prototype);
    service.tasks = tasks;
    service.stepComponents = stepComponents;
    service.stepArtifacts = stepArtifacts;

    const out = await service.getResultContent('507f1f77bcf86cd799439011');
    expect(out.components).toEqual([{ id: 'c-1', type: 'text', data: { content: 'done' } }]);
    expect(out.artifacts).toEqual([{ id: 'a-1', filePath: 'k/1', filename: 'r.pdf', artifactKind: 'document', mimeType: 'application/pdf', size: 9, createdAt: '2026-08-13T10:00:00.000Z' }]);
  });

  it('returns empty arrays for an invalid task id', async () => {
    const service: any = Object.create(WorkyTaskService.prototype);
    const out = await service.getResultContent('not-an-objectid');
    expect(out).toEqual({ components: [], artifacts: [] });
  });
});
