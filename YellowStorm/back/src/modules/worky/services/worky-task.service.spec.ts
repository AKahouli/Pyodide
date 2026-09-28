import { NotFoundException } from '@nestjs/common';
import { newObjectId } from '@common/postgres';
import { WorkyTaskService, BOARD_LANES } from './worky-task.service';
import type { WorkyPlanStepArtifactRecord, WorkyTaskRecord } from '../worky.types';

const task = (over: Partial<WorkyTaskRecord> = {}): WorkyTaskRecord => ({
  id: newObjectId(),
  streamId: newObjectId(),
  externalId: null,
  ordinal: null,
  result: null,
  blockedReason: null,
  wave: null,
  dependsOnStepIds: [],
  title: 'T',
  description: '',
  lane: 'backlog',
  planningStatus: 'pending',
  executionState: 'not_started',
  controlState: 'active',
  priority: 'medium',
  assigneeType: 'unassigned',
  assigneeId: null,
  assigneeKey: null,
  kind: 'execute',
  question: null,
  interruptId: null,
  assigneeName: null,
  assigneeRole: null,
  isPersona: false,
  isDynamicDelegate: false,
  dependsOn: [],
  requiredTools: [],
  actionCategory: 'internal_analysis',
  theoreticalDeadlineAt: null,
  acceptanceCriteria: [],
  waitConditions: [],
  startedAt: null,
  completedAt: null,
  durationMs: null,
  createdAt: new Date('2026-08-13T09:00:00Z'),
  updatedAt: new Date('2026-08-13T09:30:00Z'),
  budget: { estimateUsd: 0, actualUsd: 0, tokensEstimate: 0, tokensActual: 0 },
  ...over,
});

const artifact = (over: Partial<WorkyPlanStepArtifactRecord> = {}): WorkyPlanStepArtifactRecord => ({
  id: newObjectId(),
  streamId: newObjectId(),
  externalId: 'a-1',
  stepExternalId: 'step-1',
  filePath: 'k/1',
  filename: 'r.pdf',
  artifactKind: 'document',
  mimeType: 'application/pdf',
  size: 9,
  createdAt: new Date('2026-08-13T10:00:00Z'),
  updatedAt: new Date('2026-08-13T10:00:00Z'),
  ...over,
});

function makeService(tasksRepo: Record<string, jest.Mock> = {}, mirrorRepo: Record<string, jest.Mock> = {}) {
  const tasks = {
    findById: jest.fn().mockResolvedValue(null),
    findByIds: jest.fn().mockResolvedValue([]),
    listForBoard: jest.fn().mockResolvedValue([]),
    countByStream: jest.fn().mockResolvedValue(0),
    ...tasksRepo,
  };
  const mirror = {
    listStepComponents: jest.fn().mockResolvedValue([]),
    listStepArtifacts: jest.fn().mockResolvedValue([]),
    findStepArtifact: jest.fn().mockResolvedValue(null),
    ...mirrorRepo,
  };
  const documents = { generateSasUrl: jest.fn().mockResolvedValue('https://blob/sas') };
  const logger = { setContext: jest.fn() };
  const service = new WorkyTaskService(tasks as never, mirror as never, documents as never, logger as never);
  return { service, tasks, mirror, documents };
}

