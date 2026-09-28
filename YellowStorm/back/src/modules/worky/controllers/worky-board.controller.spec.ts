import { newObjectId } from '@common/postgres';
import { WorkyBoardController } from './worky-board.controller';
import type { WorkyInteractionRecord, WorkyPlanProjectionRecord } from '../worky.types';

describe('WorkyBoardController', () => {
  const streamId = newObjectId();
  const taskId = newObjectId();
  const userId = newObjectId();

  const interaction = (over: Partial<WorkyInteractionRecord> = {}): WorkyInteractionRecord => ({
    id: newObjectId(),
    streamId,
    taskId,
    type: 'clarification',
    targetUserId: null,
    question: 'Q?',
    options: ['a', 'b'],
    status: 'pending',
    blockingScope: 'task',
    blocksTaskIds: [taskId],
    respondedAt: null,
    response: null,
    metadata: {},
    createdAt: new Date('2026-09-20T08:00:00Z'),
    updatedAt: new Date('2026-09-20T08:00:00Z'),
    ...over,
  });

  const projection = (over: Partial<WorkyPlanProjectionRecord>): WorkyPlanProjectionRecord => ({
    id: newObjectId(),
    streamId,
    title: '',
    goal: '',
    status: '',
    sessionStatus: null,
    activeInterruptId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  const makeController = (overrides: { pending?: WorkyInteractionRecord[]; board?: Record<string, unknown[]>; projection?: WorkyPlanProjectionRecord | null } = {}) => {
    const taskService = {
      projectForBoard: jest.fn().mockResolvedValue(overrides.board ?? {}),
      countByStream: jest.fn().mockResolvedValue(0),
    };
    const interactions = { listPending: jest.fn().mockResolvedValue(overrides.pending ?? [interaction()]) };
    const mirror = { findProjection: jest.fn().mockResolvedValue(overrides.projection ?? null) };
    const controller = new WorkyBoardController(taskService as never, interactions as never, mirror as never);
    return { controller, taskService, interactions, mirror };
  };

  it('projects tasks into the six user-visible lanes and surfaces pending clarifications', async () => {
    const pending = interaction();
    const { controller, taskService, interactions, mirror } = makeController({
      pending: [pending],
      board: {
        backlog: [],
        ready: [
          {
            id: taskId,
            streamId,
            title: 'T',
            description: '',
            lane: 'ready',
            planningStatus: 'confirmed',
            executionState: 'not_started',
            priority: 'medium',
            assigneeType: 'unassigned',
            assigneeId: null,
            actionCategory: 'internal_analysis',
            dependsOn: [],
            blockerReason: null,
            theoreticalDeadlineAt: null,
          },
        ],
        running: [],
        review: [],
        blocked: [],
        done: [],
      },
    });

    const res = await controller.board({ _id: userId } as never, streamId);

    expect(interactions.listPending).toHaveBeenCalledWith(streamId);
    expect(mirror.findProjection).toHaveBeenCalledWith(streamId);
    expect(taskService.projectForBoard).toHaveBeenCalledWith(
      streamId,
      new Map([[taskId, [`clarification:${pending.id}`]]]),
    );
    expect(res.lanes.ready).toHaveLength(1);
    // Lanes the projection did not return are still present, empty.
    expect(res.lanes.failed).toEqual([]);
    expect(res.lanes.canceled).toEqual([]);
    expect(res.pendingClarifications).toEqual([
      {
        id: pending.id,
        type: 'clarification',
        question: 'Q?',
        options: ['a', 'b'],
        taskId,
        blocksTaskIds: [taskId],
        createdAt: '2026-09-20T08:00:00.000Z',
      },
    ]);
  });

  it('collects every pending interaction blocking the same task once', async () => {
    const first = interaction();
    const second = interaction({ taskId: null, blocksTaskIds: [taskId, taskId] });
    const { controller, taskService } = makeController({ pending: [first, second] });

    await controller.board({ _id: userId } as never, streamId);

    expect(taskService.projectForBoard).toHaveBeenCalledWith(
      streamId,
      new Map([[taskId, [`clarification:${first.id}`, `clarification:${second.id}`]]]),
    );
  });

  it('logs the raw task count next to the projected count', async () => {
    const { controller, taskService } = makeController({ pending: [] });
    taskService.countByStream.mockResolvedValue(4);
    const log = jest.spyOn((controller as unknown as { logger: { log: (m: string) => void } }).logger, 'log').mockImplementation(() => undefined);

    await controller.board({ _id: userId } as never, streamId);

    expect(taskService.countByStream).toHaveBeenCalledWith(streamId);
    expect(log).toHaveBeenCalledWith(`[worky-board] read streamId=${streamId} rawTasks=4 projected=0 pending=0`);
  });

  it('returns plan and session independently from the shared projection', async () => {
    const { controller } = makeController({
      pending: [],
      projection: projection({
        title: 'Prospection', goal: 'Build a shortlist', status: 'running',
        sessionStatus: 'waiting', activeInterruptId: 'ask:1',
      }),
    });
    const res = await controller.board({ _id: userId } as never, streamId);
    expect(res.plan).toEqual({ title: 'Prospection', goal: 'Build a shortlist', status: 'running' });
    expect(res.session).toEqual({ status: 'waiting', activeInterruptId: 'ask:1' });
  });

  it('returns a session without fabricating a plan', async () => {
    const { controller } = makeController({
      pending: [],
      projection: projection({ sessionStatus: 'paused' }),
    });
    const res = await controller.board({ _id: userId } as never, streamId);
    expect(res.plan).toBeNull();
    expect(res.session).toEqual({ status: 'paused', activeInterruptId: null });
  });

  it('returns neither plan nor session before the manager synced a projection', async () => {
    const { controller } = makeController({ pending: [] });
    const res = await controller.board({ _id: userId } as never, streamId);
    expect(res.plan).toBeNull();
    expect(res.session).toBeNull();
  });
});
