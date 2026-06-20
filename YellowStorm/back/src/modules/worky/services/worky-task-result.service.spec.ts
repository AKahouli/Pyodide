import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { WorkyTaskResultService } from './worky-task-result.service';
import { WorkyTaskResult, WorkyTaskResultSchema } from '../schemas/worky-task-result.schema';
import { WorkyTask, WorkyTaskSchema } from '../schemas/worky-task.schema';
import { LoggerService } from '../../logger';

class FakeResults {
  private docs: any[] = [];
  private nextId = 1;
  findOne(): any {
    const exec = async () =>
      this.docs.length ? { version: Math.max(...this.docs.map((d) => d.version)) } : null;
    return { sort: () => ({ select: () => ({ lean: () => ({ exec }) }) }) };
  }
  async create(doc: any) {
    const _id = new Types.ObjectId();
    const created = { ...doc, _id, createdAt: new Date(), updatedAt: new Date() };
    this.docs.push(created);
    return created;
  }
  find(): any {
    const exec = async () => this.docs;
    return { sort: () => ({ lean: () => ({ exec }) }) };
  }
}

class FakeTasks {
  private docs = new Map<string, any>();
  async seed(id: Types.ObjectId, overrides: any = {}) {
    const doc = {
      _id: id,
      streamId: new Types.ObjectId(),
      lane: overrides.lane ?? 'ready',
      executionState: overrides.executionState ?? 'not_started',
      startedAt: overrides.startedAt ?? null,
      updatedAt: new Date(),
    };
    this.docs.set(id.toString(), doc);
  }
  updateOne(filter: any, update: any): any {
    const id = (filter._id as Types.ObjectId).toString();
    const doc = this.docs.get(id);
    let matched = 0;
    if (doc) {
      const inList = filter.executionState?.$nin ?? [];
      if (!inList.includes(doc.executionState)) {
        Object.assign(doc, update.$set);
        matched = 1;
      }
    }
    const exec = async () => ({ matchedCount: matched });
    return { exec };
  }
  findOne(filter: any): any {
    const id = (filter._id as Types.ObjectId).toString();
    const doc = this.docs.get(id);
    const inList = filter.executionState?.$nin ?? [];
    const result = doc && !inList.includes(doc.executionState) ? doc : null;
    return { select: () => ({ lean: () => ({ exec: async () => result }) }) };
  }
}

describe('WorkyTaskResultService', () => {
  let service: WorkyTaskResultService;
  let results: FakeResults;
  let tasks: FakeTasks;

  beforeEach(async () => {
    results = new FakeResults();
    tasks = new FakeTasks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkyTaskResultService,
        { provide: getModelToken(WorkyTaskResult.name), useValue: results },
        { provide: getModelToken(WorkyTask.name), useValue: tasks },
        {
          provide: LoggerService,
          useValue: { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        },
      ],
    }).compile();
    service = moduleRef.get(WorkyTaskResultService);
  });

  it('persists the result row with a monotonically increasing version', async () => {
    const taskId = new Types.ObjectId();
    const first = await service.record({ taskId: taskId.toString(), status: 'done' });
    const second = await service.record({ taskId: taskId.toString(), status: 'done' });
    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
  });

  it('persists opaque payloads and exposes versioned task results', async () => {
    const taskId = new Types.ObjectId();
    await service.record({ taskId: taskId.toString(), status: 'done', summary: 'Result', payload: { output: 'Full output' } });
    const rows = await service.listForTask(taskId.toString());
    expect(rows[0]).toMatchObject({ summary: 'Result', payload: { output: 'Full output' } });
  });

  it('transitions a running task to done and returns taskTransitionedTo=done', async () => {
    const taskId = new Types.ObjectId();
    await tasks.seed(taskId, { lane: 'running', executionState: 'running', startedAt: new Date(Date.now() - 1000) });
    const result = await service.record({ taskId: taskId.toString(), status: 'done' });
    expect(result.taskTransitionedTo).toBe('done');
  });

  it('transitions a running task to failed and returns taskTransitionedTo=failed', async () => {
    const taskId = new Types.ObjectId();
    await tasks.seed(taskId, { lane: 'running', executionState: 'running' });
    const result = await service.record({ taskId: taskId.toString(), status: 'failed' });
    expect(result.taskTransitionedTo).toBe('failed');
  });

  it('is a no-op on task state when the status is not terminal', async () => {
    const taskId = new Types.ObjectId();
    await tasks.seed(taskId, { lane: 'running', executionState: 'running' });
    const result = await service.record({ taskId: taskId.toString(), status: 'partial' });
    expect(result.taskTransitionedTo).toBe('no_change');
  });

  it('is a no-op on task state when the task is already terminal', async () => {
    const taskId = new Types.ObjectId();
    await tasks.seed(taskId, { lane: 'done', executionState: 'done' });
    const result = await service.record({ taskId: taskId.toString(), status: 'done' });
    expect(result.taskTransitionedTo).toBe('no_change');
  });
});