describe('WorkyTaskService.projectForBoard', () => {
  const streamId = newObjectId();

  it('reads the board lanes of the stream through the repository', async () => {
    const { service, tasks } = makeService();

    await service.projectForBoard(streamId, new Map());

    expect(tasks.listForBoard).toHaveBeenCalledWith(streamId, BOARD_LANES, 2000);
  });

  it('projects assigneeKey onto the board task view', async () => {
    const { service } = makeService({ listForBoard: jest.fn().mockResolvedValue([task({ lane: 'running', assigneeKey: 'Researcher' })]) });
    const lanes = await service.projectForBoard(streamId, new Map());
    expect(lanes.running[0].assigneeKey).toBe('Researcher');
  });

  it('defaults assigneeKey to null when absent', async () => {
    const { service } = makeService({ listForBoard: jest.fn().mockResolvedValue([task({ lane: 'ready' })]) });
    const lanes = await service.projectForBoard(streamId, new Map());
    expect(lanes.ready[0].assigneeKey).toBeNull();
  });

  it('projects semantic and cached delegation fields with safe defaults', async () => {
    const { service } = makeService({
      listForBoard: jest.fn().mockResolvedValue([
        task({
          title: 'Ask', lane: 'blocked', kind: 'ask',
          question: 'Which market?', interruptId: 'ask:1', assigneeName: 'Emmanuel',
          assigneeRole: 'Senior Business', isPersona: true, isDynamicDelegate: true,
        }),
        task({ title: 'Legacy', lane: 'ready' }),
      ]),
    });
    const lanes = await service.projectForBoard(streamId, new Map());
    expect(lanes.blocked[0]).toMatchObject({
      kind: 'ask', question: 'Which market?', interruptId: 'ask:1',
      assigneeName: 'Emmanuel', assigneeRole: 'Senior Business',
      isPersona: true, isDynamicDelegate: true,
    });
    expect(lanes.ready[0]).toMatchObject({
      kind: 'execute', question: null, interruptId: null,
      assigneeName: null, assigneeRole: null, isPersona: false, isDynamicDelegate: false,
    });
  });

  it('serialises dates and keeps the plan fields of the row', async () => {
    const dependency = newObjectId();
    const { service } = makeService({
      listForBoard: jest.fn().mockResolvedValue([
        task({
          lane: 'done', externalId: 'step-2', ordinal: 2, wave: 1, dependsOnStepIds: ['step-1'], dependsOn: [dependency],
          startedAt: new Date('2026-08-13T09:10:00Z'), completedAt: new Date('2026-08-13T09:20:00Z'), durationMs: 600000,
        }),
      ]),
    });
    const lanes = await service.projectForBoard(streamId, new Map());
    expect(lanes.done[0]).toMatchObject({
      streamId,
      externalId: 'step-2',
      ordinal: 2,
      wave: 1,
      dependsOnStepIds: ['step-1'],
      dependsOn: [dependency],
      startedAt: '2026-08-13T09:10:00.000Z',
      completedAt: '2026-08-13T09:20:00.000Z',
      durationMs: 600000,
      theoreticalDeadlineAt: null,
      createdAt: '2026-08-13T09:00:00.000Z',
      updatedAt: '2026-08-13T09:30:00.000Z',
    });
  });

  it('moves a task blocked by a pending interaction into the blocked lane with the reason', async () => {
    const blocked = task({ lane: 'ready' });
    const { service } = makeService({ listForBoard: jest.fn().mockResolvedValue([blocked]) });
    const lanes = await service.projectForBoard(streamId, new Map([[blocked.id, ['clarification:1', 'clarification:2']]]));
    expect(lanes.ready).toHaveLength(0);
    expect(lanes.blocked[0]).toMatchObject({ id: blocked.id, lane: 'blocked', blockerReason: 'clarification:1, clarification:2' });
  });

  // Terminal lanes must stay on the board so a stopped/failed run shows its
  // canceled/failed tasks instead of the tasks silently vanishing. The status
  // itself comes from the API via Electric; we only surface it.
  it('keeps canceled tasks on the board in the canceled lane', async () => {
    const { service } = makeService({ listForBoard: jest.fn().mockResolvedValue([task({ title: 'Stopped task', lane: 'canceled' })]) });
    const lanes = await service.projectForBoard(streamId, new Map());
    expect(lanes.canceled).toHaveLength(1);
    expect(lanes.canceled[0].title).toBe('Stopped task');
  });

  it('keeps failed tasks on the board in the failed lane', async () => {
    const { service } = makeService({ listForBoard: jest.fn().mockResolvedValue([task({ title: 'Broken task', lane: 'failed' })]) });
    const lanes = await service.projectForBoard(streamId, new Map());
    expect(lanes.failed).toHaveLength(1);
    expect(lanes.failed[0].title).toBe('Broken task');
  });

  it('includes the terminal failed/canceled lanes in the board query set', () => {
    // BOARD_LANES is the lane filter of the board query, so terminal lanes
    // must be listed or the rows never load.
    expect(BOARD_LANES).toContain('failed');
    expect(BOARD_LANES).toContain('canceled');
  });
});

