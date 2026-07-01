import { Controller, Get, Param, UseGuards } from '@nestjs/common';
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

export interface WorkyBoardResponse {
  streamId: string;
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
  constructor(
    private readonly tasks: WorkyTaskService,
    @InjectModel(WorkyInteraction.name)
    private readonly interactions: Model<WorkyInteraction>,
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
    const pending = await this.interactions
      .find({ streamId: streamObjectId, status: 'pending' })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
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
    const emptyLanes = Object.fromEntries(
      BOARD_LANES.map((l) => [l, [] as IBoardTaskView[]]),
    ) as unknown as Record<BoardLane, IBoardTaskView[]>;
    return {
      streamId,
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
