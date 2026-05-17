import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { PlaybookFlowQueueService } from './playbook-flow-queue.service';

describe('PlaybookFlowQueueService', () => {
  let service: PlaybookFlowQueueService;
  let model: any;

  const OWNER = 'owner-1';
  const MAX_CONCURRENT = 3;
  const MAX_DEPTH = 50;

  interface FakeDoc {
    _id: string;
    id: string;
    ownerId: string;
    flowId: string;
    status: string;
    queuePosition: number;
    createdAt: Date;
    inputContext?: Record<string, unknown>;
  }

  let docs: Map<string, FakeDoc> = new Map();

  function makeDoc(id: string, overrides: Partial<FakeDoc> = {}): FakeDoc {
    return {
      _id: id,
      id,
      ownerId: OWNER,
      flowId: 'flow-1',
      status: 'queued',
      queuePosition: 0,
      createdAt: new Date(),
      ...overrides,
    };
  }

  function countDocs(filter: Record<string, unknown>): number {
    const { ownerId, status, _id } = filter;
    let result = 0;
    const excludeId = typeof _id === 'object' && _id !== null ? (_id as Record<string, unknown>).$ne as string | undefined : undefined;
    for (const [, doc] of docs) {
      if (doc.ownerId !== ownerId) continue;
      if (excludeId && doc._id === excludeId) continue;
      if (typeof status === 'object' && status !== null) {
        const arr = (status as { $in: readonly string[] }).$in;
        if (arr && arr.includes(doc.status)) result++;
      } else if (doc.status === status) {
        result++;
      }
    }
    return result;
  }

  beforeEach(async () => {
    docs = new Map();

    const mockModel = {
      countDocuments: jest.fn().mockImplementation((filter: Record<string, unknown>) => {
        return Promise.resolve(countDocs(filter));
      }),
      find: jest.fn().mockImplementation((filter: Record<string, unknown>) => {
        const { ownerId, status } = filter;
        const matches: FakeDoc[] = [];
        for (const [, doc] of docs) {
          if (doc.ownerId !== ownerId || doc.status !== status) continue;
          matches.push({ ...doc });
        }
        return {
          sort: () => ({
            lean: () => Promise.resolve(matches),
          }),
        };
      }),
      findOneAndUpdate: jest.fn().mockImplementation(
        (filter: Record<string, unknown>, update: Record<string, unknown>, opts?: Record<string, unknown>) => {
          const { ownerId, status } = filter;
          const sorted = [...docs.values()]
            .filter((d) => d.ownerId === ownerId && d.status === status)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

          if (sorted.length === 0) {
            if (opts?.new) {
              return { select: () => ({ exec: () => Promise.resolve(null) }) };
            }
            return null;
          }

          const doc = sorted[0];
          Object.assign(doc, update);
          if (opts?.new) {
            return { select: () => ({ exec: () => Promise.resolve({ ...doc }) }) };
          }
          return null;
        },
      ),
      findByIdAndUpdate: jest.fn().mockImplementation(
        (id: string, update: Record<string, unknown>) => {
          const doc = docs.get(id);
          if (doc) {
            Object.assign(doc, update);
          }
          return { exec: () => Promise.resolve(doc ? { ...doc } : null) };
        },
      ),
      findById: jest.fn().mockImplementation((id: string, projection?: Record<string, unknown>) => {
        const doc = docs.get(id);
        if (!doc) return { lean: () => Promise.resolve(null) };
        return { lean: () => Promise.resolve({ ...doc }) };
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybookFlowQueueService,
        { provide: getModelToken('FlowExecution'), useValue: mockModel },
      ],
    }).compile();

    service = module.get<PlaybookFlowQueueService>(PlaybookFlowQueueService);
    model = mockModel;
  });

  describe('admit', () => {
    it('sets position to 1 when first in queue', async () => {
      const execId = 'exec-1';
      docs.set(execId, makeDoc(execId, { status: 'queued' }));

      const position = await service.admit(OWNER, execId, MAX_CONCURRENT, MAX_DEPTH);
      expect(position).toBe(1);
      expect(docs.get(execId)!.status).toBe('queued');
      expect(docs.get(execId)!.queuePosition).toBe(1);
    });

    it('sets position after existing queued executions', async () => {
      docs.set('q1', makeDoc('q1', { status: 'queued' }));

      const execId = 'exec-queued';
      docs.set(execId, makeDoc(execId, { status: 'queued' }));

      const position = await service.admit(OWNER, execId, MAX_CONCURRENT, MAX_DEPTH);
      expect(position).toBe(2);
      expect(docs.get(execId)!.status).toBe('queued');
    });

    it('rejects when queue depth exceeded', async () => {
      for (let i = 0; i <= MAX_DEPTH; i++) {
        docs.set(`queued-${i}`, makeDoc(`queued-${i}`, { status: 'queued' }));
      }

      const execId = 'exec-full';
      docs.set(execId, makeDoc(execId, { status: 'queued' }));

      const position = await service.admit(OWNER, execId, MAX_CONCURRENT, MAX_DEPTH);
      expect(position).toBe(-1);
    });
  });

  describe('claimNext', () => {
    it('claims oldest queued execution when capacity available', async () => {
      const old = 'exec-old';
      docs.set(old, makeDoc(old, { status: 'queued', createdAt: new Date('2020-01-01') }));
      docs.set('exec-new', makeDoc('exec-new', { status: 'queued', createdAt: new Date('2020-01-02') }));

      const claimed = await service.claimNext(OWNER, MAX_CONCURRENT);
      expect(claimed).not.toBeNull();
      expect(claimed!.id).toBe(old);
    });

    it('returns null when capacity is full', async () => {
      for (let i = 0; i < MAX_CONCURRENT; i++) {
        docs.set(`r-${i}`, makeDoc(`r-${i}`, { status: 'running' }));
      }
      docs.set('queued', makeDoc('queued', { status: 'queued' }));

      const claimed = await service.claimNext(OWNER, MAX_CONCURRENT);
      expect(claimed).toBeNull();
    });

    it('returns null when no queued executions', async () => {
      const claimed = await service.claimNext(OWNER, MAX_CONCURRENT);
      expect(claimed).toBeNull();
    });
  });

  describe('refreshPositions', () => {
    it('updates positions sequentially', async () => {
      docs.set('q1', makeDoc('q1', { status: 'queued', createdAt: new Date('2020-01-01') }));
      docs.set('q2', makeDoc('q2', { status: 'queued', createdAt: new Date('2020-01-02') }));
      docs.set('q3', makeDoc('q3', { status: 'queued', createdAt: new Date('2020-01-03') }));

      const changes = await service.refreshPositions(OWNER);
      expect(docs.get('q1')!.queuePosition).toBe(1);
      expect(docs.get('q2')!.queuePosition).toBe(2);
      expect(docs.get('q3')!.queuePosition).toBe(3);
    });

    it('skips updates when positions already correct', async () => {
      docs.set('q1', makeDoc('q1', { status: 'queued', queuePosition: 1, createdAt: new Date('2020-01-01') }));
      docs.set('q2', makeDoc('q2', { status: 'queued', queuePosition: 2, createdAt: new Date('2020-01-02') }));

      const changes = await service.refreshPositions(OWNER);
      expect(changes.length).toBe(0);
    });
  });

  describe('release', () => {
    it('claims next queued execution after release', async () => {
      docs.set('running', makeDoc('running', { status: 'running' }));
      docs.set('queued', makeDoc('queued', { status: 'queued' }));

      const claimed = await service.release(OWNER, MAX_CONCURRENT);
      expect(claimed).not.toBeNull();
      expect(claimed!.id).toBe('queued');
    });
  });
});