describe('WorkyTaskService.getResultContent', () => {
  it('returns sorted components + artifacts for a task, keyed by externalId', async () => {
    const owner = task({ externalId: 'step-1' });
    const { service, mirror } = makeService(
      { findById: jest.fn().mockResolvedValue(owner) },
      {
        listStepComponents: jest.fn().mockResolvedValue([
          { id: newObjectId(), streamId: owner.streamId, externalId: 'c-1', stepExternalId: 'step-1', ordinal: 0, type: 'text', data: { content: 'done' }, createdAt: new Date(), updatedAt: new Date() },
        ]),
        listStepArtifacts: jest.fn().mockResolvedValue([artifact()]),
      },
    );

    const out = await service.getResultContent(owner.id);

    expect(mirror.listStepComponents).toHaveBeenCalledWith(owner.streamId, 'step-1');
    expect(mirror.listStepArtifacts).toHaveBeenCalledWith(owner.streamId, 'step-1');
    expect(out.components).toEqual([{ id: 'c-1', type: 'text', data: { content: 'done' } }]);
    expect(out.artifacts).toEqual([{ id: 'a-1', filePath: 'k/1', filename: 'r.pdf', artifactKind: 'document', mimeType: 'application/pdf', size: 9, createdAt: '2026-08-13T10:00:00.000Z' }]);
  });

  it('returns empty arrays for an invalid task id', async () => {
    const { service, tasks } = makeService();
    const out = await service.getResultContent('not-an-objectid');
    expect(out).toEqual({ components: [], artifacts: [] });
    expect(tasks.findById).not.toHaveBeenCalled();
  });

  it('returns empty arrays for a task that is not a manager step', async () => {
    const { service, mirror } = makeService({ findById: jest.fn().mockResolvedValue(task()) });
    const out = await service.getResultContent(newObjectId());
    expect(out).toEqual({ components: [], artifacts: [] });
    expect(mirror.listStepComponents).not.toHaveBeenCalled();
  });
});

describe('WorkyTaskService.resolveArtifactUrl', () => {
  it('signs the artifact of the task step for viewing and downloading', async () => {
    const owner = task({ externalId: 'step-1' });
    const { service, mirror, documents } = makeService(
      { findById: jest.fn().mockResolvedValue(owner) },
      { findStepArtifact: jest.fn().mockResolvedValue(artifact({ filename: 'q"4\r\n.pdf' })) },
    );

    const out = await service.resolveArtifactUrl(owner.id, 'a-1');

    expect(mirror.findStepArtifact).toHaveBeenCalledWith(owner.streamId, 'step-1', 'a-1');
    expect(documents.generateSasUrl).toHaveBeenCalledWith('k/1', { expiryMinutes: 10, checkExists: true });
    expect(documents.generateSasUrl).toHaveBeenCalledWith('k/1', {
      expiryMinutes: 10,
      contentDisposition: 'attachment; filename="q4.pdf"',
      checkExists: true,
    });
    expect(out).toEqual({ viewUrl: 'https://blob/sas', downloadUrl: 'https://blob/sas' });
  });

  it('answers not found for an unknown task or artifact', async () => {
    const { service, tasks } = makeService();
    await expect(service.resolveArtifactUrl('bad', 'a-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.resolveArtifactUrl(newObjectId(), 'a-1')).rejects.toBeInstanceOf(NotFoundException);

    tasks.findById.mockResolvedValue(task({ externalId: 'step-1' }));
    await expect(service.resolveArtifactUrl(newObjectId(), 'a-9')).rejects.toThrow('Artifact not found');
  });
});

describe('WorkyTaskService.countByStream', () => {
  it('returns the number of tasks of the stream', async () => {
    const { service, tasks } = makeService({ countByStream: jest.fn().mockResolvedValue(7) });
    const streamId = newObjectId();
    await expect(service.countByStream(streamId)).resolves.toBe(7);
    expect(tasks.countByStream).toHaveBeenCalledWith(streamId);
  });
});
