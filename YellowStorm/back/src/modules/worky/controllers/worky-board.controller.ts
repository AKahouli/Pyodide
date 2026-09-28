import { Controller, Get, Param, UseGuards, Logger } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { WorkyStreamAccessGuard } from '../guards/worky-stream-access.guard';
import { WorkyTaskService, IBoardTaskView, BoardLane, BOARD_LANES } from '../services/worky-task.service';
import { WorkyInteractionRepository } from '../persistence/worky-interaction.repository';
import { WorkyMirrorRepository } from '../persistence/worky-mirror.repository';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { RequirePermissions } from '../../authorization/decorators/require-permissions.decorator';
import { Permissions } from '../../authorization/constants/permissions';

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
    private readonly interactions: WorkyInteractionRepository,
    private readonly mirror: WorkyMirrorRepository,
  ) {}

  @Get(':id/board')
  @RequirePermissions(Permissions.WORKY_STREAM_READ)
  @ApiOperation({ summary: 'Get the six-lane Kanban projection for a stream' })
  @ApiParam({ name: 'id', description: 'Stream id' })
  async board(
    @CurrentUser() _user: AuthUser,
    @Param('id') streamId: string,
  ): Promise<WorkyBoardResponse> {
    const [pending, projection] = await Promise.all([
      this.interactions.listPending(streamId),
      this.mirror.findProjection(streamId),
    ]);
    const blockersByTaskId = new Map<string, string[]>();
    for (const p of pending) {
      const reason = `clarification:${p.id}`;
      for (const tid of p.blocksTaskIds) {
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
        ? { title: projection.title, goal: projection.goal, status: projection.status }
        : null,
      session: projection?.sessionStatus
        ? { status: projection.sessionStatus, activeInterruptId: projection.activeInterruptId }
        : null,
      lanes: { ...emptyLanes, ...lanes },
      pendingClarifications: pending.map((p) => ({
        id: p.id,
        type: p.type,
        question: p.question,
        options: p.options,
        taskId: p.taskId,
        blocksTaskIds: p.blocksTaskIds,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }
}
