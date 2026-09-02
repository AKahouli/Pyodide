import { Controller, Get, Param, UseGuards, Logger } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WorkyStreamAccessGuard } from '../guards/worky-stream-access.guard';
import { WorkyTaskService, IBoardTaskView, BoardLane, BOARD_LANES } from '../services/worky-task.service';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';
import { RequirePermissions } from '../../authorization/decorators/require-permissions.decorator';
import { Permissions } from '../../authorization/constants/permissions';
import { WorkyInteraction } from '../schemas/worky-interaction.schema';
import { WorkyPlanProjection, WorkyPlanProjectionDocument } from '../schemas/worky-plan-projection.schema';

export interface WorkyBoardResponse {
  streamId: string;
  plan: { title: string; goal: string; status: string } | null;
  session: { status: string; activeInterruptId: string | null } | null;
  lanes: Record<BoardLane, IBoardTaskView[]>;
  pendingClarifications: Array<{
    id: string;
    type: string;
    question: string;
    options: string[];
    taskId: string | null;
    blocksTaskIds: string[];
    createdAt: string;
  }>;
}

@ApiTags('Worky')
@ApiBearerAuth()
@UseGuards(WorkyStreamAccessGuard)
@Controller('worky/streams')
export class WorkyBoardController {
  private readonly logger = new Logger('WorkyBoard');

  constructor(
    private readonly tasks: WorkyTaskService,
    @InjectModel(WorkyInteraction.name)
    private readonly interactions: Model<WorkyInteraction>,
    @InjectModel(WorkyPlanProjection.name)
    private readonly planProjections: Model<WorkyPlanProjectionDocument>,
  ) {}

  @Get(':id/board')
  @RequirePermissions(Permissions.WORKY_STREAM_READ)
  @ApiOperation({ summary: 'Get the six-lane Kanban projection for a stream' })
  @ApiParam({ name: 'id', description: 'Stream id' })
  async board(
    @CurrentUser() _user: UserDocument,
    @Param('id') streamId: string,
  ): Promise<WorkyBoardResponse> {
    const streamObjectId = new Types.ObjectId(streamId);
    const [pending, projection] = await Promise.all([
      this.interactions
        .find({ streamId: streamObjectId, status: 'pending' })
        .sort({ createdAt: 1 })
        .lean()
        .exec(),
      this.planProjections.findOne({ streamId: streamObjectId }).lean().exec(),
    ]);
    const blockersByTaskId = new Map<string, string[]>();
    for (const p of pending) {
      const id = (p._id as Types.ObjectId).toString();
      const reason = `clarification:${id}`;
      for (const t of p.blocksTaskIds ?? []) {
        const tid = t.toString();
        const list = blockersByTaskId.get(tid) ?? [];
        if (!list.includes(reason)) list.push(reason);
        blockersByTaskId.set(tid, list);
      }
    }
    const lanes = await this.tasks.projectForBoard(streamId, blockersByTaskId);
    const total = Object.values(lanes).reduce((n, arr) => n + arr.length, 0);
    // Raw task count for this stream (bypasses the lane filter) to tell apart
    // "read returns nothing" from "frontend didn't render".
    const rawCount = await this.tasks.countByStream(streamId);
    this.logger.log(
      `[worky-board] read streamId=${streamId} rawTasks=${rawCount} projected=${total} pending=${pending.length}`,
    );
    const emptyLanes = Object.fromEntries(
      BOARD_LANES.map((l) => [l, [] as IBoardTaskView[]]),
    ) as unknown as Record<BoardLane, IBoardTaskView[]>;
    return {
      streamId,
      plan: projection?.status
        ? { title: projection.title ?? '', goal: projection.goal ?? '', status: projection.status }
        : null,
      session: projection?.sessionStatus
        ? { status: projection.sessionStatus, activeInterruptId: projection.activeInterruptId ?? null }
        : null,
      lanes: { ...emptyLanes, ...lanes },
      pendingClarifications: pending.map((p) => ({
        id: (p._id as Types.ObjectId).toString(),
        type: p.type as string,
        question: p.question as string,
        options: (p.options ?? []) as string[],
        taskId: p.taskId ? (p.taskId as Types.ObjectId).toString() : null,
        blocksTaskIds: (p.blocksTaskIds ?? []).map((t) => (t as Types.ObjectId).toString()),
        createdAt: (p.createdAt as Date).toISOString(),
      })),
    };
  }
}
