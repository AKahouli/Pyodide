import { Types } from 'mongoose';
import { WorkyBoardController } from './worky-board.controller';

describe('WorkyBoardController', () => {
  const streamObjectId = new Types.ObjectId();
  const taskObjectId = new Types.ObjectId();
  const userId = new Types.ObjectId();

  const makeController = (overrides: { pending?: any[]; board?: Record<string, any[]> } = {}) => {
    const taskService = {
      projectForBoard: jest.fn().mockResolvedValue(overrides.board ?? {}),
      countByStream: jest.fn().mockResolvedValue('objectId=0 string=0'),
    } as any;
    const pending = overrides.pending ?? [
      {
        _id: new Types.ObjectId(),
        type: 'clarification',
        question: 'Q?',
        options: ['a', 'b'],
        taskId: taskObjectId,
        blocksTaskIds: [taskObjectId],
        status: 'pending',
        createdAt: new Date(),
      },
    ];
    const interactionFind = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(pending) }),
      }),
    });
    const interactionModel = { find: interactionFind } as any;
    const controller = new WorkyBoardController(taskService, interactionModel);
    return { controller, taskService, interactionFind };
  };

  it('projects tasks into the six user-visible lanes and surfaces pending clarifications', async () => {
    const { controller, taskService } = makeController({
      board: {
        backlog: [],
        ready: [
          {
            id: taskObjectId.toString(),
            streamId: streamObjectId.toString(),
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
    const res = await controller.board(
      { _id: userId } as any,
      streamObjectId.toString(),
    );
    expect(taskService.projectForBoard).toHaveBeenCalledWith(
      streamObjectId.toString(),
      expect.any(Map),
    );
    expect(res.lanes.ready).toHaveLength(1);
    expect(res.pendingClarifications).toHaveLength(1);
    expect(res.pendingClarifications[0].blocksTaskIds).toEqual([taskObjectId.toString()]);
  });
});
